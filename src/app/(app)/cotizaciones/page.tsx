import Link from "next/link";
import { buttonClass, Card, Empty, secondaryButtonClass } from "@/app/_components/ui";
import { listQuotes } from "@/server/quotes";
import { ForbiddenError, requireSession, userActor } from "@/server/session";

const STATUS: Record<string, string> = {
  draft: "Borrador",
  sent: "Enviada",
  accepted: "Aceptada",
  rejected: "Rechazada",
  expired: "Vencida",
};

export default async function CotizacionesPage({
  searchParams,
}: {
  searchParams: Promise<{ estado?: string }>;
}) {
  const { estado } = await searchParams;
  const ctx = await requireSession();
  let quotes: Awaited<ReturnType<typeof listQuotes>>;
  try {
    quotes = await listQuotes(userActor(ctx), { status: estado || undefined });
  } catch (error) {
    if (error instanceof ForbiddenError)
      return (
        <p role="alert" className="text-danger">
          Tu rol no tiene acceso a las cotizaciones.
        </p>
      );
    throw error;
  }
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <h1 className="text-3xl font-semibold text-brand">Cotizaciones</h1>
        <div className="flex gap-2">
          <Link
            href="/cotizaciones/catalogo"
            className={`${secondaryButtonClass} inline-flex items-center`}
          >
            Catálogo
          </Link>
          <Link href="/cotizaciones/nueva" className={`${buttonClass} inline-flex items-center`}>
            Nueva cotización
          </Link>
        </div>
      </div>
      <nav aria-label="Filtrar por estado" className="flex flex-wrap gap-2">
        <Link href="/cotizaciones" className="min-h-11 py-2 text-brand underline">
          Todas
        </Link>
        {Object.entries(STATUS).map(([k, v]) => (
          <Link
            key={k}
            href={`/cotizaciones?estado=${k}`}
            className="min-h-11 py-2 text-brand underline"
          >
            {v}
          </Link>
        ))}
      </nav>
      {quotes.length === 0 ? (
        <Empty>Aún no hay cotizaciones.</Empty>
      ) : (
        <Card>
          <table className="w-full text-left text-sm">
            <caption className="sr-only">Cotizaciones</caption>
            <thead>
              <tr className="border-b border-line">
                <th scope="col" className="py-2">
                  N°
                </th>
                <th scope="col">Paciente</th>
                <th scope="col">Estado</th>
                <th scope="col">Vigencia</th>
              </tr>
            </thead>
            <tbody>
              {quotes.map((q) => (
                <tr key={q.id} className="border-b border-line">
                  <td className="py-3">
                    <Link
                      className="inline-block min-h-11 py-3 text-brand underline"
                      href={`/cotizaciones/${q.id}`}
                    >
                      {String(q.number).padStart(6, "0")}
                    </Link>
                  </td>
                  <td>{q.patientName}</td>
                  <td>{STATUS[q.status]}</td>
                  <td>{q.validUntil}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}
