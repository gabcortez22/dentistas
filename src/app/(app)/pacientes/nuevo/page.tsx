import { Alert, buttonClass } from "@/app/_components/ui";
import { PatientFields } from "../_components/patient-fields";
import { createPatientAction } from "../actions";

export default async function NuevoPacientePage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  return (
    <div className="max-w-3xl space-y-6">
      <h1 className="text-3xl font-semibold text-brand">Nuevo paciente</h1>
      {error ? <Alert>{error}</Alert> : null}
      <form action={createPatientAction} className="space-y-6">
        <PatientFields />
        <button type="submit" className={buttonClass}>
          Guardar paciente
        </button>
      </form>
    </div>
  );
}
