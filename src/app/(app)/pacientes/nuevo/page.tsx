import Link from "next/link";
import { Alert, buttonClass, Card } from "@/app/_components/ui";
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
        <Card title="Datos personales y privacidad">
          <div className="flex items-start gap-2">
            <input
              id="dataConsent"
              name="dataConsent"
              type="checkbox"
              required
              className="mt-1 size-5"
            />
            <label htmlFor="dataConsent">
              El paciente fue informado y autoriza el tratamiento de sus datos personales y de salud
              según la{" "}
              <Link href="/privacidad" target="_blank" className="text-brand underline">
                política de privacidad
              </Link>
              .
            </label>
          </div>
        </Card>
        <button type="submit" className={buttonClass}>
          Guardar paciente
        </button>
      </form>
    </div>
  );
}
