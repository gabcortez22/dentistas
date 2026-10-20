import { z } from "zod";

// Variables are validated per group, when the code that needs them first runs, never at import time.
// That keeps every earlier build step's gate green before the secret for a later step exists.
const groups = {
  core: z.object({ DATABASE_URL: z.string().min(1) }),
  supabase: z.object({
    NEXT_PUBLIC_SUPABASE_URL: z.url(),
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: z.string().min(1),
  }),
  supabaseAdmin: z.object({ SUPABASE_SECRET_KEY: z.string().min(1) }),
  app: z.object({ APP_URL: z.url() }),
  cron: z.object({ CRON_SECRET: z.string().min(16) }),
  crypto: z.object({
    TOKEN_ENC_KEY: z.string().refine((v) => Buffer.from(v, "base64").length === 32, {
      message: "must be 32 bytes, base64-encoded",
    }),
  }),
  google: z.object({
    GOOGLE_CLIENT_ID: z.string().min(1),
    GOOGLE_CLIENT_SECRET: z.string().min(1),
  }),
  whatsapp: z
    .object({
      WHATSAPP_MODE: z.enum(["simulator", "cloud"]).default("simulator"),
      WHATSAPP_ACCESS_TOKEN: z.string().optional(),
      WHATSAPP_APP_SECRET: z.string().optional(),
      WHATSAPP_VERIFY_TOKEN: z.string().optional(),
    })
    .superRefine((value, ctx) => {
      if (value.WHATSAPP_MODE !== "cloud") return;
      for (const key of [
        "WHATSAPP_ACCESS_TOKEN",
        "WHATSAPP_APP_SECRET",
        "WHATSAPP_VERIFY_TOKEN",
      ] as const) {
        if (!value[key])
          ctx.addIssue({
            code: "custom",
            path: [key],
            message: "required when WHATSAPP_MODE=cloud",
          });
      }
    }),
  anthropic: z.object({
    ANTHROPIC_API_KEY: z.string().min(1),
    AGENT_MODEL: z.string().min(1).default("claude-sonnet-5-5"),
  }),
} as const;

export type EnvGroup = keyof typeof groups;

export function getEnv<G extends EnvGroup>(group: G): z.infer<(typeof groups)[G]> {
  const result = groups[group].safeParse(process.env);
  if (!result.success) {
    const names = result.error.issues.map((issue) => issue.path.join(".")).join(", ");
    throw new Error(`Missing or invalid environment variables for "${group}": ${names}`);
  }
  return result.data as z.infer<(typeof groups)[G]>;
}
