import { strings } from "../i18n/core";

export type AdminAccessDenial = "mfa_required" | "reauthentication_required" | "not_admin";

/** Maps an admin API 403 response to the step the reviewer needs to take. */
export async function readAdminAccessDenial(response: Response): Promise<AdminAccessDenial | null> {
  if (response.status !== 403) return null;
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return "not_admin";
  }
  const error = typeof body === "object" && body !== null && "error" in body ? body.error : null;
  if (error === "ADMIN_MFA_REQUIRED") return "mfa_required";
  if (error === "ADMIN_REAUTHENTICATION_REQUIRED") return "reauthentication_required";
  return "not_admin";
}

export function adminAccessMessage(denial: AdminAccessDenial): string {
  const t = strings().auth;
  if (denial === "mfa_required") return t.adminMfaRequired;
  if (denial === "reauthentication_required") return t.adminReauth;
  return t.adminRequired;
}
