import { type Actor, runAs } from "@/lib/db";
import { PRIVACY_POLICY_VERSION } from "@/lib/privacy";

export type DataConsent = { at: Date; version: string };

/** Records the consent once; a later call never overwrites the original date or version. */
export async function recordDataConsent(actor: Actor, patientId: string): Promise<void> {
  await runAs(actor, (client) =>
    client.query(
      `update patients
          set data_consent_at = now(), data_consent_version = $3
        where id = $1 and clinic_id = $2 and data_consent_at is null`,
      [patientId, actor.clinicId, PRIVACY_POLICY_VERSION],
    ),
  );
}

export async function getDataConsent(actor: Actor, patientId: string): Promise<DataConsent | null> {
  return runAs(actor, async (client) => {
    const { rows } = await client.query(
      "select data_consent_at, data_consent_version from patients where id = $1 and clinic_id = $2",
      [patientId, actor.clinicId],
    );
    const row = rows[0];
    if (!row?.data_consent_at) return null;
    return { at: row.data_consent_at as Date, version: row.data_consent_version as string };
  });
}
