import { formatTime } from "@/app/_components/format";
import {
  Alert,
  buttonClass,
  Card,
  Empty,
  inputClass,
  secondaryButtonClass,
} from "@/app/_components/ui";
import { dayBounds } from "@/server/agenda-helpers";
import { loadSlots } from "@/server/availability";
import { listMembers } from "@/server/clinics";
import { searchPatients } from "@/server/patients";
import { requireSession, userActor } from "@/server/session";
import { bookAction } from "../actions";

export default async function NuevaCitaPage({
  searchParams,
}: {
  searchParams: Promise<{
    error?: string;
    dentista?: string;
    fecha?: string;
    minutos?: string;
    q?: string;
  }>;
}) {
  const { error, dentista, fecha, minutos, q } = await searchParams;
  const ctx = await requireSession();
  const actor = userActor(ctx);
  const members = await listMembers(actor);
  const dentists = members.filter((m) => m.role === "dentist" && m.active);
  const minutes = Math.min(480, Math.max(5, Number(minutos) || 30));
  const bounds = fecha ? dayBounds(fecha) : null;
  const slots =
    dentista && bounds
      ? await loadSlots(actor, { membershipId: dentista, ...bounds, durationMinutes: minutes })
      : [];
  const patients = q ? await searchPatients(actor, { q, limit: 10 }) : [];
  return (
    <div className="max-w-3xl space-y-6">
      <h1 className="text-3xl font-semibold text-brand">Nueva cita</h1>
      {error ? <Alert>{error}</Alert> : null}
      <Card title="1. Buscar horarios">
        <form className="grid gap-3 sm:grid-cols-4">
          <div>
            <label htmlFor="dentista" className="block text-sm font-medium">
              Dentista
            </label>
            <select
              id="dentista"
              name="dentista"
              defaultValue={dentista ?? ""}
              required
              className={inputClass}
            >
              <option value="">Elegir…</option>
              {dentists.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.displayName}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="fecha" className="block text-sm font-medium">
              Fecha
            </label>
            <input
              id="fecha"
              name="fecha"
              type="date"
              defaultValue={fecha ?? ""}
              required
              className={inputClass}
            />
          </div>
          <div>
            <label htmlFor="minutos" className="block text-sm font-medium">
              Duración (min)
            </label>
            <input
              id="minutos"
              name="minutos"
              type="number"
              min={5}
              max={480}
              defaultValue={minutes}
              className={inputClass}
            />
          </div>
          <div>
            <label htmlFor="q" className="block text-sm font-medium">
              Buscar paciente
            </label>
            <input id="q" name="q" type="search" defaultValue={q ?? ""} className={inputClass} />
          </div>
          <button type="submit" className={`${secondaryButtonClass} sm:col-span-4`}>
            Buscar
          </button>
        </form>
      </Card>
      <Card title="2. Confirmar">
        {dentista && fecha ? (
          slots.length === 0 ? (
            <Empty>No hay horarios libres ese día. Prueba otra fecha.</Empty>
          ) : (
            <form action={bookAction} className="space-y-4">
              <input type="hidden" name="dentistId" value={dentista} />
              <input type="hidden" name="minutes" value={minutes} />
              <fieldset>
                <legend className="text-sm font-medium">Horarios libres (hora de Lima)</legend>
                <div className="mt-2 flex flex-wrap gap-2">
                  {slots.map((s) => (
                    <label
                      key={s.startsAt.toISOString()}
                      className="flex min-h-11 items-center gap-2 rounded-control border border-line px-3"
                    >
                      <input
                        type="radio"
                        name="startsAt"
                        value={s.startsAt.toISOString()}
                        required
                      />
                      {formatTime(s.startsAt)}
                    </label>
                  ))}
                </div>
              </fieldset>
              <div>
                <label htmlFor="patientId" className="block text-sm font-medium">
                  Paciente
                </label>
                <select id="patientId" name="patientId" required className={inputClass}>
                  <option value="">{q ? "Elegir…" : "Primero busca un paciente arriba"}</option>
                  {patients.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.lastName}, {p.firstName} ({p.docNumber})
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label htmlFor="reason" className="block text-sm font-medium">
                  Motivo
                </label>
                <input id="reason" name="reason" className={inputClass} />
              </div>
              <button type="submit" className={buttonClass}>
                Agendar cita
              </button>
            </form>
          )
        ) : (
          <Empty>Elige dentista y fecha para ver los horarios.</Empty>
        )}
      </Card>
    </div>
  );
}
