import { Alert, buttonClass, Card, Empty, Field, inputClass } from "@/app/_components/ui";
import { formatPEN } from "@/lib/money";
import { listExpenses } from "@/server/expenses";
import { ForbiddenError, requireSession, userActor } from "@/server/session";
import { recordExpenseAction, voidExpenseAction } from "./actions";

const CATEGORY = [
  "insumos",
  "laboratorio",
  "alquiler",
  "sueldos",
  "servicios",
  "marketing",
  "otros",
];
const METHOD: Record<string, string> = {
  cash: "Efectivo",
  yape: "Yape",
  plin: "Plin",
  card: "Tarjeta",
  transfer: "Transferencia",
};

export default async function GastosPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; mes?: string }>;
}) {
  const { error, mes } = await searchParams;
  const ctx = await requireSession();
  let expenses: Awaited<ReturnType<typeof listExpenses>>;
  try {
    expenses = await listExpenses(userActor(ctx), { month: mes || undefined });
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
      <h1 className="text-3xl font-semibold text-brand">Gastos</h1>
      {error ? <Alert>{error}</Alert> : null}
      <Card title="Registrar gasto">
        <form action={recordExpenseAction} className="grid gap-4 sm:grid-cols-3">
          <div>
            <label htmlFor="category" className="block text-sm font-medium">
              Categoría
            </label>
            <select id="category" name="category" className={inputClass}>
              {CATEGORY.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>
          <Field label="Proveedor" name="supplier" />
          <Field label="Descripción" name="description" required />
          <Field label="Monto (S/)" name="amount" required />
          <div>
            <label htmlFor="method" className="block text-sm font-medium">
              Método de pago
            </label>
            <select id="method" name="method" className={inputClass}>
              {Object.entries(METHOD).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
          </div>
          <Field label="Fecha" name="incurredOn" type="date" required />
          <Field label="Comprobante (nota)" name="receiptNote" />
          <button type="submit" className={`${buttonClass} sm:col-span-3`}>
            Registrar gasto
          </button>
        </form>
      </Card>
      <form className="flex flex-wrap items-end gap-3">
        <Field label="Mes (AAAA-MM)" name="mes" defaultValue={mes ?? ""} />
        <button type="submit" className="min-h-11 rounded-control border border-line px-4">
          Filtrar
        </button>
      </form>
      <Card title="Gastos">
        {expenses.length === 0 ? (
          <Empty>Aún no hay gastos.</Empty>
        ) : (
          <table className="w-full text-left text-sm">
            <caption className="sr-only">Gastos</caption>
            <thead>
              <tr className="border-b border-line">
                <th scope="col" className="py-2">
                  Fecha
                </th>
                <th scope="col">Categoría</th>
                <th scope="col">Descripción</th>
                <th scope="col">Monto</th>
                <th scope="col">Estado</th>
              </tr>
            </thead>
            <tbody>
              {expenses.map((e) => (
                <tr key={e.id} className="border-b border-line">
                  <td className="py-3">{e.incurredOn}</td>
                  <td>{e.category}</td>
                  <td>
                    {e.description}
                    {e.supplier ? ` (${e.supplier})` : ""}
                  </td>
                  <td className={e.voided ? "line-through" : ""}>{formatPEN(e.amountCents)}</td>
                  <td>
                    {e.voided ? (
                      `Anulado: ${e.voidReason}`
                    ) : (
                      <form action={voidExpenseAction} className="flex items-center gap-2">
                        <input type="hidden" name="id" value={e.id} />
                        <label className="sr-only" htmlFor={`v-${e.id}`}>
                          Motivo de anulación
                        </label>
                        <input
                          id={`v-${e.id}`}
                          name="reason"
                          placeholder="Motivo"
                          required
                          className="min-h-11 rounded-control border border-line px-2"
                        />
                        <button type="submit" className="min-h-11 text-danger underline">
                          Anular
                        </button>
                      </form>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}
