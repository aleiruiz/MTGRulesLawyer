/**
 * Turns Supabase's TOTP `qr_code` data URI into scalable SVG markup, or null when it cannot be read.
 * Supabase sends unencoded SVGo output (`<?xml …?>`, a comment, then `<svg width height>` with no
 * viewBox), so drop the prolog and add a viewBox to let the QR scale without being cropped.
 */
export function totpQrSvg(dataUri: string | undefined): string | null {
  if (!dataUri?.startsWith("data:image/svg+xml")) return null;
  const comma = dataUri.indexOf(",");
  if (comma < 0) return null;
  const header = dataUri.slice(0, comma);
  const payload = dataUri.slice(comma + 1);
  let source: string;
  try {
    source = header.endsWith(";base64") ? atob(payload) : decodeURIComponent(payload);
  } catch {
    // Raw SVG can contain a literal "%" that is not an escape.
    source = payload;
  }
  const start = source.search(/<svg[\s>]/);
  if (start < 0) return null;
  const svg = source.slice(start);
  const tag = /^<svg[^>]*>/.exec(svg)?.[0];
  if (!tag) return null;
  if (/\sviewBox=/.test(tag)) return svg;
  const width = /\swidth="(\d+(?:\.\d+)?)"/.exec(tag)?.[1];
  const height = /\sheight="(\d+(?:\.\d+)?)"/.exec(tag)?.[1];
  if (!width || !height) return null;
  return `<svg viewBox="0 0 ${width} ${height}"${svg.slice(4)}`;
}
