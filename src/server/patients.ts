import type { PoolClient } from "pg";
import { z } from "zod";
import { type Actor, runAs } from "@/lib/db";
import { normalizePhonePE } from "@/lib/phone";

export class DuplicatePatientError extends Error {
  constructor() {
    super("a patient with that document already exists in this clinic");
    this.name = "DuplicatePatientError";
  }
}

export type Patient = {
  id: string;
  clinicId: string;
  hcNumber: string;
  docType: "DNI" | "CE" | "PASAPORTE" | "OTRO";
  docNumber: string;
  lastName: string;
  firstName: string;
  birthDate: string | null;
  birthPlace: string | null;
  sex: "F" | "M" | null;
  maritalStatus: string | null;
  educationLevel: string | null;
  occupation: string | null;
  address: string | null;
  phoneE164: string | null;
  email: string | null;
  religion: string | null;
  race: string | null;
  originPlace: string | null;
  guardianName: string | null;
  guardianPhoneE164: string | null;
  whatsappOptIn: boolean;
  archivedAt: Date | null;
};

const text = z.string().trim().min(1).optional();
const shape = {
  lastName: z.string().trim().min(1),
  firstName: z.string().trim().min(1),
  birthDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  sex: z.enum(["F", "M"]).optional(),
  birthPlace: text,
  maritalStatus: text,
  educationLevel: text,
  occupation: text,
  address: text,
  email: z.email().optional(),
  religion: text,
  race: text,
  originPlace: text,
  guardianName: text,
  phone: z.string().trim().min(1).optional(),
  guardianPhone: z.string().trim().min(1).optional(),
  whatsappOptIn: z.boolean().default(false),
};

function checkPhones(
  value: { phone?: string; guardianPhone?: string; whatsappOptIn?: boolean },
  ctx: z.RefinementCtx,
) {
  for (const key of ["phone", "guardianPhone"] as const) {
    const raw = value[key];
    if (raw && !normalizePhonePE(raw)) {
      ctx.addIssue({ code: "custom", path: [key], message: "teléfono no válido" });
    }
  }
}

export const patientInput = z
  .object({
    docType: z.enum(["DNI", "CE", "PASAPORTE", "OTRO"]).default("DNI"),
    docNumber: z.string().trim().min(1),
    ...shape,
  })
  .superRefine((value, ctx) => {
    if (value.docType === "DNI" && !/^\d{8}$/.test(value.docNumber)) {
      ctx.addIssue({ code: "custom", path: ["docNumber"], message: "el DNI debe tener 8 dígitos" });
    }
    if (value.docType === "CE" && !/^[A-Za-z0-9]{9,12}$/.test(value.docNumber)) {
      ctx.addIssue({
        code: "custom",
        path: ["docNumber"],
        message: "el CE debe tener 9 a 12 caracteres",
      });
    }
    checkPhones(value, ctx);
    if (value.whatsappOptIn && !value.phone) {
      ctx.addIssue({
        code: "custom",
        path: ["phone"],
        message: "el consentimiento de WhatsApp requiere un teléfono",
      });
    }
  });

const patientPatch = z
  .object(shape)
  .partial()
  .superRefine((value, ctx) => checkPhones(value, ctx));

type Row = Record<string, unknown>;
const toPatient = (r: Row): Patient => ({
  id: r.id as string,
  clinicId: r.clinic_id as string,
  hcNumber: r.hc_number as string,
  docType: r.doc_type as Patient["docType"],
  docNumber: r.doc_number as string,
  lastName: r.last_name as string,
  firstName: r.first_name as string,
  birthDate: r.birth_date ? new Date(r.birth_date as string).toISOString().slice(0, 10) : null,
  birthPlace: (r.birth_place as string) ?? null,
  sex: (r.sex as Patient["sex"]) ?? null,
  maritalStatus: (r.marital_status as string) ?? null,
  educationLevel: (r.education_level as string) ?? null,
  occupation: (r.occupation as string) ?? null,
  address: (r.address as string) ?? null,
  phoneE164: (r.phone_e164 as string) ?? null,
  email: (r.email as string) ?? null,
  religion: (r.religion as string) ?? null,
  race: (r.race as string) ?? null,
  originPlace: (r.origin_place as string) ?? null,
  guardianName: (r.guardian_name as string) ?? null,
  guardianPhoneE164: (r.guardian_phone_e164 as string) ?? null,
  whatsappOptIn: r.whatsapp_opt_in as boolean,
  archivedAt: (r.archived_at as Date) ?? null,
});

/** Inserts a patient inside the caller's transaction. A duplicate document raises DuplicatePatientError. */
export async function createPatientInTx(
  client: PoolClient,
  actor: Actor,
  input: unknown,
): Promise<Patient> {
  const d = patientInput.parse(input);
  try {
    const { rows } = await client.query(
      `insert into patients (clinic_id, hc_number, doc_type, doc_number, last_name, first_name,
         birth_date, birth_place, sex, marital_status, education_level, occupation, address,
         phone_e164, email, guardian_name, guardian_phone_e164, whatsapp_opt_in,
         whatsapp_opt_in_at, created_by, religion, race, origin_place)
       values ($1, $2, $3, $2, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17,
         case when $17 then now() end, $18, $19, $20, $21)
       returning *`,
      [
        actor.clinicId,
        d.docNumber,
        d.docType,
        d.lastName,
        d.firstName,
        d.birthDate ?? null,
        d.birthPlace ?? null,
        d.sex ?? null,
        d.maritalStatus ?? null,
        d.educationLevel ?? null,
        d.occupation ?? null,
        d.address ?? null,
        d.phone ? normalizePhonePE(d.phone) : null,
        d.email ?? null,
        d.guardianName ?? null,
        d.guardianPhone ? normalizePhonePE(d.guardianPhone) : null,
        d.whatsappOptIn,
        actor.kind === "user" ? actor.membershipId : null,
        d.religion ?? null,
        d.race ?? null,
        d.originPlace ?? null,
      ],
    );
    return toPatient(rows[0]);
  } catch (error) {
    if ((error as { code?: string }).code === "23505") throw new DuplicatePatientError();
    throw error;
  }
}

export async function createPatient(actor: Actor, input: unknown): Promise<Patient> {
  return runAs(actor, (client) => createPatientInTx(client, actor, input));
}

const COLUMN: Record<string, string> = {
  lastName: "last_name",
  firstName: "first_name",
  birthDate: "birth_date",
  sex: "sex",
  birthPlace: "birth_place",
  maritalStatus: "marital_status",
  educationLevel: "education_level",
  occupation: "occupation",
  address: "address",
  email: "email",
  guardianName: "guardian_name",
  religion: "religion",
  race: "race",
  originPlace: "origin_place",
};

export async function updatePatient(actor: Actor, id: string, patch: unknown): Promise<Patient> {
  const d = patientPatch.parse(patch);
  const sets: string[] = [];
  const values: unknown[] = [id, actor.clinicId];
  const add = (column: string, value: unknown) => {
    values.push(value);
    sets.push(`${column} = $${values.length}`);
  };
  for (const [key, column] of Object.entries(COLUMN)) {
    const value = (d as Record<string, unknown>)[key];
    if (value !== undefined) add(column, value);
  }
  if (d.phone !== undefined) add("phone_e164", normalizePhonePE(d.phone));
  if (d.guardianPhone !== undefined) add("guardian_phone_e164", normalizePhonePE(d.guardianPhone));
  if (d.whatsappOptIn !== undefined) {
    add("whatsapp_opt_in", d.whatsappOptIn);
    sets.push(
      d.whatsappOptIn
        ? "whatsapp_opt_in_at = coalesce(whatsapp_opt_in_at, now())"
        : "whatsapp_opt_in_at = null",
    );
  }
  return runAs(actor, async (client) => {
    if (sets.length === 0) {
      const { rows } = await client.query(
        "select * from patients where id = $1 and clinic_id = $2",
        values,
      );
      if (!rows[0]) throw new Error("patient not found");
      return toPatient(rows[0]);
    }
    const { rows } = await client.query(
      `update patients set ${sets.join(", ")} where id = $1 and clinic_id = $2 returning *`,
      values,
    );
    if (!rows[0]) throw new Error("patient not found");
    return toPatient(rows[0]);
  });
}

export async function archivePatient(actor: Actor, id: string): Promise<void> {
  await runAs(actor, (client) =>
    client.query(
      "update patients set archived_at = coalesce(archived_at, now()) where id = $1 and clinic_id = $2",
      [id, actor.clinicId],
    ),
  );
}

export async function getPatient(actor: Actor, id: string): Promise<Patient | null> {
  return runAs(actor, async (client) => {
    const { rows } = await client.query("select * from patients where id = $1 and clinic_id = $2", [
      id,
      actor.clinicId,
    ]);
    return rows[0] ? toPatient(rows[0]) : null;
  });
}

export async function searchPatients(
  actor: Actor,
  opts: { q?: string; includeArchived?: boolean; limit?: number } = {},
): Promise<Patient[]> {
  const q = opts.q?.trim();
  const like = q ? `%${q.replace(/[\\%_]/g, "\\$&")}%` : null;
  return runAs(actor, async (client) => {
    const { rows } = await client.query(
      `select * from patients
        where clinic_id = $1
          and ($2::text is null or last_name ilike $2 or first_name ilike $2 or doc_number ilike $2)
          and ($3 or archived_at is null)
        order by last_name, first_name
        limit $4`,
      [actor.clinicId, like, opts.includeArchived ?? false, opts.limit ?? 25],
    );
    return rows.map(toPatient);
  });
}
