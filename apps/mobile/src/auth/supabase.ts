import "react-native-url-polyfill/auto";
import * as SecureStore from "expo-secure-store";
import { createClient } from "@supabase/supabase-js";
import { Platform } from "react-native";
import {
  hasSupabaseClientConfig,
  SUPABASE_PLACEHOLDER_PUBLISHABLE_KEY,
  SUPABASE_PLACEHOLDER_URL,
} from "./supabase-config";

const configuredUrl = process.env.EXPO_PUBLIC_SUPABASE_URL?.trim() ?? "";
const configuredKey = process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim() ?? "";

export const isSupabaseConfigured = hasSupabaseClientConfig(configuredUrl, configuredKey);

const memoryStorage = new Map<string, string>();
const webStorage = {
  getItem: (key: string) => Promise.resolve(memoryStorage.get(key) ?? null),
  setItem: (key: string, value: string) => {
    memoryStorage.set(key, value);
    return Promise.resolve();
  },
  removeItem: (key: string) => {
    memoryStorage.delete(key);
    return Promise.resolve();
  },
};

const secureStorage = {
  getItem: (key: string) => SecureStore.getItemAsync(key),
  setItem: (key: string, value: string) => SecureStore.setItemAsync(key, value),
  removeItem: (key: string) => SecureStore.deleteItemAsync(key),
};

export const supabase = createClient(
  configuredUrl || SUPABASE_PLACEHOLDER_URL,
  configuredKey || SUPABASE_PLACEHOLDER_PUBLISHABLE_KEY,
  {
    auth: {
      storage: Platform.OS === "web" ? webStorage : secureStorage,
      autoRefreshToken: true,
      detectSessionInUrl: false,
      flowType: "pkce",
      persistSession: true,
    },
  },
);
