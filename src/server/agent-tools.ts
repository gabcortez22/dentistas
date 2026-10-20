import { DateTime } from "luxon";
import { z } from "zod";
import type { ToolDef } from "@/lib/agent/llm";
import { type Actor, withService } from "@/lib/db";
import { bookAppointment, cancelAppointment, SlotTakenError } from "@/server/appointments";
import { loadSlots } from "@/server/availability";
import { createPatient, DuplicatePatientError } from "@/server/patients";
import { createProspect } from "@/server/prospects";

export const TOOL_NAMES = [
  "identify_patient",
  "register_patient",
  "list_open_slots",
  "propose_appointment",
  "book_appointment",
  "cancel_appointment",
  "get_balance",
  "capture_prospect",
  "handoff_to_human",
] as const;
export type ToolName = (typeof TOOL_NAMES)[number];

export type ToolContext = { conversationId: string; now?: () => Date };
export type ToolResult = { content: string; isError: boolean };

const PROPOSAL_LIFETIME_MS = 10 * 60_000;

const schemas = {
  identify_patient: z.object({}),
  register_patient: z.object({
    docType: z.enum(["DNI", "CE", "PASAPORTE", "OTRO"]),
    docNumber: z.string().trim().min(1),
    firstName: z.string().trim().min(1),
    lastName: z.string().trim().min(1),
    acceptsReminders: z.boolean(),
  }),
  list_open_slots: z.object({
    dentistId: z.uuid().optional(),
    fromDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    toDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    minutes: z.number().int().min(5).max(480),
  }),
  propose_appointment: z.object({
    dentistId: z.uuid(),
    startsAt: z.iso.datetime({ offset: true }),
    minutes: z.number().int().min(5).max(480),
    reason: z.string().trim().max(300).optional(),
  }),
  book_appointment: z.object({ proposalId: z.uuid() }),
  cancel_appointment: z.object({ appointmentId: z.uuid() }),
  get_balance: z.object({}),
  capture_prospect: z.object({
    name: z.string().trim().min(1).max(120),
    interest: z.string().trim().min(1).max(300).optional(),
  }),
  handoff_to_human: z.object({ reason: z.string().trim().min(1).max(300) }),
} satisfies Record<ToolName, z.ZodType>;

const DESCRIPTIONS: Record<ToolName, string> = {
  identify_patient:
    "Busca al paciente por el teléfono de este chat. Devuelve si está registrado y su nombre.",
  register_patient:
    "Registra a un paciente nuevo con el teléfono de este chat (solo si identify_patient no lo encontró).",
  list_open_slots:
    "Lista hasta 8 horarios libres entre dos fechas (YYYY-MM-DD, hora de la clínica). Si no das dentistId, busca en todos los dentistas.",
  propose_appointment:
    "Guarda una propuesta de cita (vence en 10 minutos) y devuelve un resumen para confirmar con el paciente. No agenda todavía.",
  book_appointment:
    "Agenda la cita de una propuesta ya confirmada por el paciente en un mensaje posterior.",
  cancel_appointment: "Cancela una cita futura del paciente identificado.",
  get_balance: "Devuelve el saldo pendiente total del paciente identificado.",
  capture_prospect:
    "Registra como prospecto a quien consulta sin ser paciente registrado ni agendar todavía (nombre e interés). Solo si el chat no tiene paciente identificado.",
  handoff_to_human: "Deriva la conversación a una persona del equipo y detiene al asistente.",
};

export const TOOL_DEFS: ToolDef[] = TOOL_NAMES.map((name) => ({
  name,
  description: DESCRIPTIONS[name],
  input_schema: z.toJSONSchema(schemas[name]) as Record<string, unknown>,
}));

type Conversation = {
  id: string;
  clinicId: string;
  phone: string;
  patientId: string | null;
  status: string;
  timezone: string;
};

async function loadConversation(id: string): Promise<Conversation | null> {
  return withService(async (client) => {
    const { rows } = await client.query(
      `select c.id, c.clinic_id, c.phone_e164, c.patient_id, c.status, k.timezone
         from agent_conversations c join clinics k on k.id = c.clinic_id where c.id = $1`,
      [id],
    );
    const r = rows[0];
    return r
      ? {
          id: r.id,
          clinicId: r.clinic_id,
          phone: r.phone_e164,
          patientId: r.patient_id,
          status: r.status,
          timezone: r.timezone,
        }
      : null;
  });
}

const ok = (value: unknown): ToolResult => ({ content: JSON.stringify(value), isError: false });
const fail = (message: string): ToolResult => ({
  content: JSON.stringify({ error: message }),
  isError: true,
});

const setPatient = (conversationId: string, patientId: string) =>
  withService((client) =>
    client.query("update agent_conversations set patient_id = $2 where id = $1", [
      conversationId,
      patientId,
    ]),
  );

export async function executeTool(
  ctx: ToolContext,
  name: string,
  input: unknown,
): Promise<ToolResult> {
  try {
    if (!(TOOL_NAMES as readonly string[]).includes(name)) return fail(`unknown tool: ${name}`);
    const tool = name as ToolName;
    const parsed = schemas[tool].safeParse(input ?? {});
    if (!parsed.success)
      return fail(
        `invalid arguments: ${parsed.error.issues.map((i) => `${i.path.join(".")} ${i.message}`).join("; ")}`,
      );
    const convo = await loadConversation(ctx.conversationId);
    if (!convo) return fail("conversation not found");
    const now = ctx.now?.() ?? new Date();
    const service: Actor = { kind: "service", clinicId: convo.clinicId };
    const argsOf = <T extends ToolName>(_tool: T) => parsed.data as z.infer<(typeof schemas)[T]>;

    switch (tool) {
      case "identify_patient": {
        const rows = await withService(
          async (client) =>
            (
              await client.query(
                "select id, first_name from patients where clinic_id = $1 and phone_e164 = $2 and archived_at is null limit 2",
                [convo.clinicId, convo.phone],
              )
            ).rows,
        );
        if (rows.length === 1) {
          await setPatient(convo.id, rows[0].id);
          return ok({ found: true, firstName: rows[0].first_name });
        }
        return ok({ found: false, ambiguous: rows.length > 1 });
      }
      case "register_patient": {
        const args = argsOf("register_patient");
        try {
          const patient = await createPatient(service, {
            docType: args.docType,
            docNumber: args.docNumber,
            firstName: args.firstName,
            lastName: args.lastName,
            phone: convo.phone,
            whatsappOptIn: args.acceptsReminders,
          });
          await setPatient(convo.id, patient.id);
          return ok({ registered: true, firstName: patient.firstName });
        } catch (error) {
          if (error instanceof DuplicatePatientError) {
            return fail(
              "ese documento ya está registrado; pide al paciente que contacte a la clínica para vincular su número",
            );
          }
          if (error instanceof z.ZodError)
            return fail(
              `datos no válidos: ${error.issues.map((i) => i.path.join(".")).join(", ")}`,
            );
          throw error;
        }
      }
      case "list_open_slots": {
        const args = argsOf("list_open_slots");
        const from = DateTime.fromISO(args.fromDate, { zone: convo.timezone }).startOf("day");
        const to = DateTime.fromISO(args.toDate, { zone: convo.timezone })
          .startOf("day")
          .plus({ days: 1 });
        const capped = DateTime.min(to, from.plus({ days: 14 }));
        const dentists = await withService(
          async (client) =>
            (
              await client.query(
                `select id, display_name from memberships where clinic_id = $1 and role = 'dentist' and active
               and ($2::uuid is null or id = $2) order by display_name`,
                [convo.clinicId, args.dentistId ?? null],
              )
            ).rows,
        );
        const out: Array<{ dentistId: string; dentist: string; startsAt: string; label: string }> =
          [];
        for (const d of dentists) {
          const slots = await loadSlots(
            service,
            {
              membershipId: d.id,
              from: from.toJSDate(),
              to: capped.toJSDate(),
              durationMinutes: args.minutes,
            },
            { now },
          );
          for (const s of slots) {
            out.push({
              dentistId: d.id,
              dentist: d.display_name,
              startsAt: s.startsAt.toISOString(),
              label: DateTime.fromJSDate(s.startsAt, { zone: convo.timezone })
                .setLocale("es-PE")
                .toFormat("cccc d LLL, HH:mm"),
            });
          }
        }
        out.sort((a, b) => a.startsAt.localeCompare(b.startsAt));
        return ok({ slots: out.slice(0, 8) });
      }
      case "propose_appointment": {
        const args = argsOf("propose_appointment");
        if (!convo.patientId) return fail("patient not identified");
        const startsAt = new Date(args.startsAt);
        const slots = await loadSlots(
          service,
          {
            membershipId: args.dentistId,
            from: new Date(startsAt.getTime() - 1),
            to: new Date(startsAt.getTime() + args.minutes * 60_000),
            durationMinutes: args.minutes,
          },
          { now },
        );
        if (!slots.some((s) => s.startsAt.getTime() === startsAt.getTime()))
          return fail("ese horario no está disponible");
        const proposal = await withService(async (client) => {
          const dentist = await client.query(
            "select display_name from memberships where id = $1 and clinic_id = $2 and role = 'dentist' and active",
            [args.dentistId, convo.clinicId],
          );
          if (!dentist.rowCount) return null;
          const { rows } = await client.query<{ id: string }>(
            `insert into appointment_proposals (clinic_id, conversation_id, patient_id, membership_id, starts_at, ends_at, reason, expires_at)
             values ($1, $2, $3, $4, $5, $6, $7, $8) returning id`,
            [
              convo.clinicId,
              convo.id,
              convo.patientId,
              args.dentistId,
              startsAt,
              new Date(startsAt.getTime() + args.minutes * 60_000),
              args.reason ?? null,
              new Date(now.getTime() + PROPOSAL_LIFETIME_MS),
            ],
          );
          return { id: rows[0]?.id as string, dentist: dentist.rows[0].display_name as string };
        });
        if (!proposal) return fail("dentista no encontrado");
        const label = DateTime.fromJSDate(startsAt, { zone: convo.timezone })
          .setLocale("es-PE")
          .toFormat("cccc d 'de' LLLL, HH:mm");
        return ok({
          proposalId: proposal.id,
          summary: `Cita con ${proposal.dentist} el ${label} (hora de la clínica), ${args.minutes} min${args.reason ? `, motivo: ${args.reason}` : ""}. Pide confirmación al paciente.`,
        });
      }
      case "book_appointment": {
        const args = argsOf("book_appointment");
        const result = await withService(async (client) => {
          const { rows } = await client.query(
            `select p.*, (select max(t.created_at) from agent_turns t where t.conversation_id = p.conversation_id and t.role = 'user' and jsonb_path_exists(t.content, '$[*] ? (@.type == "text")')) as last_user_at
               from appointment_proposals p where p.id = $1 and p.conversation_id = $2 and p.clinic_id = $3`,
            [args.proposalId, convo.id, convo.clinicId],
          );
          return rows[0] ?? null;
        });
        if (!result) return fail("proposal not found");
        if (result.consumed_at) return fail("proposal already used");
        if (new Date(result.expires_at) <= now) return fail("proposal expired");
        if (!result.last_user_at || new Date(result.last_user_at) <= new Date(result.created_at)) {
          return fail("el paciente aún no ha confirmado: pide confirmación y espera su respuesta");
        }
        try {
          const appointment = await bookAppointment(
            service,
            {
              patientId: result.patient_id,
              membershipId: result.membership_id,
              startsAt: new Date(result.starts_at),
              durationMinutes: Math.round(
                (new Date(result.ends_at).getTime() - new Date(result.starts_at).getTime()) /
                  60_000,
              ),
              reason: result.reason ?? undefined,
              source: "whatsapp",
            },
            { now },
          );
          await withService((client) =>
            client.query("update appointment_proposals set consumed_at = now() where id = $1", [
              result.id,
            ]),
          );
          return ok({ booked: true, appointmentId: appointment.id });
        } catch (error) {
          if (error instanceof SlotTakenError) return fail("ese horario ya no está disponible");
          throw error;
        }
      }
      case "cancel_appointment": {
        const args = argsOf("cancel_appointment");
        if (!convo.patientId) return fail("patient not identified");
        const found = await withService(
          async (client) =>
            (
              await client.query(
                "select 1 from appointments where id = $1 and clinic_id = $2 and patient_id = $3 and status = 'confirmed' and starts_at > $4",
                [args.appointmentId, convo.clinicId, convo.patientId, now],
              )
            ).rowCount,
        );
        if (!found)
          return fail("no se encontró una cita futura de este paciente con ese identificador");
        await cancelAppointment(service, args.appointmentId);
        return ok({ cancelled: true });
      }
      case "get_balance": {
        if (!convo.patientId) return fail("patient not identified");
        const balance = await withService(async (client) =>
          Number(
            (
              await client.query(
                "select coalesce(sum(balance_cents), 0) as b from quote_balances where patient_id = $1 and clinic_id = $2",
                [convo.patientId, convo.clinicId],
              )
            ).rows[0].b,
          ),
        );
        return ok({ balanceCents: balance, balanceText: `S/ ${(balance / 100).toFixed(2)}` });
      }
      case "capture_prospect": {
        if (convo.patientId)
          return fail(
            "el chat ya tiene un paciente identificado; no hace falta captar un prospecto",
          );
        const args = argsOf("capture_prospect");
        const { created } = await createProspect(service, {
          name: args.name,
          phone: convo.phone,
          source: "whatsapp",
          interest: args.interest,
        });
        return ok({ captured: true, created });
      }
      case "handoff_to_human": {
        await withService((client) =>
          client.query("update agent_conversations set status = 'handoff' where id = $1", [
            convo.id,
          ]),
        );
        return ok({ handoff: true });
      }
    }
  } catch (error) {
    return fail(`error interno: ${(error as Error).message}`);
  }
}
