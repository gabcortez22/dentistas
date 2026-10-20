import { exportPatientData } from "@/server/patient-export";
import { ForbiddenError, getSession, userActor } from "@/server/session";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await getSession();
  if (!ctx) return Response.json({ error: "unauthorized" }, { status: 401 });
  if (ctx.role === "assistant") return Response.json({ error: "forbidden" }, { status: 403 });
  let data: Awaited<ReturnType<typeof exportPatientData>>;
  try {
    data = await exportPatientData(userActor(ctx), id);
  } catch (error) {
    if (error instanceof ForbiddenError)
      return Response.json({ error: "forbidden" }, { status: 403 });
    if (error instanceof Error && error.message === "patient not found")
      return Response.json({ error: "not_found" }, { status: 404 });
    throw error;
  }
  return new Response(JSON.stringify(data, null, 2), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="paciente-${data.patient.hcNumber}.json"`,
      "Cache-Control": "no-store",
    },
  });
}
