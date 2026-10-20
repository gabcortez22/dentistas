import Link from "next/link";
import { notFound } from "next/navigation";
import { Card, secondaryButtonClass } from "@/app/_components/ui";
import { getPatient } from "@/server/patients";
import { requireSession, userActor } from "@/server/session";
import { archivePatientAction } from "../actions";

export default async function PacientePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requireSession();
  const p = await getPatient(userActor(ctx), id);
  if (!p) notFound();
  const rows: Array<[string, string | null]> = [
    ["Documento", `${p.docType} ${p.docNumber}`],
    ["N° de historia clínica", p.hcNumber],
    ["Fecha de nacimiento", p.birthDate],
    ["Teléfono", p.phoneE164],
    ["Correo", p.email],
    ["Dirección", p.address],
    ["Recordatorios por WhatsApp", p.whatsappOptIn ? "Sí" : "No"],
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
