import { Card, Field } from "@/app/_components/ui";
import type { Patient } from "@/server/patients";

const selectClass = "mt-1 min-h-11 w-full rounded-control border border-line bg-surface px-3";

/** Shared by the create and edit forms. With `patient`, the document is read-only on the edit page. */
export function PatientFields({ patient }: { patient?: Patient }) {
  return (
    <>
      {patient ? null : (
        <Card title="Identificación">
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="docType" className="block text-sm font-medium">
                Tipo de documento
              </label>
              <select id="docType" name="docType" className={selectClass}>
                <option value="DNI">DNI</option>
                <option value="CE">Carné de extranjería</option>
                <option value="PASAPORTE">Pasaporte</option>
                <option value="OTRO">Otro</option>
              </select>
            </div>
            <Field label="Número de documento" name="docNumber" required />
          </div>
        </Card>
      )}
      <Card title="Nombre">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label="Apellidos"
            name="lastName"
            required
            autoComplete="family-name"
            defaultValue={patient?.lastName}
          />
          <Field
            label="Nombres"
            name="firstName"
            required
            autoComplete="given-name"
            defaultValue={patient?.firstName}
          />
        </div>
      </Card>
      <Card title="Contacto">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label="Teléfono (celular)"
            name="phone"
            type="tel"
            autoComplete="tel"
            defaultValue={patient?.phoneE164 ?? undefined}
          />
          <Field
            label="Correo electrónico"
            name="email"
            type="email"
            autoComplete="email"
            defaultValue={patient?.email ?? undefined}
          />
          <Field
            label="Dirección"
            name="address"
            autoComplete="street-address"
            defaultValue={patient?.address ?? undefined}
          />
          <Field
            label="Apoderado (menores)"
            name="guardianName"
            defaultValue={patient?.guardianName ?? undefined}
          />
          <Field
            label="Teléfono del apoderado"
            name="guardianPhone"
            type="tel"
            defaultValue={patient?.guardianPhoneE164 ?? undefined}
          />
        </div>
        <div className="mt-4 flex items-center gap-2">
          <input
            id="whatsappOptIn"
            name="whatsappOptIn"
            type="checkbox"
            className="size-5"
            defaultChecked={patient?.whatsappOptIn}
          />
          <label htmlFor="whatsappOptIn">Acepta recordatorios por WhatsApp</label>
        </div>
      </Card>
      <Card title="Datos personales">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label="Fecha de nacimiento"
            name="birthDate"
            type="date"
            defaultValue={patient?.birthDate ?? undefined}
          />
          <div>
            <label htmlFor="sex" className="block text-sm font-medium">
              Sexo
            </label>
            <select id="sex" name="sex" className={selectClass} defaultValue={patient?.sex ?? ""}>
              <option value="">—</option>
              <option value="F">Femenino</option>
              <option value="M">Masculino</option>
            </select>
          </div>
          <Field
            label="Lugar de nacimiento"
            name="birthPlace"
            defaultValue={patient?.birthPlace ?? undefined}
          />
          <Field
            label="Estado civil"
            name="maritalStatus"
            defaultValue={patient?.maritalStatus ?? undefined}
          />
          <Field
            label="Grado de instrucción"
            name="educationLevel"
            defaultValue={patient?.educationLevel ?? undefined}
          />
          <Field
            label="Ocupación"
            name="occupation"
            defaultValue={patient?.occupation ?? undefined}
          />
          <Field label="Religión" name="religion" defaultValue={patient?.religion ?? undefined} />
          <Field label="Raza" name="race" defaultValue={patient?.race ?? undefined} />
          <Field
            label="Lugar de procedencia"
            name="originPlace"
            defaultValue={patient?.originPlace ?? undefined}
          />
        </div>
      </Card>
    </>
  );
}
