export interface VerifiedIdentity {
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
    if (response.status === 401 || response.status === 403) return null;
    if (!response.ok) throw new AuthVerificationUnavailableError();

    let user: unknown;
    try {
      user = await response.json();
    } catch {
      throw new AuthVerificationUnavailableError();
    }
    if (!isRecord(user) || typeof user.id !== "string") return null;
    return { subject: user.id };
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
