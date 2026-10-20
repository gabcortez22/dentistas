import { Alert, buttonClass, Card, inputClass } from "@/app/_components/ui";
import { listMembers } from "@/server/clinics";
import { getWeeklyRules } from "@/server/schedules";
import { requireSession, userActor } from "@/server/session";
import { blockAction, saveRulesAction } from "./actions";

const DAYS = ["Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado", "Domingo"];

export default async function HorariosPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; ok?: string; dentista?: string }>;
}) {
  const { error, ok, dentista } = await searchParams;
  const ctx = await requireSession();
  const actor = userActor(ctx);
  const members = (await listMembers(actor)).filter((m) => m.role === "dentist" && m.active);
  const editable =
    ctx.role === "admin" ? members : members.filter((m) => m.id === ctx.membershipId);
  const selected = editable.find((m) => m.id === dentista) ?? editable[0];
  const rules = selected ? await getWeeklyRules(actor, selected.id) : [];
  return (
    <div className="max-w-3xl space-y-6">
      <h1 className="text-3xl font-semibold text-brand">Horarios</h1>
      {error ? <Alert>{error}</Alert> : null}
      {ok ? (
        <p role="status" className="text-ok">
          Guardado.
        </p>
      ) : null}
      {!selected ? (
        <p className="text-ink-muted">No tienes un dentista cuyo horario puedas editar.</p>
      ) : (
        <>
          {ctx.role === "admin" ? (
            <form className="flex flex-wrap items-end gap-3">
              <div>
                <label htmlFor="dentista" className="block text-sm font-medium">
                  Dentista
                </label>
                <select
                  id="dentista"
                  name="dentista"
                  defaultValue={selected.id}
                  className={inputClass}
                >
                  {editable.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.displayName}
                    </option>
                  ))}
                </select>
              </div>
              <button type="submit" className={buttonClass}>
                Ver
              </button>
            </form>
          ) : null}
          <Card title={`Horario semanal de ${selected.displayName} (hora de Lima)`}>
            <form action={saveRulesAction} className="space-y-3">
              <input type="hidden" name="membershipId" value={selected.id} />
              {DAYS.map((label, i) => {
                const weekday = i + 1;
                const day = rules.filter((r) => r.weekday === weekday);
                return (
                  <fieldset key={label} className="grid items-center gap-2 sm:grid-cols-5">
                    <legend className="sr-only">{label}</legend>
                    <span className="font-medium">{label}</span>
                    {[1, 2].map((n) => (
                      <span key={n} className="flex items-center gap-1">
                        <label className="sr-only" htmlFor={`d${weekday}s${n}`}>
                          {label} franja {n} inicio
                        </label>
                        <input
                          id={`d${weekday}s${n}`}
                          name={`d${weekday}s${n}`}
                          type="time"
                          defaultValue={day[n - 1]?.startTime ?? ""}
                          className={inputClass}
                        />
                        <span aria-hidden="true">–</span>
                        <label className="sr-only" htmlFor={`d${weekday}e${n}`}>
                          {label} franja {n} fin
                        </label>
                        <input
                          id={`d${weekday}e${n}`}
                          name={`d${weekday}e${n}`}
                          type="time"
                          defaultValue={day[n - 1]?.endTime ?? ""}
                          className={inputClass}
                        />
                      </span>
                    ))}
                  </fieldset>
                );
              })}
              <button type="submit" className={buttonClass}>
                Guardar horario
              </button>
            </form>
          </Card>
          <Card title="Bloquear horario (vacaciones, permisos)">
            <form action={blockAction} className="grid gap-3 sm:grid-cols-2">
              <input type="hidden" name="membershipId" value={selected.id} />
              <div>
                <label htmlFor="startsAt" className="block text-sm font-medium">
                  Desde
                </label>
                <input
                  id="startsAt"
                  name="startsAt"
                  type="datetime-local"
                  required
                  className={inputClass}
                />
              </div>
              <div>
                <label htmlFor="endsAt" className="block text-sm font-medium">
                  Hasta
                </label>
                <input
                  id="endsAt"
                  name="endsAt"
                  type="datetime-local"
                  required
                  className={inputClass}
                />
              </div>
              <div className="sm:col-span-2">
                <label htmlFor="reason" className="block text-sm font-medium">
                  Motivo
                </label>
                <input id="reason" name="reason" className={inputClass} />
              </div>
              <button type="submit" className={buttonClass}>
                Bloquear
              </button>
            </form>
          </Card>
        </>
      )}
    </div>
  );
}
