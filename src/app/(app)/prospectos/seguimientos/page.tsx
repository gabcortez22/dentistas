import { DateTime } from "luxon";
import Link from "next/link";
import { formatDateTime } from "@/app/_components/format";
import { Alert, Card, Empty, secondaryButtonClass } from "@/app/_components/ui";
import { listDueFollowups } from "@/server/prospects";
import { requireSession, userActor } from "@/server/session";
import { completeFollowupAction } from "../actions";

export default async function SeguimientosPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  const ctx = await requireSession();
  const endOfToday = DateTime.now().setZone("America/Lima").endOf("day").toJSDate();
  const tasks = await listDueFollowups(userActor(ctx), { upTo: endOfToday });
  return (
    <div className="max-w-3xl space-y-6">
      <h1 className="text-3xl font-semibold text-brand">Seguimientos del día</h1>
      {error ? <Alert>{error}</Alert> : null}
      <Card>
        {tasks.length === 0 ? (
          <Empty>No hay seguimientos pendientes para hoy.</Empty>
        ) : (
          <ul className="space-y-3">
            {tasks.map((t) => (
              <li
                key={t.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-control border border-line p-3"
              >
                <div>
                  <Link
                    href={`/prospectos/${t.prospectId}`}
                    className="font-medium text-brand underline"
                  >
                    {t.prospectName}
                  </Link>
                  <p className="text-sm text-ink-muted">
                    {formatDateTime(t.dueAt)} · {t.kind}
                    {t.note ? ` · ${t.note}` : ""}
                  </p>
                </div>
                <form action={completeFollowupAction}>
                  <input type="hidden" name="taskId" value={t.id} />
                  <button type="submit" className={secondaryButtonClass}>
                    Marcar hecho
                  </button>
                </form>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
