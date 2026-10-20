import { Alert, buttonClass, Card, Field } from "@/app/_components/ui";
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
        <Card title="Identificación">
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="docType" className="block text-sm font-medium">
                Tipo de documento
              </label>
              <select
                id="docType"
                name="docType"
                className="mt-1 min-h-11 w-full rounded-control border border-line bg-surface px-3"
              >
                <option value="DNI">DNI</option>
                <option value="CE">Carné de extranjería</option>
                <option value="PASAPORTE">Pasaporte</option>
                <option value="OTRO">Otro</option>
              </select>
            </div>
            <Field label="Número de documento" name="docNumber" required />
            <Field label="Apellidos" name="lastName" required autoComplete="family-name" />
            <Field label="Nombres" name="firstName" required autoComplete="given-name" />
          </div>
        </Card>
        <Card title="Contacto">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Teléfono (celular)" name="phone" type="tel" autoComplete="tel" />
            <Field label="Correo electrónico" name="email" type="email" autoComplete="email" />
            <Field label="Dirección" name="address" autoComplete="street-address" />
            <Field label="Apoderado (menores)" name="guardianName" />
            <Field label="Teléfono del apoderado" name="guardianPhone" type="tel" />
          </div>
          <div className="mt-4 flex items-center gap-2">
            <input id="whatsappOptIn" name="whatsappOptIn" type="checkbox" className="size-5" />
            <label htmlFor="whatsappOptIn">Acepta recordatorios por WhatsApp</label>
          </div>
        </Card>
        <Card title="Datos personales">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Fecha de nacimiento" name="birthDate" type="date" />
            <div>
              <label htmlFor="sex" className="block text-sm font-medium">
                Sexo
              </label>
              <select
                id="sex"
                name="sex"
                className="mt-1 min-h-11 w-full rounded-control border border-line bg-surface px-3"
              >
                <option value="">—</option>
                <option value="F">Femenino</option>
                <option value="M">Masculino</option>
              </select>
            </div>
            <Field label="Lugar de nacimiento" name="birthPlace" />
            <Field label="Estado civil" name="maritalStatus" />
            <Field label="Grado de instrucción" name="educationLevel" />
            <Field label="Ocupación" name="occupation" />
          </div>
        </Card>
        <button type="submit" className={buttonClass}>
          Guardar paciente
        </button>
      </form>
    </div>
  );
}
