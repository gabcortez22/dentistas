import { randomUUID } from "node:crypto";
import { getEnv } from "@/lib/env";

// UNVERIFIED: version taken from an example in Meta's documentation; confirm the current one before production.
export const GRAPH_API_VERSION = "v23.0";

export type TemplateMessage = {
  to: string;
  template: "recordatorio_cita" | "seguimiento_prospecto";
  language: "es";
  params: string[];
};
export type TextMessage = { to: string; body: string };

export interface WhatsAppSender {
  sendTemplate(phoneNumberId: string, message: TemplateMessage): Promise<{ id: string }>;
  sendText(phoneNumberId: string, message: TextMessage): Promise<{ id: string }>;
}

export class SimulatorSender implements WhatsAppSender {
  readonly sent: Array<{ kind: "template" | "text"; to: string; payload: unknown }> = [];

  async sendTemplate(_phoneNumberId: string, message: TemplateMessage) {
    this.sent.push({ kind: "template", to: message.to, payload: message });
    return { id: `sim-${randomUUID()}` };
  }

  async sendText(_phoneNumberId: string, message: TextMessage) {
    this.sent.push({ kind: "text", to: message.to, payload: message });
    return { id: `sim-${randomUUID()}` };
  }
}

export class CloudApiSender implements WhatsAppSender {
  constructor(
    private readonly accessToken: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  private async post(phoneNumberId: string, body: Record<string, unknown>) {
    const response = await this.fetchImpl(
      `https://graph.facebook.com/${GRAPH_API_VERSION}/${phoneNumberId}/messages`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ messaging_product: "whatsapp", ...body }),
      },
    );
    const text = await response.text();
    if (!response.ok) throw new Error(`WhatsApp API ${response.status}: ${text}`);
    const json = JSON.parse(text) as { messages?: Array<{ id: string }> };
    const id = json.messages?.[0]?.id;
    if (!id) throw new Error("WhatsApp API returned no message id");
    return { id };
  }

  sendTemplate(phoneNumberId: string, message: TemplateMessage) {
    return this.post(phoneNumberId, {
      to: message.to,
      type: "template",
      template: {
        name: message.template,
        language: { code: message.language },
        components: [
          { type: "body", parameters: message.params.map((text) => ({ type: "text", text })) },
        ],
      },
    });
  }

  sendText(phoneNumberId: string, message: TextMessage) {
    return this.post(phoneNumberId, {
      to: message.to,
      type: "text",
      text: { body: message.body },
    });
  }
}

let simulator: SimulatorSender | undefined;

export function getSender(): WhatsAppSender {
  const env = getEnv("whatsapp");
  if (env.WHATSAPP_MODE === "cloud") return new CloudApiSender(env.WHATSAPP_ACCESS_TOKEN as string);
  simulator ??= new SimulatorSender();
  return simulator;
}
