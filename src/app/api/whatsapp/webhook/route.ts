import { after } from "next/server";
import { anthropicLlm } from "@/lib/agent/llm";
import { getEnv } from "@/lib/env";
import { getSender } from "@/lib/whatsapp/client";
import { receiveWebhook } from "@/server/inbound";

export const maxDuration = 60;

export async function GET(request: Request) {
  const url = new URL(request.url);
  const expected = getEnv("whatsapp").WHATSAPP_VERIFY_TOKEN;
  if (
    url.searchParams.get("hub.mode") === "subscribe" &&
    expected &&
    url.searchParams.get("hub.verify_token") === expected
  ) {
    return new Response(url.searchParams.get("hub.challenge") ?? "", { status: 200 });
  }
  return new Response("forbidden", { status: 403 });
}

export async function POST(request: Request) {
  const raw = await request.text();
  return receiveWebhook(
    raw,
    request.headers.get("x-hub-signature-256"),
    (job) => after(job),
    () => ({ llm: anthropicLlm(), sender: getSender() }),
  );
}
