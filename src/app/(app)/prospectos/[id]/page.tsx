import Link from "next/link";
import { notFound } from "next/navigation";
import { formatDateTime } from "@/app/_components/format";
import {
  Alert,
  buttonClass,
  Card,
  Field,
  inputClass,
  secondaryButtonClass,
} from "@/app/_components/ui";
import { getProspect, STAGES } from "@/server/prospects";
import { requireSession, userActor } from "@/server/session";
import { addNoteAction, convertAction, moveStageAction, scheduleFollowupAction } from "../actions";

const STAGE_LABEL: Record<string, string> = {
  new: "Nuevo",
  contacted: "Contactado",
  appointment_booked: "Cita agendada",
  quoted: "Cotizado",
  won: "Ganado",
  lost: "Perdido",
};
const KIND_LABEL: Record<string, string> = {
  created: "Creado",
  stage_change: "Cambio de etapa",
  note: "Nota",
  contact_attempt: "Intento de contacto",
  converted: "Convertido en paciente",
  auto: "Automático",
};

function describe(kind: string, body: Record<string, unknown>): string {
  if (kind === "note") return String(body.text ?? "");
  if (kind === "stage_change")
    return `${STAGE_LABEL[String(body.from)] ?? body.from} → ${STAGE_LABEL[String(body.to)] ?? body.to}${body.reason ? ` (${body.reason})` : ""}`;
  if (kind === "auto") return `Etapa: ${STAGE_LABEL[String(body.to)] ?? body.to} (${body.reason})`;
  if (kind === "contact_attempt") return `Canal: ${body.channel}`;
  return "";
}

export default async function ProspectoPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { id } = await params;
  const { error } = await searchParams;
  const ctx = await requireSession();
  const data = await getProspect(userActor(ctx), id);
  if (!data) notFound();
  const { prospect, events, tasks } = data;
  return (
    <div className="max-w-3xl space-y-6">
      <h1 className="text-3xl font-semibold text-brand">{prospect.name}</h1>
      {error ? <Alert>{error}</Alert> : null}
      <Card title="Datos">
        <dl className="grid gap-3 sm:grid-cols-2">
          <div>
            <dt className="text-sm text-ink-muted">Etapa</dt>
            <dd>
              {STAGE_LABEL[prospect.stage]}
              {prospect.lostReason ? ` — ${prospect.lostReason}` : ""}
            </dd>
          </div>
          <div>
            <dt className="text-sm text-ink-muted">Teléfono</dt>
            <dd>{prospect.phoneE164 ?? "—"}</dd>
          </div>
          <div>
            <dt className="text-sm text-ink-muted">Origen</dt>
            <dd>{prospect.source}</dd>
          </div>
          <div>
            <dt className="text-sm text-ink-muted">Interés</dt>
            <dd>{prospect.interest ?? "—"}</dd>
          </div>
          <div>
            <dt className="text-sm text-ink-muted">Mensajes por WhatsApp</dt>
            <dd>{prospect.whatsappOptIn ? "Con consentimiento" : "Sin consentimiento"}</dd>
          </div>
        </dl>
        {prospect.patientId ? (
          <p className="mt-3">
            <Link className="text-brand underline" href={`/pacientes/${prospect.patientId}`}>
              Ver ficha del paciente
            </Link>
          </p>
        ) : null}
      </Card>
      <Card title="Cambiar de etapa">
        <form action={moveStageAction} className="flex flex-wrap items-end gap-3">
          <input type="hidden" name="id" value={prospect.id} />
          <div>
            <label htmlFor="stage" className="block text-sm font-medium">
              Etapa
            </label>
            <select id="stage" name="stage" defaultValue={prospect.stage} className={inputClass}>
              {STAGES.map((s) => (
                <option key={s} value={s}>
                  {STAGE_LABEL[s]}
                </option>
              ))}
            </select>
          </div>
          <Field label="Motivo (obligatorio si se pierde)" name="lostReason" />
          <button type="submit" className={secondaryButtonClass}>
            Guardar etapa
          </button>
        </form>
      </Card>
      <div className="grid gap-6 sm:grid-cols-2">
        <Card title="Agregar nota">
          <form action={addNoteAction} className="space-y-3">
            <input type="hidden" name="id" value={prospect.id} />
            <Field label="Nota" name="text" required />
            <button type="submit" className={secondaryButtonClass}>
              Guardar nota
            </button>
          </form>
        </Card>
        <Card title="Programar seguimiento (hora de Lima)">
          <form action={scheduleFollowupAction} className="space-y-3">
            <input type="hidden" name="id" value={prospect.id} />
            <Field label="Fecha y hora" name="dueAt" type="datetime-local" required />
            <div>
              <label htmlFor="kind" className="block text-sm font-medium">
                Tipo
              </label>
              <select id="kind" name="kind" className={inputClass}>
                <option value="call">Llamada</option>
                <option value="whatsapp">WhatsApp</option>
                <option value="other">Otro</option>
              </select>
            </div>
            <Field label="Nota" name="note" />
            <button type="submit" className={secondaryButtonClass}>
              Programar
            </button>
          </form>
        </Card>
      </div>
      {tasks.length > 0 ? (
        <Card title="Seguimientos">
          <ul className="space-y-1 text-sm">
            {tasks.map((t) => (
              <li key={t.id}>
                {formatDateTime(t.dueAt)} · {t.kind} ·{" "}
                {t.status === "pending" ? "pendiente" : t.status === "done" ? "hecho" : "cancelado"}
                {t.note ? ` · ${t.note}` : ""}
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
      {!prospect.patientId ? (
        <Card title="Convertir en paciente">
          <form action={convertAction} className="grid gap-4 sm:grid-cols-2">
            <input type="hidden" name="id" value={prospect.id} />
            <div>
              <label htmlFor="docType" className="block text-sm font-medium">
                Tipo de documento
              </label>
              <select id="docType" name="docType" className={inputClass}>
                <option value="DNI">DNI</option>
                <option value="CE">Carné de extranjería</option>
                <option value="PASAPORTE">Pasaporte</option>
                <option value="OTRO">Otro</option>
              </select>
            </div>
            <Field label="Número de documento" name="docNumber" required />
            <Field label="Apellidos" name="lastName" required />
            <Field label="Nombres" name="firstName" required defaultValue={prospect.name} />
            <button type="submit" className={`${buttonClass} sm:col-span-2`}>
              Crear paciente
            </button>
          </form>
        </Card>
      ) : null}
      <Card title="Historial">
        <ol className="space-y-2">
          {events.map((e) => (
            <li key={e.id} className="rounded-control border border-line p-2 text-sm">
              <p className="text-ink-muted">
                {KIND_LABEL[e.kind] ?? e.kind} · {e.authorName ?? "Sistema"} ·{" "}
                {formatDateTime(e.createdAt)}
              </p>
              <p className="whitespace-pre-wrap">{describe(e.kind, e.body)}</p>
            </li>
          ))}
        </ol>
      </Card>
    </div>
  );
}
