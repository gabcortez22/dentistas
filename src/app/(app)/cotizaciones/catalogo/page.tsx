import { Alert, buttonClass, Card, Field } from "@/app/_components/ui";
import { formatPEN } from "@/lib/money";
import { listTreatments } from "@/server/quotes";
import { requireSession, userActor } from "@/server/session";
import { saveTreatmentAction } from "../actions";

export default async function CatalogoPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  const ctx = await requireSession();
  const treatments = await listTreatments(userActor(ctx));
  const isAdmin = ctx.role === "admin";
  return (
    <div className="max-w-3xl space-y-6">
      <h1 className="text-3xl font-semibold text-brand">Catálogo de tratamientos</h1>
      {error ? <Alert>{error}</Alert> : null}
      <Card>
        <table className="w-full text-left text-sm">
          <caption className="sr-only">Tratamientos</caption>
          <thead>
            <tr className="border-b border-line">
              <th scope="col" className="py-2">
                Nombre
              </th>
              <th scope="col">Precio</th>
              <th scope="col">Duración</th>
              <th scope="col">Estado</th>
            </tr>
          </thead>
          <tbody>
            {treatments.map((t) => (
              <tr key={t.id} className="border-b border-line">
                <td className="py-3">{t.name}</td>
                <td>{formatPEN(t.defaultPriceCents)}</td>
                <td>{t.durationMinutes} min</td>
                <td>{t.active ? "Activo" : "Inactivo"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
      {isAdmin ? (
        <Card title="Agregar tratamiento">
          <form action={saveTreatmentAction} className="grid gap-4 sm:grid-cols-3">
            <Field label="Nombre" name="name" required />
            <Field label="Precio (S/)" name="price" required />
            <Field label="Duración (min)" name="minutes" defaultValue="30" required />
            <button type="submit" className={`${buttonClass} sm:col-span-3`}>
              Guardar
            </button>
          </form>
        </Card>
      ) : null}
    </div>
  );
}
