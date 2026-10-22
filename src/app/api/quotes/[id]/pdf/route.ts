import { renderQuotePdf } from "@/lib/pdf/quote-document";
import { getClinicName } from "@/server/clinics";
import { getPatient } from "@/server/patients";
import { getQuote } from "@/server/quotes";
import { ForbiddenError, getSession, userActor } from "@/server/session";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await getSession();
  if (!ctx) return Response.json({ error: "unauthorized" }, { status: 401 });
  if (ctx.role === "assistant") return Response.json({ error: "forbidden" }, { status: 403 });
  const actor = userActor(ctx);
  let data: Awaited<ReturnType<typeof getQuote>>;
  try {
    data = await getQuote(actor, id);
  } catch (error) {
    if (error instanceof ForbiddenError)
      return Response.json({ error: "forbidden" }, { status: 403 });
    throw error;
  }
  if (!data) return Response.json({ error: "not_found" }, { status: 404 });
  const patient = await getPatient(actor, data.quote.patientId);
  const clinicName = await getClinicName(actor);
  const pdf = await renderQuotePdf({
    clinicName,
    patientName: data.quote.patientName,
    patientDocument: patient ? `${patient.docType} ${patient.docNumber}` : "",
    number: data.quote.number,
    createdAt: data.quote.createdAt,
    validUntil: data.quote.validUntil,
    notes: data.quote.notes ?? undefined,
    items: data.items,
    discountCents: data.quote.discountCents,
  });
  return new Response(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="cotizacion-${data.quote.number}.pdf"`,
    },
  });
}
