import { z } from "zod";
import { loadSlots } from "@/server/availability";
import { getSession, userActor } from "@/server/session";

const query = z.object({
  dentist: z.uuid(),
  from: z.iso.datetime({ offset: true }),
  to: z.iso.datetime({ offset: true }),
  minutes: z.coerce.number().int().min(5).max(480),
});

export async function GET(request: Request) {
  const ctx = await getSession();
  if (!ctx) return Response.json({ error: "unauthorized" }, { status: 401 });
  const params = Object.fromEntries(new URL(request.url).searchParams);
  const parsed = query.safeParse(params);
  if (!parsed.success) return Response.json({ error: "invalid_parameters" }, { status: 400 });
  const slots = await loadSlots(userActor(ctx), {
    membershipId: parsed.data.dentist,
    from: new Date(parsed.data.from),
    to: new Date(parsed.data.to),
    durationMinutes: parsed.data.minutes,
  });
  return Response.json({
    slots: slots.map((s) => ({
      startsAt: s.startsAt.toISOString(),
      endsAt: s.endsAt.toISOString(),
    })),
  });
}
