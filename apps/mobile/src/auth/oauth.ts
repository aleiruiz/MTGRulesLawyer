import { strings } from "../i18n/core";
import * as Linking from "expo-linking";
import * as WebBrowser from "expo-web-browser";
import type { Provider } from "@supabase/supabase-js";
import { Platform } from "react-native";
import { isSupabaseConfigured, supabase } from "./supabase";
import { readOAuthCode } from "./oauth-url";

export const SOCIAL_PROVIDERS = [
  "google",
  "apple",
  "github",
] as const satisfies readonly Provider[];
export type SocialProvider = (typeof SOCIAL_PROVIDERS)[number];
/** Providers offered on the sign-in screen. Apple waits for the iOS release and its developer account. */
export const ENABLED_SOCIAL_PROVIDERS: readonly SocialProvider[] = ["google", "github"];
export type SocialSignInResult = "signed_in" | "cancelled" | "redirected";

const handledCallbacks = new Map<string, Promise<void>>();

export function getOAuthCode(callbackUrl: string): string | null {
  return readOAuthCode(callbackUrl);
}

export async function completeOAuthCallback(callbackUrl: string): Promise<void> {
  const code = getOAuthCode(callbackUrl);
  if (!code) return Promise.resolve();

  const existing = handledCallbacks.get(code);
  if (existing) return existing;

  const exchange = supabase.auth.exchangeCodeForSession(code).then(({ error }) => {
    if (error) throw error;
  });
  handledCallbacks.set(code, exchange);
  if (handledCallbacks.size > 8) {
    const oldest = handledCallbacks.keys().next().value;
    if (oldest) handledCallbacks.delete(oldest);
  }
  return exchange;
}

export function getAuthRedirectUrl(): string {
  return Linking.createURL("auth/callback", { scheme: "mtgruleslawyer" });
}

export async function signInWithSocialProvider(
  provider: SocialProvider,
): Promise<SocialSignInResult> {
  if (!isSupabaseConfigured) {
    throw new Error(strings().auth.notConfigured);
  }

  const redirectTo = getAuthRedirectUrl();
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider,
    options: { redirectTo, skipBrowserRedirect: true },
  });
  if (error) throw error;
  if (!data.url) throw new Error(strings().auth.noUrl);

  if (Platform.OS === "web") {
    window.location.assign(data.url);
    return "redirected";
  }

  const result = await WebBrowser.openAuthSessionAsync(data.url, redirectTo);
  if (
    result.type === WebBrowser.WebBrowserResultType.CANCEL ||
    result.type === WebBrowser.WebBrowserResultType.DISMISS
  ) {
    return "cancelled";
  }
  if (result.type !== "success") throw new Error(strings().auth.windowClosed);
  await completeOAuthCallback(result.url);
  return "signed_in";
}
