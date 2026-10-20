import Link from "next/link";
import { buttonClass, Card, Empty, inputClass } from "@/app/_components/ui";
import { searchPatients } from "@/server/patients";
import { requireSession, userActor } from "@/server/session";

export default async function PacientesPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const { q } = await searchParams;
  const ctx = await requireSession();
  const patients = await searchPatients(userActor(ctx), { q });
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <h1 className="text-3xl font-semibold text-brand">Pacientes</h1>
        <Link href="/pacientes/nuevo" className={`${buttonClass} inline-flex items-center`}>
          Nuevo paciente
        </Link>
      </div>
      <search className="max-w-md">
        <form>
          <label htmlFor="q" className="block text-sm font-medium">
            Buscar por apellido, nombre o documento
          </label>
          <input id="q" name="q" type="search" defaultValue={q ?? ""} className={inputClass} />
        </form>
      </search>
      {patients.length === 0 ? (
        <Empty>{q ? "Ningún paciente coincide con la búsqueda." : "Aún no hay pacientes."}</Empty>
      ) : (
        <Card>
          <table className="w-full text-left text-sm">
            <caption className="sr-only">Pacientes</caption>
            <thead>
              <tr className="border-b border-line">
                <th scope="col" className="py-2">
                  HC
                </th>
                <th scope="col">Apellidos y nombres</th>
                <th scope="col">Teléfono</th>
              </tr>
            </thead>
            <tbody>
              {patients.map((p) => (
                <tr key={p.id} className="border-b border-line">
                  <td className="py-3">{p.hcNumber}</td>
                  <td>
                    <Link
                      href={`/pacientes/${p.id}`}
                      className="inline-block min-h-11 py-3 text-brand underline"
                    >
                      {p.lastName}, {p.firstName}
                    </Link>
                  </td>
                  <td>{p.phoneE164 ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}
