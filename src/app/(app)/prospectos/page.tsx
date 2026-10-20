import Link from "next/link";
import {
  Alert,
  buttonClass,
  Card,
  Empty,
  Field,
  inputClass,
  secondaryButtonClass,
} from "@/app/_components/ui";
import { listProspects, prospectSummary, STAGES } from "@/server/prospects";
import { requireSession, userActor } from "@/server/session";
import { createProspectAction } from "./actions";

const STAGE_LABEL: Record<string, string> = {
  new: "Nuevos",
  contacted: "Contactados",
  appointment_booked: "Cita agendada",
  quoted: "Cotizados",
  won: "Ganados",
  lost: "Perdidos",
};

export default async function ProspectosPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; q?: string }>;
}) {
  const { error, q } = await searchParams;
  const ctx = await requireSession();
  const actor = userActor(ctx);
  const [prospects, summary] = await Promise.all([
    listProspects(actor, { q }),
    prospectSummary(actor),
  ]);
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <h1 className="text-3xl font-semibold text-brand">Prospectos</h1>
        <Link
          href="/prospectos/seguimientos"
          className={`${secondaryButtonClass} inline-flex items-center`}
        >
          Seguimientos del día
        </Link>
      </div>
      {error ? <Alert>{error}</Alert> : null}
      <p className="text-ink-muted">
        Tasa de conversión:{" "}
        {summary.conversionRate === null
          ? "sin prospectos cerrados todavía"
          : `${Math.round(summary.conversionRate * 100)} % (ganados entre ganados y perdidos)`}
        .
      </p>
      <search className="max-w-md">
        <form>
          <label htmlFor="q" className="block text-sm font-medium">
            Buscar por nombre, teléfono o interés
          </label>
          <input id="q" name="q" type="search" defaultValue={q ?? ""} className={inputClass} />
        </form>
      </search>
      <Card title="Nuevo prospecto">
        <form action={createProspectAction} className="grid gap-4 sm:grid-cols-3">
          <Field label="Nombre" name="name" required />
          <Field label="Teléfono (celular)" name="phone" type="tel" />
          <Field label="Correo" name="email" type="email" />
          <div>
            <label htmlFor="source" className="block text-sm font-medium">
              Origen
            </label>
            <select id="source" name="source" className={inputClass}>
              <option value="walk_in">Visita</option>
              <option value="referral">Referido</option>
              <option value="social">Redes sociales</option>
              <option value="web">Web</option>
              <option value="whatsapp">WhatsApp</option>
              <option value="other">Otro</option>
            </select>
          </div>
          <Field label="Interés" name="interest" />
          <div className="flex items-center gap-2 self-end">
            <input id="whatsappOptIn" name="whatsappOptIn" type="checkbox" className="size-5" />
            <label htmlFor="whatsappOptIn">Acepta mensajes de seguimiento por WhatsApp</label>
          </div>
          <button type="submit" className={`${buttonClass} sm:col-span-3`}>
            Crear prospecto
          </button>
        </form>
      </Card>
      {prospects.length === 0 ? (
        <Empty>{q ? "Ningún prospecto coincide con la búsqueda." : "Aún no hay prospectos."}</Empty>
      ) : (
        <div className="grid gap-4 lg:grid-cols-6">
          {STAGES.map((stage) => (
            <Card key={stage} title={`${STAGE_LABEL[stage]} (${summary.byStage[stage]})`}>
              <ul className="space-y-2">
                {prospects
                  .filter((p) => p.stage === stage)
                  .map((p) => (
                    <li key={p.id} className="rounded-control border border-line p-2 text-sm">
                      <Link
                        href={`/prospectos/${p.id}`}
                        className="inline-block min-h-11 py-2 font-medium text-brand underline"
                      >
                        {p.name}
                      </Link>
                      <p className="text-ink-muted">{p.interest ?? p.phoneE164 ?? "—"}</p>
                    </li>
                  ))}
              </ul>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
