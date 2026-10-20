import { notFound } from "next/navigation";
import { formatDateTime, formatTime } from "@/app/_components/format";
import {
  Alert,
  buttonClass,
  Card,
  Empty,
  inputClass,
  secondaryButtonClass,
} from "@/app/_components/ui";
import { dayBounds } from "@/server/agenda-helpers";
import { listAppointments } from "@/server/appointments";
import { loadSlots } from "@/server/availability";
import { requireSession, userActor } from "@/server/session";
import { rescheduleAction } from "../../actions";

export default async function ReprogramarPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string; fecha?: string }>;
}) {
  const { id } = await params;
  const { error, fecha } = await searchParams;
  const ctx = await requireSession();
  const actor = userActor(ctx);
  const wide = await listAppointments(actor, {
    from: new Date(Date.now() - 365 * 864e5),
    to: new Date(Date.now() + 365 * 864e5),
  });
  const appointment = wide.find((a) => a.id === id && a.status === "confirmed");
  if (!appointment) notFound();
  const minutes = Math.round(
    (appointment.endsAt.getTime() - appointment.startsAt.getTime()) / 60_000,
  );
  const bounds = fecha ? dayBounds(fecha) : null;
  const slots = bounds
    ? await loadSlots(actor, {
        membershipId: appointment.membershipId,
        ...bounds,
        durationMinutes: minutes,
      })
    : [];
  return (
    <div className="max-w-3xl space-y-6">
      <h1 className="text-3xl font-semibold text-brand">Reprogramar cita</h1>
      <p>
        {appointment.patientName} con {appointment.dentistName}:{" "}
        {formatDateTime(appointment.startsAt)} (hora de Lima).
      </p>
      {error ? <Alert>{error}</Alert> : null}
      <Card title="Nuevo día">
        <form className="flex flex-wrap items-end gap-3">
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
          <button type="submit" className={secondaryButtonClass}>
            Ver horarios
          </button>
        </form>
      </Card>
      {fecha ? (
        <Card title="Horarios libres (hora de Lima)">
          {slots.length === 0 ? (
            <Empty>No hay horarios libres ese día.</Empty>
          ) : (
            <form action={rescheduleAction} className="space-y-4">
              <input type="hidden" name="id" value={appointment.id} />
              <input type="hidden" name="minutes" value={minutes} />
              <div className="flex flex-wrap gap-2">
                {slots.map((s) => (
                  <label
                    key={s.startsAt.toISOString()}
                    className="flex min-h-11 items-center gap-2 rounded-control border border-line px-3"
                  >
                    <input type="radio" name="startsAt" value={s.startsAt.toISOString()} required />
                    {formatTime(s.startsAt)}
                  </label>
                ))}
              </div>
              <button type="submit" className={buttonClass}>
                Reprogramar
              </button>
            </form>
          )}
        </Card>
      ) : null}
    </div>
  );
}
