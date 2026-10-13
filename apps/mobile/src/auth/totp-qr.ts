/** Turns Supabase's TOTP `qr_code` data URI into SVG markup, or null when it cannot be read. */
export function totpQrSvg(dataUri: string | undefined): string | null {
  if (!dataUri?.startsWith("data:image/svg+xml")) return null;
  const comma = dataUri.indexOf(",");
  if (comma < 0) return null;
  const header = dataUri.slice(0, comma);
  const payload = dataUri.slice(comma + 1);
  try {
    const svg = header.endsWith(";base64") ? atob(payload) : decodeURIComponent(payload);
    return svg.trimStart().startsWith("<svg") ? svg : null;
  } catch {
    return null;
  }
}
