import {
  Alert,
  buttonClass,
  Card,
  Field,
  inputClass,
  secondaryButtonClass,
} from "@/app/_components/ui";
import { formatPEN } from "@/lib/money";
import { searchPatients } from "@/server/patients";
import { listTreatments } from "@/server/quotes";
import { requireSession, userActor } from "@/server/session";
import { createQuoteAction } from "../actions";

export default async function NuevaCotizacionPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; q?: string }>;
}) {
  const { error, q } = await searchParams;
  const ctx = await requireSession();
  const actor = userActor(ctx);
  const [patients, treatments] = await Promise.all([
    q ? searchPatients(actor, { q, limit: 10 }) : [],
    listTreatments(actor, { activeOnly: true }),
  ]);
  return (
    <div className="max-w-4xl space-y-6">
      <h1 className="text-3xl font-semibold text-brand">Nueva cotización</h1>
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
      </form>
      <form action={createQuoteAction} className="space-y-6">
        <Card title="Paciente">
          <label htmlFor="patientId" className="block text-sm font-medium">
            Paciente
          </label>
          <select id="patientId" name="patientId" required className={inputClass}>
            <option value="">{q ? "Elegir…" : "Primero busca un paciente"}</option>
            {patients.map((p) => (
              <option key={p.id} value={p.id}>
                {p.lastName}, {p.firstName} ({p.docNumber})
              </option>
            ))}
          </select>
        </Card>
        <Card title="Ítems (precios en soles, IGV incluido)">
          <div className="space-y-4">
            {[0, 1, 2, 3, 4, 5].map((i) => (
              <fieldset key={i} className="grid gap-2 sm:grid-cols-6">
                <legend className="sr-only">Ítem {i + 1}</legend>
                <div className="sm:col-span-2">
                  <label htmlFor={`treatment${i}`} className="block text-sm font-medium">
                    Tratamiento {i + 1}
                  </label>
                  <select id={`treatment${i}`} name={`treatment${i}`} className={inputClass}>
                    <option value="">Otro / libre</option>
                    {treatments.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name} ({formatPEN(t.defaultPriceCents)})
                      </option>
                    ))}
                  </select>
                </div>
                <Field label="Descripción" name={`description${i}`} />
                <Field label="Pieza" name={`tooth${i}`} />
                <Field label="Cant." name={`qty${i}`} defaultValue="1" />
                <Field label="Precio unit. (S/)" name={`price${i}`} />
              </fieldset>
            ))}
          </div>
        </Card>
        <Card title="Condiciones">
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Descuento (S/)" name="discount" />
            <Field label="Vigente hasta" name="validUntil" type="date" />
            <Field label="Notas" name="notes" />
          </div>
        </Card>
        <button type="submit" className={buttonClass}>
          Crear cotización
        </button>
      </form>
    </div>
  );
}
