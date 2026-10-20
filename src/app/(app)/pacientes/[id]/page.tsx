import Link from "next/link";
import { notFound } from "next/navigation";
import { Card, secondaryButtonClass } from "@/app/_components/ui";
import { getDataConsent } from "@/server/patient-consent";
import { getPatient } from "@/server/patients";
import { requireSession, userActor } from "@/server/session";
import { archivePatientAction, recordDataConsentAction } from "../actions";

export default async function PacientePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requireSession();
  const p = await getPatient(userActor(ctx), id);
  if (!p) notFound();
  const consent = await getDataConsent(userActor(ctx), p.id);
  const rows: Array<[string, string | null]> = [
    ["Documento", `${p.docType} ${p.docNumber}`],
    ["N° de historia clínica", p.hcNumber],
    ["Fecha de nacimiento", p.birthDate],
    ["Teléfono", p.phoneE164],
    ["Correo", p.email],
    ["Domicilio actual", p.address],
    ["Lugar de procedencia", p.originPlace],
    ["Religión", p.religion],
    ["Raza", p.race],
    ["Recordatorios por WhatsApp", p.whatsappOptIn ? "Sí" : "No"],
    [
      "Autorización de datos personales",
      consent
        ? `Otorgada el ${consent.at.toLocaleDateString("es-PE", { timeZone: "America/Lima" })}`
        : "Sin registrar",
    ],
  ];
  return (
    <div className="max-w-3xl space-y-6">
      <h1 className="text-3xl font-semibold text-brand">
        {p.lastName}, {p.firstName}
      </h1>
      {p.archivedAt ? <p className="text-ink-muted">Paciente archivado.</p> : null}
      <Card title="Ficha">
        <dl className="grid gap-3 sm:grid-cols-2">
          {rows.map(([label, value]) => (
            <div key={label}>
              <dt className="text-sm text-ink-muted">{label}</dt>
              <dd>{value ?? "—"}</dd>
            </div>
          ))}
        </dl>
      </Card>
      <div className="flex flex-wrap gap-3">
        {ctx.role !== "assistant" ? (
          <Link
            href={`/pacientes/${p.id}/historia`}
            className={`${secondaryButtonClass} inline-flex items-center`}
          >
            Historia clínica
          </Link>
        ) : null}
        {ctx.role !== "assistant" ? (
          <a
            href={`/api/patients/${p.id}/export`}
            download
            className={`${secondaryButtonClass} inline-flex items-center`}
          >
            Descargar copia de los datos
          </a>
        ) : null}
        {!consent ? (
          <form action={recordDataConsentAction}>
            <input type="hidden" name="id" value={p.id} />
            <button type="submit" className={secondaryButtonClass}>
              Registrar autorización de datos
            </button>
          </form>
        ) : null}
        {!p.archivedAt ? (
          <Link
            href={`/pacientes/${p.id}/editar`}
            className={`${secondaryButtonClass} inline-flex items-center`}
          >
            Editar datos
          </Link>
        ) : null}
        {!p.archivedAt ? (
          <form action={archivePatientAction}>
            <input type="hidden" name="id" value={p.id} />
            <button type="submit" className={secondaryButtonClass}>
              Archivar
            </button>
          </form>
        ) : null}
      </div>
    </div>
  );
}
