import { listCharges } from "./charges";
import { openRecord } from "./clinical";
import { getDataConsent } from "./patient-consent";
import type { UserActor } from "./session";

/**
 * Everything the clinic holds about one patient (Ley 29733, derecho de acceso).
 * Reading it goes through `openRecord`, so it needs a clinical role and leaves a `record_access_log` row.
 */
export async function exportPatientData(actor: UserActor, patientId: string) {
  const { patient, entries, odontogram } = await openRecord(actor, patientId);
  const [consent, charges] = await Promise.all([
    getDataConsent(actor, patientId),
    listCharges(actor, { patientId }),
  ]);
  return {
    exportedAt: new Date().toISOString(),
    patient,
    dataConsent: consent,
    clinicalEntries: entries,
    odontogram,
    charges,
  };
}
