import { formatDateTime } from "@/app/_components/format";
import {
  Alert,
  buttonClass,
  Card,
  Empty,
  Field,
  inputClass,
  secondaryButtonClass,
} from "@/app/_components/ui";
import { formatPEN } from "@/lib/money";
import { listCharges, listQuoteBalances, patientBalance } from "@/server/charges";
import { searchPatients } from "@/server/patients";
import { requireSession, userActor } from "@/server/session";
import { recordChargeAction, voidChargeAction } from "./actions";

const METHOD: Record<string, string> = {
  cash: "Efectivo",
  yape: "Yape",
  plin: "Plin",
  card: "Tarjeta",
  transfer: "Transferencia",
};

export default async function CobrosPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; q?: string; paciente?: string }>;
}) {
  const { error, q, paciente } = await searchParams;
  const ctx = await requireSession();
  const actor = userActor(ctx);
  const [charges, patients] = await Promise.all([
    listCharges(actor, { patientId: paciente || undefined }),
    q ? searchPatients(actor, { q, limit: 10 }) : [],
  ]);
  const balance = paciente ? await patientBalance(actor, paciente) : null;
  const quotes = paciente ? await listQuoteBalances(actor, paciente) : [];
  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-semibold text-brand">Cobros</h1>
      {error ? <Alert>{error}</Alert> : null}
      <form className="flex flex-wrap items-end gap-3">
        <div>
          <label htmlFor="q" className="block text-sm font-medium">
            Buscar paciente
          </label>
          <input id="q" name="q" type="search" defaultValue={q ?? ""} className={inputClass} />
        </div>
        <button type="submit" className={secondaryButtonClass}>
          Buscar
        </button>
        {patients.map((p) => (
          <a
            key={p.id}
            href={`/cobros?paciente=${p.id}`}
            className="min-h-11 py-2 text-brand underline"
          >
            {p.lastName}, {p.firstName}
          </a>
        ))}
      </form>
      {paciente ? (
        <Card title="Registrar cobro">
          {balance ? (
            <p className="mb-3">
              Saldo pendiente del paciente: <strong>{formatPEN(balance.balanceCents)}</strong>
            </p>
          ) : null}
          <form action={recordChargeAction} className="grid gap-4 sm:grid-cols-2">
            <input type="hidden" name="patientId" value={paciente} />
            <div>
              <label htmlFor="quoteId" className="block text-sm font-medium">
                Cotización aceptada (opcional)
              </label>
              <select id="quoteId" name="quoteId" className={inputClass}>
                <option value="">Sin cotización</option>
                {quotes.map((r) => (
                  <option key={r.quoteId} value={r.quoteId}>
                    N° {String(r.number).padStart(6, "0")} — saldo {formatPEN(r.balanceCents)}
                  </option>
                ))}
              </select>
            </div>
            <Field label="Monto (S/)" name="amount" required />
            <div>
              <label htmlFor="method" className="block text-sm font-medium">
                Método
              </label>
              <select id="method" name="method" className={inputClass}>
                {Object.entries(METHOD).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </select>
            </div>
            <Field label="Concepto" name="concept" required />
            <button type="submit" className={`${buttonClass} sm:col-span-2`}>
              Registrar cobro
            </button>
          </form>
        </Card>
      ) : (
        <Empty>Busca un paciente y elígelo para registrar un cobro.</Empty>
      )}
      <Card title="Cobros recientes">
        {charges.length === 0 ? (
          <Empty>Aún no hay cobros.</Empty>
        ) : (
          <table className="w-full text-left text-sm">
            <caption className="sr-only">Cobros</caption>
            <thead>
              <tr className="border-b border-line">
                <th scope="col" className="py-2">
                  Fecha
                </th>
                <th scope="col">Paciente</th>
                <th scope="col">Concepto</th>
                <th scope="col">Método</th>
                <th scope="col">Monto</th>
                <th scope="col">Estado</th>
              </tr>
            </thead>
            <tbody>
              {charges.map((c) => (
                <tr key={c.id} className="border-b border-line">
                  <td className="py-3">{formatDateTime(c.paidAt)}</td>
                  <td>{c.patientName}</td>
                  <td>{c.concept}</td>
                  <td>{METHOD[c.method]}</td>
                  <td className={c.voided ? "line-through" : ""}>{formatPEN(c.amountCents)}</td>
                  <td>
                    {c.voided ? (
                      `Anulado: ${c.voidReason}`
                    ) : ctx.role === "admin" ? (
                      <form action={voidChargeAction} className="flex items-center gap-2">
                        <input type="hidden" name="id" value={c.id} />
                        <label className="sr-only" htmlFor={`r-${c.id}`}>
                          Motivo de anulación
                        </label>
                        <input
                          id={`r-${c.id}`}
                          name="reason"
                          placeholder="Motivo"
                          required
                          className="min-h-11 rounded-control border border-line px-2"
                        />
                        <button type="submit" className="min-h-11 text-danger underline">
                          Anular
                        </button>
                      </form>
                    ) : (
                      "Vigente"
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
