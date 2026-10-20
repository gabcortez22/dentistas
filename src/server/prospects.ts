import { z } from "zod";
import { type Actor, runAs } from "@/lib/db";
import { normalizePhonePE } from "@/lib/phone";
import { createPatient, type Patient } from "@/server/patients";

export const STAGES = ["new", "contacted", "appointment_booked", "quoted", "won", "lost"] as const;
export type Stage = (typeof STAGES)[number];
export const SOURCES = ["whatsapp", "web", "referral", "walk_in", "social", "other"] as const;
export type Source = (typeof SOURCES)[number];

export type Prospect = {
  id: string;
  name: string;
  phoneE164: string | null;
  email: string | null;
  source: Source;
  interest: string | null;
  notes: string | null;
  stage: Stage;
  assignedTo: string | null;
  patientId: string | null;
  lostReason: string | null;
  whatsappOptIn: boolean;
  createdAt: Date;
};
export type ProspectEvent = {
  id: string;
  kind: string;
  body: Record<string, unknown>;
  authorName: string | null;
  createdAt: Date;
};
export type FollowupTask = {
  id: string;
  prospectId: string;
  prospectName: string;
  dueAt: Date;
  kind: "call" | "whatsapp" | "other";
  note: string | null;
  status: "pending" | "done" | "cancelled";
};

const optional = z.string().trim().min(1).optional();
const prospectSchema = z
  .object({
    name: z.string().trim().min(1),
    phone: optional,
    email: z.email().optional(),
    source: z.enum(SOURCES).default("other"),
    interest: optional,
    notes: optional,
    whatsappOptIn: z.boolean().default(false),
  })
  .superRefine((v, ctx) => {
    if (v.phone && !normalizePhonePE(v.phone)) {
      ctx.addIssue({ code: "custom", path: ["phone"], message: "teléfono no válido" });
    }
    if (v.whatsappOptIn && !v.phone) {
      ctx.addIssue({
        code: "custom",
        path: ["phone"],
        message: "el consentimiento de WhatsApp requiere un teléfono",
      });
    }
  });

const toProspect = (r: Record<string, unknown>): Prospect => ({
  id: r.id as string,
  name: r.name as string,
  phoneE164: (r.phone_e164 as string) ?? null,
  email: (r.email as string) ?? null,
  source: r.source as Source,
  interest: (r.interest as string) ?? null,
  notes: (r.notes as string) ?? null,
  stage: r.stage as Stage,
  assignedTo: (r.assigned_to as string) ?? null,
  patientId: (r.patient_id as string) ?? null,
  lostReason: (r.lost_reason as string) ?? null,
  whatsappOptIn: r.whatsapp_opt_in as boolean,
  createdAt: r.created_at as Date,
});

const authorOf = (actor: Actor) => (actor.kind === "user" ? actor.membershipId : null);

export async function createProspect(
  actor: Actor,
  input: z.input<typeof prospectSchema>,
): Promise<{ prospect: Prospect; created: boolean }> {
  const d = prospectSchema.parse(input);
  const phone = d.phone ? normalizePhonePE(d.phone) : null;
  return runAs(actor, async (client) => {
    if (phone) {
      const open = await client.query(
        `select * from prospects where clinic_id = $1 and phone_e164 = $2
           and stage in ('new', 'contacted', 'appointment_booked', 'quoted')`,
        [actor.clinicId, phone],
      );
      if (open.rows[0]) return { prospect: toProspect(open.rows[0]), created: false };
    }
    const { rows } = await client.query(
      `insert into prospects (clinic_id, name, phone_e164, email, source, interest, notes, whatsapp_opt_in, assigned_to)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9) returning *`,
      [
        actor.clinicId,
        d.name,
        phone,
        d.email ?? null,
        d.source,
        d.interest ?? null,
        d.notes ?? null,
        d.whatsappOptIn,
        authorOf(actor),
      ],
    );
    const prospect = toProspect(rows[0]);
    await client.query(
      "insert into prospect_events (clinic_id, prospect_id, kind, body, author_membership_id) values ($1, $2, 'created', $3, $4)",
      [actor.clinicId, prospect.id, JSON.stringify({ source: d.source }), authorOf(actor)],
    );
    return { prospect, created: true };
  });
}

export async function listProspects(
  actor: Actor,
  opts: { stage?: Stage; q?: string } = {},
): Promise<Prospect[]> {
  const q = opts.q?.trim();
  const like = q ? `%${q.replace(/[\\%_]/g, "\\$&")}%` : null;
  return runAs(actor, async (client) => {
    const { rows } = await client.query(
      `select * from prospects
        where clinic_id = $1 and ($2::prospect_stage is null or stage = $2)
          and ($3::text is null or name ilike $3 or phone_e164 ilike $3 or interest ilike $3)
        order by created_at desc limit 300`,
      [actor.clinicId, opts.stage ?? null, like],
    );
    return rows.map(toProspect);
  });
}

export async function getProspect(
  actor: Actor,
  id: string,
): Promise<{ prospect: Prospect; events: ProspectEvent[]; tasks: FollowupTask[] } | null> {
  return runAs(actor, async (client) => {
    const found = await client.query("select * from prospects where id = $1 and clinic_id = $2", [
      id,
      actor.clinicId,
    ]);
    if (!found.rows[0]) return null;
    const events = await client.query(
      `select e.id, e.kind, e.body, e.created_at, m.display_name
         from prospect_events e left join memberships m on m.id = e.author_membership_id
        where e.prospect_id = $1 and e.clinic_id = $2 order by e.created_at, e.id`,
      [id, actor.clinicId],
    );
    const tasks = await client.query(
      `select t.*, p.name as prospect_name from followup_tasks t join prospects p on p.id = t.prospect_id
        where t.prospect_id = $1 and t.clinic_id = $2 order by t.due_at`,
      [id, actor.clinicId],
    );
    return {
      prospect: toProspect(found.rows[0]),
      events: events.rows.map((r) => ({
        id: r.id,
        kind: r.kind,
        body: r.body,
        authorName: r.display_name,
        createdAt: r.created_at,
      })),
      tasks: tasks.rows.map(toTask),
    };
  });
}

const toTask = (r: Record<string, unknown>): FollowupTask => ({
  id: r.id as string,
  prospectId: r.prospect_id as string,
  prospectName: r.prospect_name as string,
  dueAt: r.due_at as Date,
  kind: r.kind as FollowupTask["kind"],
  note: (r.note as string) ?? null,
  status: r.status as FollowupTask["status"],
});

const stageSchema = z
  .object({ stage: z.enum(STAGES), lostReason: z.string().trim().min(1).optional() })
  .superRefine((v, ctx) => {
    if (v.stage === "lost" && !v.lostReason) {
      ctx.addIssue({ code: "custom", path: ["lostReason"], message: "indica el motivo" });
    }
  });

export async function moveStage(
  actor: Actor,
  id: string,
  stage: Stage,
  opts: { lostReason?: string } = {},
): Promise<void> {
  const d = stageSchema.parse({ stage, lostReason: opts.lostReason });
  await runAs(actor, async (client) => {
    const current = await client.query<{ stage: Stage }>(
      "select stage from prospects where id = $1 and clinic_id = $2 for update",
      [id, actor.clinicId],
    );
    const from = current.rows[0]?.stage;
    if (!from) throw new Error("prospect not found");
    if (from === d.stage) return;
    await client.query(
      "update prospects set stage = $3, lost_reason = $4 where id = $1 and clinic_id = $2",
      [id, actor.clinicId, d.stage, d.stage === "lost" ? d.lostReason : null],
    );
    await client.query(
      "insert into prospect_events (clinic_id, prospect_id, kind, body, author_membership_id) values ($1, $2, 'stage_change', $3, $4)",
      [
        actor.clinicId,
        id,
        JSON.stringify({ from, to: d.stage, reason: d.lostReason ?? null }),
        authorOf(actor),
      ],
    );
  });
}

export async function addNote(actor: Actor, id: string, text: string): Promise<void> {
  const note = z.string().trim().min(1).max(2000).parse(text);
  await runAs(actor, async (client) => {
    const found = await client.query("select 1 from prospects where id = $1 and clinic_id = $2", [
      id,
      actor.clinicId,
    ]);
    if (!found.rowCount) throw new Error("prospect not found");
    await client.query(
      "insert into prospect_events (clinic_id, prospect_id, kind, body, author_membership_id) values ($1, $2, 'note', $3, $4)",
      [actor.clinicId, id, JSON.stringify({ text: note }), authorOf(actor)],
    );
  });
}

export async function scheduleFollowup(
  actor: Actor,
  id: string,
  input: { dueAt: Date; kind?: "call" | "whatsapp" | "other"; note?: string },
): Promise<{ id: string }> {
  const d = z
    .object({
      dueAt: z.date(),
      kind: z.enum(["call", "whatsapp", "other"]).default("call"),
      note: optional,
    })
    .parse(input);
  return runAs(actor, async (client) => {
    const found = await client.query("select 1 from prospects where id = $1 and clinic_id = $2", [
      id,
      actor.clinicId,
    ]);
    if (!found.rowCount) throw new Error("prospect not found");
    const { rows } = await client.query<{ id: string }>(
      `insert into followup_tasks (clinic_id, prospect_id, due_at, kind, note, assigned_to, created_by)
       values ($1, $2, $3, $4, $5, $6, $6) returning id`,
      [actor.clinicId, id, d.dueAt, d.kind, d.note ?? null, authorOf(actor)],
    );
    return { id: rows[0]?.id as string };
  });
}

export async function completeFollowup(actor: Actor, taskId: string): Promise<void> {
  await runAs(actor, async (client) => {
    const { rowCount } = await client.query(
      "update followup_tasks set status = 'done', done_at = now() where id = $1 and clinic_id = $2 and status = 'pending'",
      [taskId, actor.clinicId],
    );
    if (!rowCount) throw new Error("task not found or not pending");
  });
}

export async function listDueFollowups(
  actor: Actor,
  opts: { upTo?: Date } = {},
): Promise<FollowupTask[]> {
  return runAs(actor, async (client) => {
    const { rows } = await client.query(
      `select t.*, p.name as prospect_name from followup_tasks t join prospects p on p.id = t.prospect_id
        where t.clinic_id = $1 and t.status = 'pending' and t.due_at <= $2 order by t.due_at`,
      [actor.clinicId, opts.upTo ?? new Date()],
    );
    return rows.map(toTask);
  });
}

export async function convertToPatient(
  actor: Actor,
  prospectId: string,
  patientInput: Record<string, unknown>,
): Promise<Patient> {
  const found = await getProspect(actor, prospectId);
  if (!found) throw new Error("prospect not found");
  if (found.prospect.patientId) throw new Error("prospect already converted");
  const patient = await createPatient(actor, {
    phone: found.prospect.phoneE164 ?? undefined,
    email: found.prospect.email ?? undefined,
    ...patientInput,
  });
  await runAs(actor, async (client) => {
    await client.query("update prospects set patient_id = $3 where id = $1 and clinic_id = $2", [
      prospectId,
      actor.clinicId,
      patient.id,
    ]);
    await client.query(
      "insert into prospect_events (clinic_id, prospect_id, kind, body, author_membership_id) values ($1, $2, 'converted', $3, $4)",
      [actor.clinicId, prospectId, JSON.stringify({ patientId: patient.id }), authorOf(actor)],
    );
  });
  return patient;
}

export async function prospectSummary(
  actor: Actor,
): Promise<{ byStage: Record<Stage, number>; conversionRate: number | null }> {
  return runAs(actor, async (client) => {
    const { rows } = await client.query<{ stage: Stage; n: number }>(
      "select stage, count(*)::int as n from prospects where clinic_id = $1 group by stage",
      [actor.clinicId],
    );
    const byStage = Object.fromEntries(STAGES.map((s) => [s, 0])) as Record<Stage, number>;
    for (const r of rows) byStage[r.stage] = r.n;
    const closed = byStage.won + byStage.lost;
    return { byStage, conversionRate: closed === 0 ? null : byStage.won / closed };
  });
}
