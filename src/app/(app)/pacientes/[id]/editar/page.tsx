import Link from "next/link";
import { notFound } from "next/navigation";
import { Alert, buttonClass, secondaryButtonClass } from "@/app/_components/ui";
import { getPatient } from "@/server/patients";
import { requireSession, userActor } from "@/server/session";
import { PatientFields } from "../../_components/patient-fields";
import { updatePatientAction } from "../../actions";

export default async function EditarPacientePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { id } = await params;
  const { error } = await searchParams;
  const ctx = await requireSession();
  const patient = await getPatient(userActor(ctx), id);
  if (!patient) notFound();
  return (
    <div className="max-w-3xl space-y-6">
      <h1 className="text-3xl font-semibold text-brand">Editar paciente</h1>
      <p className="text-ink-muted">
        {patient.docType} {patient.docNumber} · HC {patient.hcNumber} (no se pueden modificar)
      </p>
      {error ? <Alert>{error}</Alert> : null}
      <form action={updatePatientAction} className="space-y-6">
        <input type="hidden" name="id" value={patient.id} />
        <PatientFields patient={patient} />
        <div className="flex flex-wrap gap-3">
          <button type="submit" className={buttonClass}>
            Guardar cambios
          </button>
          <Link
            href={`/pacientes/${patient.id}`}
            className={`${secondaryButtonClass} inline-flex items-center`}
          >
            Cancelar
          </Link>
        </div>
      </form>
    </div>
  );
}
