"use server";

import { DateTime } from "luxon";
import { redirect } from "next/navigation";
import { ZodError } from "zod";
import { addBlockException, setWeeklyRules, type WeeklyRule } from "@/server/schedules";
import { ForbiddenError, requireSession, userActor } from "@/server/session";

const back = (q: string): never => redirect(`/configuracion/horarios?${q}`);

export async function saveRulesAction(formData: FormData) {
  const ctx = await requireSession();
  const membershipId = String(formData.get("membershipId"));
  const rules: WeeklyRule[] = [];
  for (let weekday = 1; weekday <= 7; weekday++) {
    for (const n of [1, 2]) {
      const startTime = String(formData.get(`d${weekday}s${n}`) ?? "");
      const endTime = String(formData.get(`d${weekday}e${n}`) ?? "");
      if (startTime && endTime) rules.push({ weekday, startTime, endTime });
    }
  }
  try {
    await setWeeklyRules(userActor(ctx), ctx.role, membershipId, rules);
  } catch (error) {
    if (error instanceof ForbiddenError) back("error=Solo+puedes+editar+tu+propio+horario.");
    if (error instanceof ZodError)
      back(
        `error=${encodeURIComponent("Revisa las franjas: fin posterior al inicio y sin solapes.")}`,
      );
    throw error;
  }
  back(`ok=1&dentista=${membershipId}`);
}

export async function blockAction(formData: FormData) {
  const ctx = await requireSession();
  const membershipId = String(formData.get("membershipId"));
  const start = DateTime.fromISO(String(formData.get("startsAt")), { zone: "America/Lima" });
  const end = DateTime.fromISO(String(formData.get("endsAt")), { zone: "America/Lima" });
  if (!start.isValid || !end.isValid || end <= start) back("error=Revisa+las+fechas+del+bloqueo.");
  try {
    await addBlockException(userActor(ctx), ctx.role, membershipId, {
      startsAt: start.toJSDate(),
      endsAt: end.toJSDate(),
      reason: String(formData.get("reason") ?? "") || undefined,
    });
  } catch (error) {
    if (error instanceof ForbiddenError) back("error=No+tienes+permiso+para+bloquear+ese+horario.");
    throw error;
  }
  back(`ok=1&dentista=${membershipId}`);
}
