export const SUPABASE_PLACEHOLDER_URL = "https://your-project.supabase.co";
export const SUPABASE_PLACEHOLDER_PUBLISHABLE_KEY = "replace-me";

export function hasSupabaseClientConfig(url: string, publishableKey: string): boolean {
  const normalizedUrl = url.trim();
  const normalizedKey = publishableKey.trim();
  return (
    normalizedUrl.length > 0 &&
    normalizedKey.length > 0 &&
    normalizedUrl !== SUPABASE_PLACEHOLDER_URL &&
    normalizedKey !== SUPABASE_PLACEHOLDER_PUBLISHABLE_KEY
  );
}
