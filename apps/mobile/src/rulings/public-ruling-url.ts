export function buildPublicRulingUrl(rulingId: string, webBaseUrl: string): string {
  const base = webBaseUrl.trim().replace(/\/$/, "");
  return `${base}/rulings?id=${encodeURIComponent(rulingId)}`;
}

export function getPublicRulingUrl(rulingId: string, webBaseUrl?: string): string {
  const configuredBase = webBaseUrl?.trim() || process.env.EXPO_PUBLIC_WEB_URL?.trim();
  const currentWebOrigin =
    typeof window !== "undefined" && typeof window.location?.origin === "string"
      ? window.location.origin
      : undefined;
  return buildPublicRulingUrl(
    rulingId,
    configuredBase || currentWebOrigin || "http://localhost:8081",
  );
}
