import type { SessionAssurance } from "./admin-assurance.js";

export interface VerifiedIdentity extends SessionAssurance {
  subject: string;
}

export class AuthVerificationUnavailableError extends Error {
  constructor() {
    super("Supabase token verification is unavailable.");
    this.name = "AuthVerificationUnavailableError";
  }
}

export type AccessTokenVerifier = (accessToken: string) => Promise<VerifiedIdentity | null>;

/** Uses Supabase Auth's authenticated user endpoint to verify signature, issuer, expiry and audience. */
export function createSupabaseAccessTokenVerifier(options: {
  url: string;
  publishableKey: string;
  fetch?: typeof fetch;
}): AccessTokenVerifier {
  const endpoint = `${options.url.replace(/\/$/, "")}/auth/v1/user`;
  const fetcher = options.fetch ?? fetch;

  return async (accessToken) => {
    let response: Response;
    try {
      response = await fetcher(endpoint, {
        headers: { apikey: options.publishableKey, authorization: `Bearer ${accessToken}` },
        signal: AbortSignal.timeout(5_000),
      });
    } catch {
      throw new AuthVerificationUnavailableError();
    }
    // 404: the token is valid but its user was deleted, so it no longer identifies anyone.
    if (response.status === 401 || response.status === 403 || response.status === 404) return null;
    if (!response.ok) throw new AuthVerificationUnavailableError();

    let user: unknown;
    try {
      user = await response.json();
    } catch {
      throw new AuthVerificationUnavailableError();
    }
    if (!isRecord(user) || typeof user.id !== "string") return null;
    const claims = readAccessTokenClaims(accessToken);
    if (claims && claims.sub !== user.id) return null;
    return {
      subject: user.id,
      assuranceLevel: typeof claims?.aal === "string" ? claims.aal : null,
      authenticatedAt: latestAuthenticationTimestamp(claims?.amr),
    };
  };
}

/**
 * Reads claims from a token Supabase has already verified. Never base an access decision on this
 * for an unverified token: it does not check the signature.
 */
function readAccessTokenClaims(accessToken: string): Record<string, unknown> | null {
  const payload = accessToken.split(".")[1];
  if (!payload) return null;
  try {
    const claims: unknown = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    return isRecord(claims) ? claims : null;
  } catch {
    return null;
  }
}

/** Supabase lists each sign-in or factor verification in `amr` with a Unix-seconds timestamp. */
function latestAuthenticationTimestamp(amr: unknown): number | null {
  if (!Array.isArray(amr)) return null;
  let latest: number | null = null;
  for (const entry of amr) {
    if (!isRecord(entry) || typeof entry.timestamp !== "number") continue;
    if (!Number.isFinite(entry.timestamp)) continue;
    latest = latest === null ? entry.timestamp : Math.max(latest, entry.timestamp);
  }
  return latest;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
