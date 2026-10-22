import { buttonClass, Card } from "@/app/_components/ui";
import { listGoogleConnections } from "@/server/google-connections";
import { requireSession, userActor } from "@/server/session";

export default async function GooglePage({
  searchParams,
}: {
  searchParams: Promise<{ google?: string }>;
}) {
  const { google } = await searchParams;
  const ctx = await requireSession();
  const rows = await listGoogleConnections(userActor(ctx), ctx.role);
  return (
    <div className="max-w-3xl space-y-6">
      <h1 className="text-3xl font-semibold text-brand">Google Calendar</h1>
      {google === "ok" ? (
        <p role="status" className="text-ok">
          Conexión guardada.
        </p>
      ) : null}
      {google === "error" ? (
        <p role="alert" className="text-danger">
          No se pudo conectar con Google. Intenta de nuevo.
        </p>
      ) : null}
      <Card>
        <ul className="space-y-2">
          {rows.map((r) => (
            <li key={r.displayName}>
              <strong>{r.displayName}</strong>:{" "}
              {r.status === "active"
                ? `conectado como ${r.googleEmail}`
                : r.status === "revoked"
                  ? "autorización revocada, vuelve a conectar"
                  : "no conectado"}
            </li>
          ))}
        </ul>
      </Card>
      {ctx.role === "dentist" ? (
        <a href="/api/google/oauth/start" className={`${buttonClass} inline-flex items-center`}>
          Conectar Google Calendar
        </a>
      ) : null}
    </div>
  );
}
