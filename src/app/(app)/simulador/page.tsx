import { formatDateTime } from "@/app/_components/format";
import { Alert, buttonClass, Card, Empty, Field } from "@/app/_components/ui";
import { requireSession, userActor } from "@/server/session";
import { listSimulatorMessages } from "@/server/simulator";
import { sendSimulatedAction } from "./actions";

export default async function SimuladorPage({
  searchParams,
}: {
  searchParams: Promise<{ phone?: string; error?: string }>;
}) {
  const { phone, error } = await searchParams;
  const ctx = await requireSession();
  if (ctx.role !== "admin")
    return (
      <p role="alert" className="text-danger">
        Solo la administración puede usar el simulador.
      </p>
    );
  const messages = phone ? await listSimulatorMessages(userActor(ctx), phone) : [];
  return (
    <div className="max-w-2xl space-y-6">
      <h1 className="text-3xl font-semibold text-brand">Simulador de WhatsApp</h1>
      <p className="text-ink-muted">
        Escribe como si fueras un paciente para probar el agente sin una línea real de WhatsApp.
      </p>
      {error ? <Alert>{error}</Alert> : null}
      <Card>
        <form action={sendSimulatedAction} className="space-y-4">
          <Field
            label="Teléfono del paciente (con código de país, p. ej. 51987654321)"
            name="phone"
            defaultValue={phone ?? ""}
            required
          />
          <Field label="Mensaje" name="body" required />
          <button type="submit" className={buttonClass}>
            Enviar
          </button>
        </form>
      </Card>
      <Card title="Conversación">
        {messages.length === 0 ? (
          <Empty>Aún no hay mensajes con ese teléfono.</Empty>
        ) : (
          <ol className="space-y-2">
            {messages.map((m) => (
              <li
                key={`${m.createdAt.toISOString()}-${m.body}`}
                className={`rounded-control border p-2 ${m.direction === "in" ? "border-line" : "border-brand bg-brand-soft"}`}
              >
                <p className="text-xs text-ink-muted">
                  {m.direction === "in" ? "Paciente" : "Asistente"} · {formatDateTime(m.createdAt)}
                </p>
                <p className="whitespace-pre-wrap">{m.body}</p>
              </li>
            ))}
          </ol>
        )}
      </Card>
    </div>
  );
}
