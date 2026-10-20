import { Card, Empty } from "@/app/_components/ui";
import { formatPEN } from "@/lib/money";
import { monthlySummary } from "@/server/expenses";
import { ForbiddenError, requireSession, userActor } from "@/server/session";

export default async function ResumenPage() {
  const ctx = await requireSession();
  let rows: Awaited<ReturnType<typeof monthlySummary>>;
  try {
    rows = await monthlySummary(userActor(ctx));
  } catch (e) {
    if (e instanceof ForbiddenError)
      return (
        <p role="alert" className="text-danger">
          Solo la administración puede ver esta sección.
        </p>
      );
    throw e;
  }
  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-semibold text-brand">Resumen mensual</h1>
      <p className="text-ink-muted">
        Ingresos (cobros no anulados) menos gastos (no anulados), por mes calendario de Lima.
      </p>
      {rows.length === 0 ? (
        <Empty>Aún no hay movimientos.</Empty>
      ) : (
        <Card>
          <table className="w-full text-left text-sm">
            <caption className="sr-only">Resumen de los últimos 12 meses</caption>
            <thead>
              <tr className="border-b border-line">
                <th scope="col" className="py-2">
                  Mes
                </th>
                <th scope="col">Ingresos</th>
                <th scope="col">Gastos</th>
                <th scope="col">Neto</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.month} className="border-b border-line">
                  <td className="py-3">{r.month}</td>
                  <td>{formatPEN(r.incomeCents)}</td>
                  <td>{formatPEN(r.expenseCents)}</td>
                  <td className={r.netCents < 0 ? "text-danger" : "text-ok"}>
                    {r.netCents < 0 ? "− " : "+ "}
                    {formatPEN(Math.abs(r.netCents))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}
