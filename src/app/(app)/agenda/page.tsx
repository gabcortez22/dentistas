import Link from "next/link";
import { formatDay, formatTime } from "@/app/_components/format";
import { buttonClass, Card, Empty, inputClass, secondaryButtonClass } from "@/app/_components/ui";
import { weekStart } from "@/server/agenda-helpers";
import { listAppointments } from "@/server/appointments";
import { listMembers } from "@/server/clinics";
import { requireSession, userActor } from "@/server/session";
import { cancelAction } from "./actions";

export default async function AgendaPage({
  searchParams,
}: {
  searchParams: Promise<{ semana?: string; dentista?: string }>;
}) {
  const { semana, dentista } = await searchParams;
  const ctx = await requireSession();
  const actor = userActor(ctx);
  const start = weekStart(semana);
  const [appointments, members] = await Promise.all([
    listAppointments(actor, {
      from: start.toJSDate(),
      to: start.plus({ days: 7 }).toJSDate(),
      membershipId: dentista || undefined,
    }),
    listMembers(actor),
  ]);
  const dentists = members.filter((m) => m.role === "dentist" && m.active);
  const days = Array.from({ length: 7 }, (_, i) => start.plus({ days: i }));
  const prev = start.minus({ days: 7 }).toISODate();
  const next = start.plus({ days: 7 }).toISODate();
  const q = (week: string | null) => `?semana=${week}${dentista ? `&dentista=${dentista}` : ""}`;
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <h1 className="text-3xl font-semibold text-brand">Agenda</h1>
        <Link href="/agenda/nueva" className={`${buttonClass} inline-flex items-center`}>
          Nueva cita
        </Link>
      </div>
      <form className="flex flex-wrap items-end gap-3">
        <input type="hidden" name="semana" value={start.toISODate() ?? ""} />
        <div>
          <label htmlFor="dentista" className="block text-sm font-medium">
            Dentista
          </label>
          <select
            id="dentista"
            name="dentista"
            defaultValue={dentista ?? ""}
            className={inputClass}
          >
            <option value="">Todos</option>
            {dentists.map((d) => (
              <option key={d.id} value={d.id}>
                {d.displayName}
              </option>
            ))}
          </select>
        </div>
        <button type="submit" className={secondaryButtonClass}>
          Filtrar
        </button>
        <Link href={q(prev)} className={`${secondaryButtonClass} inline-flex items-center`}>
          ← Semana anterior
        </Link>
        <Link href={q(next)} className={`${secondaryButtonClass} inline-flex items-center`}>
          Semana siguiente →
        </Link>
      </form>
      <p className="text-sm text-ink-muted">Horas en hora de Lima.</p>
      <div className="grid gap-4 lg:grid-cols-7">
        {days.map((day) => {
          const items = appointments.filter(
            (a) =>
              a.status === "confirmed" &&
              new Date(a.startsAt) >= day.toJSDate() &&
              new Date(a.startsAt) < day.plus({ days: 1 }).toJSDate(),
          );
          return (
            <Card key={day.toISODate()} title={formatDay(day.toJSDate())}>
              {items.length === 0 ? (
                <Empty>Sin citas</Empty>
              ) : (
                <ul className="space-y-3">
                  {items.map((a) => (
                    <li key={a.id} className="rounded-control border border-line p-2 text-sm">
                      <p className="font-medium">
                        {formatTime(a.startsAt)}–{formatTime(a.endsAt)}
                      </p>
                      <p>{a.patientName}</p>
                      <p className="text-ink-muted">
                        {a.dentistName}
                        {a.reason ? ` · ${a.reason}` : ""}
                      </p>
                      <div className="mt-2 flex flex-wrap gap-2">
                        <Link
                          href={`/agenda/${a.id}/reprogramar`}
                          className="min-h-11 py-2 text-brand underline"
                        >
                          Reprogramar
                        </Link>
                        <form action={cancelAction}>
                          <input type="hidden" name="id" value={a.id} />
                          <button type="submit" className="min-h-11 text-danger underline">
                            Cancelar
                          </button>
                        </form>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          );
        })}
      </div>
    </div>
  );
}
