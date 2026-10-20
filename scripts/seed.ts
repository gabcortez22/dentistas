import { pathToFileURL } from "node:url";
import { withService } from "@/lib/db";
import { type AuthAdmin, addMember, registerClinic, supabaseAuthAdmin } from "@/server/clinics";
import { createPatient, DuplicatePatientError } from "@/server/patients";
import { saveTreatment } from "@/server/quotes";
import { setWeeklyRules } from "@/server/schedules";
import type { UserActor } from "@/server/session";

const DEFAULT_PASSWORD = process.env.SEED_PASSWORD ?? "demo-1234567890";
const TREATMENTS = [
  ["Consulta", 8000, 30],
  ["Limpieza", 12000, 45],
  ["Resina", 15000, 45],
  ["Extracción", 20000, 60],
  ["Blanqueamiento", 35000, 60],
] as const;
const PEOPLE = [
  { displayName: "Dra. Ana Torres", email: "ana@demo.test", role: "dentist" as const },
  { displayName: "Dr. Luis Paredes", email: "luis@demo.test", role: "dentist" as const },
  { displayName: "Marta Asistente", email: "marta@demo.test", role: "assistant" as const },
];
const SURNAMES = ["Quispe", "Huamán", "Flores", "Mamani", "Rojas", "Castillo", "Vargas", "Salazar"];
const WORKDAY = [1, 2, 3, 4, 5].flatMap((weekday) => [
  { weekday, startTime: "09:00", endTime: "13:00" },
  { weekday, startTime: "15:00", endTime: "18:00" },
]);

/** Idempotent: creates the demo clinic and its data once, and only fills in what is missing on later runs. Fake data only. */
export async function seedDemo(
  auth: AuthAdmin,
  opts: { clinicName?: string } = {},
): Promise<{ clinicId: string }> {
  const name = opts.clinicName ?? "Clínica Demo";
  const existing = await withService(async (client) => {
    const { rows } = await client.query<{ id: string }>(
      "select id from clinics where name = $1 order by created_at limit 1",
      [name],
    );
    return rows[0]?.id ?? null;
  });
  let clinicId: string;
  let admin: UserActor;
  if (existing) {
    clinicId = existing;
    const row = await withService(
      async (client) =>
        (
          await client.query(
            "select user_id, id from memberships where clinic_id = $1 and role = 'admin' and active order by created_at limit 1",
            [clinicId],
          )
        ).rows[0],
    );
    admin = { kind: "user", userId: row.user_id, clinicId, membershipId: row.id };
  } else {
    const created = await registerClinic(
      {
        clinicName: name,
        adminName: "Administración Demo",
        email: "admin@demo.test",
        password: DEFAULT_PASSWORD,
      },
      auth,
    );
    clinicId = created.clinicId;
    admin = { kind: "user", userId: created.userId, clinicId, membershipId: created.membershipId };
  }

  const members = await withService(
    async (client) =>
      (
        await client.query<{ id: string; display_name: string; role: string }>(
          "select id, display_name, role from memberships where clinic_id = $1",
          [clinicId],
        )
      ).rows,
  );
  for (const person of PEOPLE) {
    if (!members.some((m) => m.display_name === person.displayName)) {
      await addMember(admin, "admin", { ...person, password: DEFAULT_PASSWORD }, auth);
    }
  }

  const dentists = await withService(
    async (client) =>
      (
        await client.query<{ id: string }>(
          "select id from memberships where clinic_id = $1 and role = 'dentist' and active order by display_name",
          [clinicId],
        )
      ).rows,
  );
  for (const d of dentists) {
    const has = await withService(
      async (client) =>
        (await client.query("select 1 from availability_rules where membership_id = $1", [d.id]))
          .rowCount,
    );
    if (!has) await setWeeklyRules(admin, "admin", d.id, WORKDAY);
  }

  const treatments = await withService(async (client) =>
    (
      await client.query<{ name: string }>("select name from treatments where clinic_id = $1", [
        clinicId,
      ])
    ).rows.map((r) => r.name),
  );
  for (const [treatment, price, minutes] of TREATMENTS) {
    if (!treatments.includes(treatment))
      await saveTreatment(admin, {
        name: treatment,
        defaultPriceCents: price,
        durationMinutes: minutes,
      });
  }

  for (let i = 1; i <= 8; i++) {
    try {
      await createPatient(admin, {
        docType: "DNI",
        docNumber: String(i).padStart(8, "0"),
        lastName: SURNAMES[i - 1] ?? "Demo",
        firstName: `Paciente ${i}`,
        phone: `90000000${i}`,
      });
    } catch (error) {
      if (!(error instanceof DuplicatePatientError)) throw error;
    }
  }
  return { clinicId };
}

async function main() {
  if (!process.env.SUPABASE_SECRET_KEY) {
    console.error("Define SUPABASE_SECRET_KEY o usa los tests.");
    process.exit(1);
  }
  const { clinicId } = await seedDemo(supabaseAuthAdmin);
  console.log(`Clínica demo lista: ${clinicId} (admin@demo.test)`);
  process.exit(0);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
