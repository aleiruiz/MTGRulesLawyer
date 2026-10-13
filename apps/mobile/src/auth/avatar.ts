import type { Session } from "@supabase/supabase-js";

/** The profile picture Google or GitHub shared at sign-in, if it is a plain https URL. */
export function avatarUrl(session: Session | null): string | null {
  const metadata: Record<string, unknown> = session?.user.user_metadata ?? {};
  for (const key of ["avatar_url", "picture"]) {
    const value = metadata[key];
    if (typeof value === "string" && value.startsWith("https://")) return value;
  }
  return null;
}
