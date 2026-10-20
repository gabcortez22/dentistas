const BASE = "https://www.googleapis.com/calendar/v3";

const auth = (accessToken: string) => ({
  Authorization: `Bearer ${accessToken}`,
  "Content-Type": "application/json",
});

export async function createEvent(
  accessToken: string,
  calendarId: string,
  ev: { summary: string; description?: string; startsAt: Date; endsAt: Date; timeZone: string },
  fetchImpl: typeof fetch = fetch,
): Promise<string> {
  const response = await fetchImpl(`${BASE}/calendars/${encodeURIComponent(calendarId)}/events`, {
    method: "POST",
    headers: auth(accessToken),
    body: JSON.stringify({
      summary: ev.summary,
      description: ev.description,
      start: { dateTime: ev.startsAt.toISOString(), timeZone: ev.timeZone },
      end: { dateTime: ev.endsAt.toISOString(), timeZone: ev.timeZone },
    }),
  });
  if (!response.ok) throw new Error(`Google Calendar create failed: ${response.status}`);
  return ((await response.json()) as { id: string }).id;
}

export async function deleteEvent(
  accessToken: string,
  calendarId: string,
  eventId: string,
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  const response = await fetchImpl(
    `${BASE}/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`,
    { method: "DELETE", headers: auth(accessToken) },
  );
  if (!response.ok && response.status !== 404 && response.status !== 410) {
    throw new Error(`Google Calendar delete failed: ${response.status}`);
  }
}

export async function queryBusy(
  accessToken: string,
  calendarId: string,
  from: Date,
  to: Date,
  fetchImpl: typeof fetch = fetch,
): Promise<Array<{ startsAt: Date; endsAt: Date }>> {
  const response = await fetchImpl(`${BASE}/freeBusy`, {
    method: "POST",
    headers: auth(accessToken),
    body: JSON.stringify({
      timeMin: from.toISOString(),
      timeMax: to.toISOString(),
      items: [{ id: calendarId }],
    }),
  });
  if (!response.ok) throw new Error(`Google Calendar freeBusy failed: ${response.status}`);
  const json = (await response.json()) as {
    calendars?: Record<string, { busy?: Array<{ start: string; end: string }> }>;
  };
  return (json.calendars?.[calendarId]?.busy ?? []).map((b) => ({
    startsAt: new Date(b.start),
    endsAt: new Date(b.end),
  }));
}
