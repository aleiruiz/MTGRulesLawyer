import "react-native-url-polyfill/auto";
import * as SecureStore from "expo-secure-store";
import { createClient } from "@supabase/supabase-js";
import { Platform } from "react-native";
import { createChunkedSecureStorage } from "./chunked-secure-storage";
import {
  hasSupabaseClientConfig,
  SUPABASE_PLACEHOLDER_PUBLISHABLE_KEY,
  SUPABASE_PLACEHOLDER_URL,
} from "./supabase-config";

const configuredUrl = process.env.EXPO_PUBLIC_SUPABASE_URL?.trim() ?? "";
const configuredKey = process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim() ?? "";

export const isSupabaseConfigured = hasSupabaseClientConfig(configuredUrl, configuredKey);

// On the web the session and the PKCE verifier live in localStorage: sign-in leaves the page for
// the provider and comes back with a full reload, so in-memory storage would lose the verifier.
// Falls back to memory where localStorage is unavailable (private mode, blocked storage).
const memoryStorage = new Map<string, string>();
function browserStorage(): Storage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}
const webStorage = {
  getItem: (key: string) => {
    try {
      return Promise.resolve(browserStorage()?.getItem(key) ?? memoryStorage.get(key) ?? null);
    } catch {
      return Promise.resolve(memoryStorage.get(key) ?? null);
    }
  },
  setItem: (key: string, value: string) => {
    memoryStorage.set(key, value);
    try {
      browserStorage()?.setItem(key, value);
    } catch {
      // Quota or blocked storage: the in-memory copy still covers this page load.
    }
    return Promise.resolve();
  },
  removeItem: (key: string) => {
    memoryStorage.delete(key);
    try {
      browserStorage()?.removeItem(key);
    } catch {
      // Nothing stored there to remove.
    }
    return Promise.resolve();
  },
};

const secureStorage = {
  getItem: (key: string) => SecureStore.getItemAsync(key),
  setItem: (key: string, value: string) => SecureStore.setItemAsync(key, value),
  removeItem: (key: string) => SecureStore.deleteItemAsync(key),
};
const chunkedSecureStorage = createChunkedSecureStorage(secureStorage);

export const supabase = createClient(
  configuredUrl || SUPABASE_PLACEHOLDER_URL,
  configuredKey || SUPABASE_PLACEHOLDER_PUBLISHABLE_KEY,
  {
    auth: {
      storage: Platform.OS === "web" ? webStorage : chunkedSecureStorage,
      autoRefreshToken: true,
      detectSessionInUrl: false,
      flowType: "pkce",
      persistSession: true,
    },
  },
);
