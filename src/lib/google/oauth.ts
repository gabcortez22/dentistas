import { getEnv } from "@/lib/env";

// UNVERIFIED: confirm the scopes against Google's current documentation before production.
export const SCOPES = [
  "openid",
  "email",
  "https://www.googleapis.com/auth/calendar.events",
  "https://www.googleapis.com/auth/calendar.freebusy",
];

export class GoogleAuthError extends Error {
  constructor(
    message: string,
    readonly code: string,
  ) {
    super(message);
    this.name = "GoogleAuthError";
  }
}

const redirectUri = () => `${getEnv("app").APP_URL}/api/google/oauth/callback`;

export function buildAuthUrl(state: string): string {
  const { GOOGLE_CLIENT_ID } = getEnv("google");
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.searchParams.set("client_id", GOOGLE_CLIENT_ID);
  url.searchParams.set("redirect_uri", redirectUri());
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", SCOPES.join(" "));
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("prompt", "consent");
  url.searchParams.set("state", state);
  return url.toString();
}

async function tokenRequest(params: Record<string, string>, fetchImpl: typeof fetch) {
  const { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET } = getEnv("google");
  const response = await fetchImpl("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: GOOGLE_CLIENT_ID,
      client_secret: GOOGLE_CLIENT_SECRET,
      ...params,
    }),
  });
  const json = (await response.json()) as Record<string, string>;
  if (!response.ok) {
    throw new GoogleAuthError(
      json.error_description ?? json.error ?? "token request failed",
      json.error ?? "unknown",
    );
  }
  return json;
}

export async function exchangeCode(
  code: string,
  fetchImpl: typeof fetch = fetch,
): Promise<{ refreshToken: string; email: string }> {
  const json = await tokenRequest(
    { grant_type: "authorization_code", code, redirect_uri: redirectUri() },
    fetchImpl,
  );
  if (!json.refresh_token)
    throw new GoogleAuthError("no refresh token returned", "no_refresh_token");
  // The id_token comes straight from Google over TLS, so its payload is decoded without verifying the signature.
  const payload = JSON.parse(
    Buffer.from((json.id_token ?? "").split(".")[1] ?? "", "base64url").toString("utf8") || "{}",
  );
  return { refreshToken: json.refresh_token, email: String(payload.email ?? "") };
}

export async function accessTokenFromRefresh(
  refreshToken: string,
  fetchImpl: typeof fetch = fetch,
): Promise<string> {
  const json = await tokenRequest(
    { grant_type: "refresh_token", refresh_token: refreshToken },
    fetchImpl,
  );
  if (!json.access_token) throw new GoogleAuthError("no access token returned", "no_access_token");
  return json.access_token;
}
