export function readOAuthCode(callbackUrl: string): string | null {
  const callback = new URL(callbackUrl);
  const error =
    callback.searchParams.get("error_description") ?? callback.searchParams.get("error");
  if (error) throw new Error(error);
  return callback.searchParams.get("code");
}
