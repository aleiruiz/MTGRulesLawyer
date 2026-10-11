import { createContext, useContext, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import * as Linking from "expo-linking";
import type { Session } from "@supabase/supabase-js";
import { AppState, Platform } from "react-native";
import { completeOAuthCallback, signInWithSocialProvider } from "./oauth";
import type { SocialProvider, SocialSignInResult } from "./oauth";
import { supabase } from "./supabase";

interface AuthContextValue {
  session: Session | null;
  loading: boolean;
  signIn: (provider: SocialProvider) => Promise<SocialSignInResult>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    const { data } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
      setLoading(false);
    });
    const handleUrl = async (url: string) => {
      try {
        await completeOAuthCallback(url);
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : "Sign-in could not be completed.";
        console.warn(message);
      }
    };
    const appStateSubscription =
      Platform.OS === "web"
        ? null
        : AppState.addEventListener("change", (state) => {
            if (state === "active") void supabase.auth.startAutoRefresh();
            else void supabase.auth.stopAutoRefresh();
          });
    void (async () => {
      const url = await Linking.getInitialURL();
      if (url) await handleUrl(url);
      const { data: sessionData, error } = await supabase.auth.getSession();
      if (!active) return;
      if (error) console.warn("Could not restore the saved sign-in session.", error.message);
      setSession(sessionData.session);
      setLoading(false);
    })().catch((error: unknown) => {
      const message =
        error instanceof Error ? error.message : "Could not restore the sign-in session.";
      console.warn(message);
      if (active) setLoading(false);
    });

    return () => {
      active = false;
      data.subscription.unsubscribe();
      appStateSubscription?.remove();
    };
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      session,
      loading,
      signIn: signInWithSocialProvider,
      signOut: async () => {
        const { error } = await supabase.auth.signOut();
        if (error) throw error;
      },
    }),
    [loading, session],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used inside AuthProvider.");
  return context;
}
