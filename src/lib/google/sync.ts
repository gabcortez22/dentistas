import { type Actor, withService } from "@/lib/db";
import { createEvent, deleteEvent, queryBusy } from "@/lib/google/calendar";
import { decryptToken, encryptToken } from "@/lib/google/crypto";
import { accessTokenFromRefresh, exchangeCode, GoogleAuthError } from "@/lib/google/oauth";

export async function connectGoogle(
  actor: Actor,
  membershipId: string,
  code: string,
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  const { refreshToken, email } = await exchangeCode(code, fetchImpl);
  await withService(async (client) => {
    const own = await client.query("select 1 from memberships where id = $1 and clinic_id = $2", [
      membershipId,
      actor.clinicId,
    ]);
    if (!own.rowCount) throw new Error("membership not found in this clinic");
    await client.query(
      `insert into google_connections (clinic_id, membership_id, google_email, refresh_token_enc)
       values ($1, $2, $3, $4)
       on conflict (membership_id) do update
         set google_email = excluded.google_email, refresh_token_enc = excluded.refresh_token_enc,
             status = 'active', last_error = null`,
      [actor.clinicId, membershipId, email, encryptToken(refreshToken)],
    );
  });
}

type Summary = { created: number; deleted: number; connections: number; revoked: number };

export async function runGoogleSync(
  opts: { now?: Date; fetchImpl?: typeof fetch } = {},
): Promise<Summary> {
  const now = opts.now ?? new Date();
  const fetchImpl = opts.fetchImpl ?? fetch;
  const summary: Summary = { created: 0, deleted: 0, connections: 0, revoked: 0 };
  const connections = await withService(async (client) => {
    const { rows } = await client.query(
      `select id, clinic_id, membership_id, calendar_id, refresh_token_enc
         from google_connections where status = 'active'`,
    );
    return rows;
  });
  for (const conn of connections) {
    summary.connections++;
    let accessToken: string;
    try {
      accessToken = await accessTokenFromRefresh(decryptToken(conn.refresh_token_enc), fetchImpl);
    } catch (error) {
      const revoked = error instanceof GoogleAuthError && error.code === "invalid_grant";
      await withService((client) =>
        client.query("update google_connections set status = $2, last_error = $3 where id = $1", [
          conn.id,
          revoked ? "revoked" : "error",
          (error as Error).message,
        ]),
      );
      if (revoked) summary.revoked++;
      continue;
    }
    try {
      const cancelled = await withService((client) =>
        client.query(
          `select id, google_event_id from appointments
            where membership_id = $1 and clinic_id = $2 and status = 'cancelled' and google_event_id is not null`,
          [conn.membership_id, conn.clinic_id],
        ),
      );
      for (const row of cancelled.rows) {
        await deleteEvent(accessToken, conn.calendar_id, row.google_event_id, fetchImpl);
        await withService((client) =>
          client.query("update appointments set google_event_id = null where id = $1", [row.id]),
        );
        summary.deleted++;
      }
      const pending = await withService((client) =>
        client.query(
          `select a.id, a.starts_at, a.ends_at, a.reason, c.timezone,
                  p.last_name || ', ' || p.first_name as patient_name
             from appointments a
             join patients p on p.id = a.patient_id
             join clinics c on c.id = a.clinic_id
            where a.membership_id = $1 and a.clinic_id = $2 and a.status = 'confirmed'
              and a.starts_at > $3 and a.google_event_id is null`,
          [conn.membership_id, conn.clinic_id, now],
        ),
      );
      for (const row of pending.rows) {
        const eventId = await createEvent(
          accessToken,
          conn.calendar_id,
          {
            summary: `Cita: ${row.patient_name} — ${row.reason ?? "Consulta"}`,
            startsAt: new Date(row.starts_at),
            endsAt: new Date(row.ends_at),
            timeZone: row.timezone,
          },
          fetchImpl,
        );
        await withService((client) =>
          client.query("update appointments set google_event_id = $2 where id = $1", [
            row.id,
            eventId,
          ]),
        );
        summary.created++;
      }
      const busy = await queryBusy(
        accessToken,
        conn.calendar_id,
        now,
        new Date(now.getTime() + 30 * 86_400_000),
        fetchImpl,
      );
      await withService(async (client) => {
        await client.query(
          "delete from external_busy where membership_id = $1 and clinic_id = $2",
          [conn.membership_id, conn.clinic_id],
        );
        for (const b of busy) {
          await client.query(
            "insert into external_busy (clinic_id, membership_id, starts_at, ends_at) values ($1, $2, $3, $4)",
            [conn.clinic_id, conn.membership_id, b.startsAt, b.endsAt],
          );
        }
      });
    } catch (error) {
      await withService((client) =>
        client.query("update google_connections set last_error = $2 where id = $1", [
          conn.id,
          (error as Error).message,
        ]),
      );
    }
  }
  return summary;
}
