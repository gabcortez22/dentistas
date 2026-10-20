/** Normalizes a Peruvian phone number to E.164, or null when it cannot be one. */
export function normalizePhonePE(raw: string): string | null {
  const cleaned = raw.replace(/[\s\-().]/g, "");
  if (/^\+[1-9]\d{7,14}$/.test(cleaned)) return cleaned;
  if (/^9\d{8}$/.test(cleaned)) return `+51${cleaned}`;
  if (/^51\d{9}$/.test(cleaned)) return `+${cleaned}`;
  return null;
}
