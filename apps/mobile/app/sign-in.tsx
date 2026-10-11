import { useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useAuth } from "../src/auth/AuthProvider";
import { SOCIAL_PROVIDERS } from "../src/auth/oauth";
import type { SocialProvider } from "../src/auth/oauth";
import { isSupabaseConfigured } from "../src/auth/supabase";

const providerLabels: Record<SocialProvider, string> = {
  google: "Continue with Google",
  apple: "Continue with Apple",
  github: "Continue with GitHub",
};

export default function SignInScreen() {
  const { session, signIn, signOut } = useAuth();
  const [pendingProvider, setPendingProvider] = useState<SocialProvider | null>(null);
  const [message, setMessage] = useState("");

  async function beginSignIn(provider: SocialProvider) {
    setPendingProvider(provider);
    setMessage("");
    try {
      const result = await signIn(provider);
      if (result === "cancelled") setMessage("Sign-in was cancelled.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Sign-in could not be completed.");
    } finally {
      setPendingProvider(null);
    }
  }

  async function beginSignOut() {
    setMessage("");
    try {
      await signOut();
      setMessage("You are signed out.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Sign-out could not be completed.");
    }
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.page}>
        <Text style={styles.title}>Sign in</Text>
        <Text style={styles.description}>
          Sign in to use account features. Public rules questions remain available without an
          account.
        </Text>
        {session ? (
          <>
            <Text accessibilityRole="text" style={styles.signedIn}>
              You are signed in.
            </Text>
            <Pressable
              accessibilityRole="button"
              onPress={() => void beginSignOut()}
              style={styles.button}
            >
              <Text style={styles.buttonText}>Sign out</Text>
            </Pressable>
          </>
        ) : (
          <>
            {!isSupabaseConfigured ? (
              <Text style={styles.setup}>
                Add the Supabase URL and publishable key to the local environment to enable sign-in.
              </Text>
            ) : null}
            {SOCIAL_PROVIDERS.map((provider) => (
              <Pressable
                key={provider}
                accessibilityRole="button"
                disabled={!isSupabaseConfigured || pendingProvider !== null}
                onPress={() => void beginSignIn(provider)}
                style={({ pressed }) => [
                  styles.button,
                  (!isSupabaseConfigured || pendingProvider !== null) && styles.disabled,
                  pressed && styles.pressed,
                ]}
              >
                {pendingProvider === provider ? (
                  <ActivityIndicator color="#ffffff" />
                ) : (
                  <Text style={styles.buttonText}>{providerLabels[provider]}</Text>
                )}
              </Pressable>
            ))}
          </>
        )}
        {message ? (
          <Text accessibilityLiveRegion="polite" accessibilityRole="alert" style={styles.message}>
            {message}
          </Text>
        ) : null}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: "#f4f6f1" },
  page: { flex: 1, justifyContent: "center", padding: 24, gap: 14 },
  title: { color: "#18312f", fontSize: 28, fontWeight: "800" },
  description: { color: "#49615c", fontSize: 16, lineHeight: 23, marginBottom: 8 },
  setup: { padding: 12, borderRadius: 8, backgroundColor: "#fff2d6", color: "#674b0b" },
  signedIn: { color: "#1f5d50", fontWeight: "700" },
  button: {
    minHeight: 48,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 10,
    backgroundColor: "#1f5d50",
    paddingHorizontal: 16,
  },
  buttonText: { color: "#ffffff", fontSize: 16, fontWeight: "700" },
  disabled: { opacity: 0.48 },
  pressed: { opacity: 0.75 },
  message: { color: "#7c2932", fontWeight: "600" },
});
