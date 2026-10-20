import type { PoolClient } from "pg";
import { z } from "zod";
import { withTenant } from "@/lib/db";
import { getPatient, type Patient } from "@/server/patients";
import { ForbiddenError, type UserActor } from "@/server/session";

export const ENTRY_KINDS = [
  "anamnesis",
  "examen",
  "diagnostico",
  "tratamiento",
  "evolucion",
  "consentimiento",
  "alta",
] as const;
export type EntryKind = (typeof ENTRY_KINDS)[number];

const t = z.string().trim().min(1).max(4000);
const to = t.optional();
const quadrant = (q: number, count: number) =>
  Array.from({ length: count }, (_, i) => q * 10 + i + 1);
/** Permanent teeth (quadrants 1-4, 8 each) and primary teeth (quadrants 5-8, 5 each), FDI notation. */
export const FDI_TEETH = [
  ...[1, 2, 3, 4].flatMap((q) => quadrant(q, 8)),
  ...[5, 6, 7, 8].flatMap((q) => quadrant(q, 5)),
];
const fdi = z
  .number()
  .int()
  .refine((n) => FDI_TEETH.includes(n), "pieza FDI no válida");

export const ENTRY_SCHEMAS = {
  anamnesis: z.object({
    motivoConsulta: t,
    informante: to,
    tiempoEnfermedad: to,
    signosSintomas: to,
    relatoCronologico: to,
    funcionesBiologicas: to,
    enfermedadActual: to,
    antecedentesPersonales: to,
    antecedentesFamiliares: to,
    alergias: to,
    medicacionActual: to,
  }),
  examen: z
    .object({
      extraoral: to,
      intraoral: to,
      funcionesVitales: z
        .object({
          presionArterial: to,
          pulso: to,
          temperatura: to,
          frecuenciaCardiaca: to,
          frecuenciaRespiratoria: to,
        })
        .optional(),
      examenClinicoGeneral: to,
    })
    .refine(
      (v) => v.extraoral || v.intraoral || v.funcionesVitales || v.examenClinicoGeneral,
      "al menos un campo",
    ),
  diagnostico: z.object({
    items: z
      .array(z.object({ descripcion: t, cie10: z.string().trim().min(1).max(20).optional() }))
      .min(1)
      .max(20),
  }),
  tratamiento: z.object({
    items: z
      .array(z.object({ descripcion: t, pieza: fdi.optional() }))
      .min(1)
      .max(20),
    plan: to,
    pronostico: to,
    recomendaciones: to,
  }),
  evolucion: z.object({ texto: t }),
  consentimiento: z.object({
    procedimiento: t,
    texto: t,
    aceptadoPor: t,
    fecha: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  }),
  alta: z.object({ texto: t }),
} as const;

export type Entry = {
  id: string;
  kind: EntryKind | "nota_correccion";
  body: Record<string, unknown>;
  authorName: string;
  createdAt: Date;
  correctsEntryId: string | null;
};
export type OdontogramMark = {
  id: string;
  tooth: number;
  surface: string | null;
  condition: string;
  note: string | null;
  createdAt: Date;
};

async function assertClinicalRole(client: PoolClient, actor: UserActor): Promise<void> {
  const { rows } = await client.query<{ role: string }>(
    "select role from memberships where id = $1 and clinic_id = $2 and active",
    [actor.membershipId, actor.clinicId],
  );
  const role = rows[0]?.role;
  if (role !== "admin" && role !== "dentist") throw new ForbiddenError();
}

async function assertPatient(client: PoolClient, actor: UserActor, patientId: string) {
  const { rowCount } = await client.query(
    "select 1 from patients where id = $1 and clinic_id = $2",
    [patientId, actor.clinicId],
  );
  if (!rowCount) throw new Error("patient not found");
}

export async function addEntry(
  actor: UserActor,
  patientId: string,
  kind: EntryKind,
  body: unknown,
): Promise<{ id: string }> {
  const parsed = ENTRY_SCHEMAS[kind].parse(body);
  return withTenant(actor.userId, async (client) => {
    await assertClinicalRole(client, actor);
    await assertPatient(client, actor, patientId);
    const { rows } = await client.query<{ id: string }>(
      `insert into clinical_entries (clinic_id, patient_id, kind, body, author_membership_id)
       values ($1, $2, $3, $4, $5) returning id`,
      [actor.clinicId, patientId, kind, JSON.stringify(parsed), actor.membershipId],
    );
    return { id: rows[0]?.id as string };
  });
}

export async function correctEntry(
  actor: UserActor,
  entryId: string,
  texto: string,
): Promise<{ id: string }> {
  const body = z.object({ texto: t }).parse({ texto });
  return withTenant(actor.userId, async (client) => {
    await assertClinicalRole(client, actor);
    const original = await client.query<{ patient_id: string }>(
      "select patient_id from clinical_entries where id = $1 and clinic_id = $2",
      [entryId, actor.clinicId],
    );
    const patientId = original.rows[0]?.patient_id;
    if (!patientId) throw new Error("entry not found");
    const { rows } = await client.query<{ id: string }>(
      `insert into clinical_entries
         (clinic_id, patient_id, kind, body, author_membership_id, corrects_entry_id)
       values ($1, $2, 'nota_correccion', $3, $4, $5) returning id`,
      [actor.clinicId, patientId, JSON.stringify(body), actor.membershipId, entryId],
    );
    return { id: rows[0]?.id as string };
  });
}

const markSchema = z.object({
  tooth: fdi,
  surface: z.enum(["M", "D", "O", "V", "L", "P", "I"]).optional(),
  condition: z.string().trim().min(1).max(200),
  note: z.string().trim().max(1000).optional(),
});

export async function addOdontogramMark(
  actor: UserActor,
  patientId: string,
  mark: unknown,
): Promise<{ id: string }> {
  const m = markSchema.parse(mark);
  return withTenant(actor.userId, async (client) => {
    await assertClinicalRole(client, actor);
    await assertPatient(client, actor, patientId);
    const { rows } = await client.query<{ id: string }>(
      `insert into odontogram_marks
         (clinic_id, patient_id, tooth_fdi, surface, condition, note, author_membership_id)
       values ($1, $2, $3, $4, $5, $6, $7) returning id`,
      [
        actor.clinicId,
        patientId,
        m.tooth,
        m.surface ?? null,
        m.condition,
        m.note ?? null,
        actor.membershipId,
      ],
    );
    return { id: rows[0]?.id as string };
  });
}

const markFrom = (r: Record<string, unknown>): OdontogramMark => ({
  id: r.id as string,
  tooth: r.tooth_fdi as number,
  surface: (r.surface as string) ?? null,
  condition: r.condition as string,
  note: (r.note as string) ?? null,
  createdAt: r.created_at as Date,
});

async function currentMarks(client: PoolClient, actor: UserActor, patientId: string) {
  const { rows } = await client.query(
    `select distinct on (tooth_fdi, coalesce(surface, '')) *
       from odontogram_marks where patient_id = $1 and clinic_id = $2
      order by tooth_fdi, coalesce(surface, ''), created_at desc, id desc`,
    [patientId, actor.clinicId],
  );
  return rows.map(markFrom);
}

export async function currentOdontogram(
  actor: UserActor,
  patientId: string,
): Promise<OdontogramMark[]> {
  return withTenant(actor.userId, async (client) => {
    await assertClinicalRole(client, actor);
    return currentMarks(client, actor, patientId);
  });
}

export async function openRecord(
  actor: UserActor,
  patientId: string,
): Promise<{ patient: Patient; entries: Entry[]; odontogram: OdontogramMark[] }> {
  const data = await withTenant(actor.userId, async (client) => {
    await assertClinicalRole(client, actor);
    await assertPatient(client, actor, patientId);
    await client.query(
      "insert into record_access_log (clinic_id, patient_id, membership_id) values ($1, $2, $3)",
      [actor.clinicId, patientId, actor.membershipId],
    );
    const { rows } = await client.query(
      `select e.id, e.kind, e.body, e.created_at, e.corrects_entry_id, m.display_name
         from clinical_entries e join memberships m on m.id = e.author_membership_id
        where e.patient_id = $1 and e.clinic_id = $2
        order by e.created_at, e.id`,
      [patientId, actor.clinicId],
    );
    const entries: Entry[] = rows.map((r) => ({
      id: r.id,
      kind: r.kind,
      body: r.body,
      authorName: r.display_name,
      createdAt: r.created_at,
      correctsEntryId: r.corrects_entry_id,
    }));
    return { entries, odontogram: await currentMarks(client, actor, patientId) };
  });
  const patient = await getPatient(actor, patientId);
  if (!patient) throw new Error("patient not found");
  return { patient, ...data };
}
