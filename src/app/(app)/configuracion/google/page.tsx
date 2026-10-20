import { buttonClass, Card } from "@/app/_components/ui";
import { withTenant } from "@/lib/db";
import { requireSession } from "@/server/session";

export default async function GooglePage({
  searchParams,
}: {
  searchParams: Promise<{ google?: string }>;
}) {
  const { google } = await searchParams;
  const ctx = await requireSession();
  const rows = await withTenant(ctx.userId, async (client) => {
    const { rows } = await client.query(
      `select m.display_name, g.google_email, g.status
         from memberships m left join google_connections g on g.membership_id = m.id
        where m.clinic_id = $1 and m.role = 'dentist' and m.active
          and ($2 = 'admin' or m.id = $3)
        order by m.display_name`,
      [ctx.clinicId, ctx.role, ctx.membershipId],
    );
    return rows;
  });
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
            <li key={r.display_name}>
              <strong>{r.display_name}</strong>:{" "}
              {r.status === "active"
                ? `conectado como ${r.google_email}`
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
