import {
  Alert,
  buttonClass,
  Card,
  Empty,
  inputClass,
  secondaryButtonClass,
} from "@/app/_components/ui";
import { type Entry, openRecord } from "@/server/clinical";
import { ForbiddenError, requireSession, userActor } from "@/server/session";
import { addEntryAction, addMarkAction, correctEntryAction } from "./actions";

const UPPER = [18, 17, 16, 15, 14, 13, 12, 11, 21, 22, 23, 24, 25, 26, 27, 28];
const LOWER = [48, 47, 46, 45, 44, 43, 42, 41, 31, 32, 33, 34, 35, 36, 37, 38];
const KIND_LABEL: Record<string, string> = {
  anamnesis: "Anamnesis",
  examen: "Examen clínico",
  diagnostico: "Diagnóstico",
  tratamiento: "Tratamiento",
  evolucion: "Evolución",
  consentimiento: "Consentimiento informado",
  alta: "Alta del paciente",
  nota_correccion: "Corrección",
};
const lima = new Intl.DateTimeFormat("es-PE", {
  dateStyle: "short",
  timeStyle: "short",
  timeZone: "America/Lima",
});

function summary(e: Entry): string {
  const b = e.body as Record<string, unknown>;
  if (typeof b.texto === "string") return b.texto;
  if (typeof b.motivoConsulta === "string") return `Motivo: ${b.motivoConsulta}`;
  return JSON.stringify(b, null, 1);
}

function Area({ name, label }: { name: string; label: string }) {
  return (
    <div>
      <label htmlFor={name} className="block text-sm font-medium">
        {label}
      </label>
      <textarea id={name} name={name} rows={2} className={inputClass} />
    </div>
  );
}

export default async function HistoriaPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { id } = await params;
  const { error } = await searchParams;
  const ctx = await requireSession();
  let record: Awaited<ReturnType<typeof openRecord>>;
  try {
    record = await openRecord(userActor(ctx), id);
  } catch (e) {
    if (e instanceof ForbiddenError) {
      return <Alert>Tu rol no tiene acceso a la historia clínica.</Alert>;
    }
    throw e;
  }
  const { patient, entries, odontogram } = record;
  const corrections = new Map<string, Entry[]>();
  for (const e of entries) {
    if (e.correctsEntryId)
      corrections.set(e.correctsEntryId, [...(corrections.get(e.correctsEntryId) ?? []), e]);
  }
  const conditionOf = (tooth: number) =>
    odontogram
      .filter((m) => m.tooth === tooth)
      .map((m) => m.condition)
      .join(", ");
  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-semibold text-brand">
        Historia clínica — {patient.lastName}, {patient.firstName}
      </h1>
      <p className="text-ink-muted">
        N° de historia: {patient.hcNumber}. Las entradas no se editan ni se borran: se corrigen con
        una nota.
      </p>
      {error ? <Alert>{error}</Alert> : null}

      <Card title="Odontograma">
        <div id="odontograma" className="space-y-3">
          <form id="odonto-form" action={addMarkAction} className="flex flex-wrap items-end gap-3">
            <input type="hidden" name="patientId" value={patient.id} />
            <div>
              <label htmlFor="condition" className="block text-sm font-medium">
                Condición a registrar
              </label>
              <input
                id="condition"
                name="condition"
                required
                placeholder="caries, obturado, ausente…"
                className={inputClass}
              />
            </div>
            <div>
              <label htmlFor="surface" className="block text-sm font-medium">
                Superficie
              </label>
              <select
                id="surface"
                name="surface"
                className="mt-1 min-h-11 rounded-control border border-line bg-surface px-3"
              >
                <option value="">Toda la pieza</option>
                {["M", "D", "O", "V", "L", "P", "I"].map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </div>
            <p className="text-sm text-ink-muted">Elige la condición y pulsa la pieza.</p>
          </form>
          {[UPPER, LOWER].map((row) => (
            <div key={row[0]} className="grid grid-cols-8 gap-1 sm:grid-cols-16">
              {row.map((tooth) => {
                const c = conditionOf(tooth);
                return (
                  <button
                    key={tooth}
                    type="submit"
                    form="odonto-form"
                    name="tooth"
                    value={tooth}
                    aria-label={`Pieza ${tooth}${c ? `, ${c}` : ""}`}
                    className={`min-h-11 rounded-control border px-1 text-sm ${c ? "border-brand bg-brand-soft" : "border-line bg-surface"}`}
                  >
                    {tooth}
                    {c ? <span className="block text-xs">{c.slice(0, 6)}</span> : null}
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      </Card>

      <Card title="Entradas">
        {entries.filter((e) => !e.correctsEntryId).length === 0 ? (
          <Empty>Aún no hay entradas en esta historia.</Empty>
        ) : (
          <ol className="space-y-4">
            {entries
              .filter((e) => !e.correctsEntryId)
              .map((e) => (
                <li key={e.id} className="rounded-control border border-line p-3">
                  <p className="text-sm text-ink-muted">
                    {KIND_LABEL[e.kind]} · {e.authorName} · {lima.format(e.createdAt)} (hora de
                    Lima)
                  </p>
                  <pre className="mt-1 whitespace-pre-wrap font-sans">{summary(e)}</pre>
                  {(corrections.get(e.id) ?? []).map((c) => (
                    <p key={c.id} className="mt-2 border-l-4 border-warn pl-3 text-sm">
                      Corrección ({c.authorName}, {lima.format(c.createdAt)}): {summary(c)}
                    </p>
                  ))}
                  <details className="mt-2">
                    <summary className="min-h-11 cursor-pointer py-2 text-sm text-brand">
                      Agregar corrección
                    </summary>
                    <form
                      action={correctEntryAction}
                      className="mt-2 flex flex-wrap items-end gap-2"
                    >
                      <input type="hidden" name="patientId" value={patient.id} />
                      <input type="hidden" name="entryId" value={e.id} />
                      <div className="flex-1">
                        <label htmlFor={`c-${e.id}`} className="block text-sm font-medium">
                          Nota de corrección
                        </label>
                        <input id={`c-${e.id}`} name="texto" required className={inputClass} />
                      </div>
                      <button type="submit" className={secondaryButtonClass}>
                        Guardar corrección
                      </button>
                    </form>
                  </details>
                </li>
              ))}
          </ol>
        )}
      </Card>

      <Card title="Nueva entrada">
        <div className="grid gap-6 lg:grid-cols-2">
          {[
            {
              kind: "anamnesis",
              fields: (
                <>
                  <Area name="informante" label="Datos del informante" />
                  <Area name="motivoConsulta" label="Motivo de consulta" />
                  <Area name="tiempoEnfermedad" label="Tiempo de enfermedad" />
                  <Area name="signosSintomas" label="Signos y síntomas principales" />
                  <Area name="relatoCronologico" label="Relato cronológico" />
                  <Area name="funcionesBiologicas" label="Funciones biológicas" />
                  <Area name="enfermedadActual" label="Enfermedad actual" />
                  <Area name="antecedentesPersonales" label="Antecedentes personales" />
                  <Area name="antecedentesFamiliares" label="Antecedentes familiares" />
                  <Area name="alergias" label="Alergias" />
                  <Area name="medicacionActual" label="Medicación actual" />
                </>
              ),
            },
            {
              kind: "examen",
              fields: (
                <>
                  <Area name="presionArterial" label="Presión arterial (P.A.)" />
                  <Area name="pulso" label="Pulso" />
                  <Area name="temperatura" label="Temperatura" />
                  <Area name="frecuenciaCardiaca" label="Frecuencia cardiaca (F.C.)" />
                  <Area name="frecuenciaRespiratoria" label="Frecuencia respiratoria" />
                  <Area name="examenClinicoGeneral" label="Examen clínico general" />
                  <Area name="extraoral" label="Examen extraoral" />
                  <Area name="intraoral" label="Examen odontoestomatológico" />
                </>
              ),
            },
            {
              kind: "diagnostico",
              fields: (
                <>
                  <Area name="descripcion" label="Diagnóstico" />
                  <div>
                    <label htmlFor="tipo" className="block text-sm font-medium">
                      Tipo
                    </label>
                    <select
                      id="tipo"
                      name="tipo"
                      className="mt-1 min-h-11 w-full rounded-control border border-line bg-surface px-3"
                    >
                      <option value="">—</option>
                      <option value="presuntivo">Presuntivo</option>
                      <option value="definitivo">Definitivo</option>
                    </select>
                  </div>
                  <div>
                    <label htmlFor="cie10" className="block text-sm font-medium">
                      CIE-10 (opcional)
                    </label>
                    <input id="cie10" name="cie10" className={inputClass} />
                  </div>
                </>
              ),
            },
            {
              kind: "tratamiento",
              fields: (
                <>
                  <Area name="descripcion" label="Tratamiento realizado o planificado" />
                  <div>
                    <label htmlFor="pieza" className="block text-sm font-medium">
                      Pieza FDI (opcional)
                    </label>
                    <input id="pieza" name="pieza" inputMode="numeric" className={inputClass} />
                  </div>
                  <Area name="plan" label="Plan de trabajo" />
                  <Area name="pronostico" label="Pronóstico" />
                  <Area
                    name="recomendaciones"
                    label="Recomendaciones (medicamento, dosis, vía, cuidados)"
                  />
                </>
              ),
            },
            { kind: "evolucion", fields: <Area name="texto" label="Evolución" /> },
            { kind: "alta", fields: <Area name="texto" label="Alta del paciente" /> },
            {
              kind: "consentimiento",
              fields: (
                <>
                  <Area name="procedimiento" label="Procedimiento" />
                  <Area name="texto" label="Texto del consentimiento" />
                  <div>
                    <label htmlFor="aceptadoPor" className="block text-sm font-medium">
                      Aceptado por
                    </label>
                    <input id="aceptadoPor" name="aceptadoPor" className={inputClass} />
                  </div>
                  <div>
                    <label htmlFor="fecha" className="block text-sm font-medium">
                      Fecha
                    </label>
                    <input id="fecha" name="fecha" type="date" className={inputClass} />
                  </div>
                </>
              ),
            },
          ].map(({ kind, fields }) => (
            <form
              key={kind}
              action={addEntryAction}
              className="space-y-3 rounded-control border border-line p-3"
            >
              <h3 className="font-semibold">{KIND_LABEL[kind]}</h3>
              <input type="hidden" name="patientId" value={patient.id} />
              <input type="hidden" name="kind" value={kind} />
              {fields}
              <button type="submit" className={buttonClass}>
                Guardar {(KIND_LABEL[kind] ?? kind).toLowerCase()}
              </button>
            </form>
          ))}
        </div>
      </Card>
    </div>
  );
}
