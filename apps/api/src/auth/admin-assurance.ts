export interface SessionAssurance {
  /** Supabase `aal` claim: `aal2` means the session completed a second factor. */
  assuranceLevel?: string | null;
  /** Latest `amr` timestamp in Unix seconds: the most recent sign-in or factor verification. */
  authenticatedAt?: number | null;
}

export type AdminAssuranceResult = "allowed" | "mfa_required" | "reauthentication_required";

export const DEFAULT_ADMIN_AUTH_MAX_AGE_SECONDS = 60 * 60;
const MIN_ADMIN_AUTH_MAX_AGE_SECONDS = 60;
const MAX_ADMIN_AUTH_MAX_AGE_SECONDS = 24 * 60 * 60;

/** Reads ADMIN_AUTH_MAX_AGE_SECONDS (one hour when unset); an invalid value stops startup. */
export function readAdminAuthMaxAgeSeconds(value: string | undefined): number {
  if (value === undefined || value.trim() === "") return DEFAULT_ADMIN_AUTH_MAX_AGE_SECONDS;
  const seconds = Number(value);
  if (
    !Number.isSafeInteger(seconds) ||
    seconds < MIN_ADMIN_AUTH_MAX_AGE_SECONDS ||
    seconds > MAX_ADMIN_AUTH_MAX_AGE_SECONDS
  ) {
    throw new Error(
      `ADMIN_AUTH_MAX_AGE_SECONDS must be a whole number from ${MIN_ADMIN_AUTH_MAX_AGE_SECONDS} to ${MAX_ADMIN_AUTH_MAX_AGE_SECONDS}.`,
    );
  }
  return seconds;
}

/** Admin operations need a second factor and a sign-in or factor check within the allowed age. */
export function evaluateAdminAssurance(
  session: SessionAssurance | null,
  nowMs: number,
  maxAgeSeconds: number,
): AdminAssuranceResult {
  if (session?.assuranceLevel !== "aal2") return "mfa_required";
  const authenticatedAt = session.authenticatedAt;
  if (typeof authenticatedAt !== "number" || !Number.isFinite(authenticatedAt)) {
    return "reauthentication_required";
  }
  if (nowMs - authenticatedAt * 1_000 > maxAgeSeconds * 1_000) return "reauthentication_required";
  return "allowed";
}
