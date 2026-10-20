import { notFound } from "next/navigation";
import { Alert, Card, secondaryButtonClass } from "@/app/_components/ui";
import { formatPEN } from "@/lib/money";
import { getQuote } from "@/server/quotes";
import { requireSession, userActor } from "@/server/session";
import { setStatusAction } from "../actions";

const STATUS: Record<string, string> = {
  draft: "Borrador",
  sent: "Enviada",
  accepted: "Aceptada",
  rejected: "Rechazada",
  expired: "Vencida",
};
const NEXT: Record<string, Array<[string, string]>> = {
  draft: [["sent", "Marcar enviada"]],
  sent: [
    ["accepted", "Aceptada"],
    ["rejected", "Rechazada"],
  ],
};

export default async function CotizacionPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { id } = await params;
  const { error } = await searchParams;
  const ctx = await requireSession();
  const data = await getQuote(userActor(ctx), id);
  if (!data) notFound();
  const { quote, items, totals } = data;
  return (
    <div className="max-w-3xl space-y-6">
      <h1 className="text-3xl font-semibold text-brand">
        Cotización {String(quote.number).padStart(6, "0")}
      </h1>
      {error ? <Alert>{error}</Alert> : null}
      <p>
        {quote.patientName} · {STATUS[quote.status]} · vigente hasta {quote.validUntil}
      </p>
      <Card>
        <table className="w-full text-left text-sm">
          <caption className="sr-only">Ítems de la cotización</caption>
          <thead>
            <tr className="border-b border-line">
              <th scope="col" className="py-2">
                Descripción
              </th>
              <th scope="col">Pieza</th>
              <th scope="col">Cant.</th>
              <th scope="col">P. unit.</th>
              <th scope="col">Subtotal</th>
            </tr>
          </thead>
          <tbody>
            {items.map((i) => (
              <tr key={i.id} className="border-b border-line">
                <td className="py-3">{i.description}</td>
                <td>{i.toothFdi ?? "—"}</td>
                <td>{i.quantity}</td>
                <td>{formatPEN(i.unitPriceCents)}</td>
                <td>{formatPEN(i.quantity * i.unitPriceCents)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <dl className="mt-4 space-y-1 text-right">
          <div>
            <dt className="inline">Subtotal: </dt>
            <dd className="inline">{formatPEN(totals.subtotalCents)}</dd>
          </div>
          <div>
            <dt className="inline">Descuento: </dt>
            <dd className="inline">− {formatPEN(totals.discountCents)}</dd>
          </div>
          <div className="text-lg font-semibold">
            <dt className="inline">Total: </dt>
            <dd className="inline">{formatPEN(totals.totalCents)}</dd>
          </div>
        </dl>
      </Card>
      <div className="flex flex-wrap gap-3">
        {(NEXT[quote.status] ?? []).map(([status, label]) => (
          <form key={status} action={setStatusAction}>
            <input type="hidden" name="id" value={quote.id} />
            <input type="hidden" name="status" value={status} />
            <button type="submit" className={secondaryButtonClass}>
              {label}
            </button>
          </form>
        ))}
        <a
          href={`/api/quotes/${quote.id}/pdf`}
          className={`${secondaryButtonClass} inline-flex items-center`}
        >
          Descargar PDF
        </a>
      </div>
    </div>
  );
}
