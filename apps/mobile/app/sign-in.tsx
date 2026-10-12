import { useState } from "react";
import { ActivityIndicator, Alert, Platform, Pressable, StyleSheet, View } from "react-native";
import Text from "../src/ui/Text";
import { SafeAreaView } from "react-native-safe-area-context";
import { Link } from "expo-router";
import { apiUrl } from "../src/api-url";
import { useAuth } from "../src/auth/AuthProvider";
import { SOCIAL_PROVIDERS } from "../src/auth/oauth";
import type { SocialProvider } from "../src/auth/oauth";
import { isSupabaseConfigured, supabase } from "../src/auth/supabase";
import AdminReviewLink from "../src/reviews/AdminReviewLink";
import { colors, fonts } from "../src/theme";

const providerLabels: Record<SocialProvider, string> = {
  google: "Continue with Google",
  apple: "Continue with Apple",
  github: "Continue with GitHub",
};

export default function SignInScreen() {
  const { session, signIn, signOut } = useAuth();
  const [pendingProvider, setPendingProvider] = useState<SocialProvider | null>(null);
  const [message, setMessage] = useState("");
  const [deleting, setDeleting] = useState(false);

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

  async function deleteAccount() {
    if (!session) return;
    setDeleting(true);
    setMessage("");
    try {
      const response = await fetch(`${apiUrl}/api/me`, {
        method: "DELETE",
        headers: { authorization: `Bearer ${session.access_token}` },
      });
      if (response.status === 502) {
        setMessage(
          "Your app data was deleted, but your sign-in could not be removed. Try deleting again.",
        );
        return;
      }
      if (response.status === 401) {
        // The sign-in is no longer valid, for example because a previous attempt already
        // removed it; clear this device's session so the player can sign in again if needed.
        await supabase.auth.signOut({ scope: "local" });
        setMessage("Your sign-in is no longer valid. If your account still exists, sign in again.");
        return;
      }
      if (!response.ok) {
        setMessage("Account deletion is unavailable right now. Nothing was deleted.");
        return;
      }
      // The server already removed the sign-in identity, so only clear this device's session.
      try {
        await supabase.auth.signOut({ scope: "local" });
      } catch {
        // Deletion succeeded; the API rejects the stale local session anyway.
      }
      setMessage("Your account and its data were deleted.");
    } catch {
      setMessage("Account deletion is unavailable right now. Check your connection.");
    } finally {
      setDeleting(false);
    }
  }

  function confirmDeleteAccount() {
    const warning =
      "This permanently deletes your account and your challenges. Reviewed challenges stay for the audit record without your name or text. This cannot be undone.";
    if (Platform.OS === "web") {
      if (globalThis.confirm?.(warning)) void deleteAccount();
      return;
    }
    Alert.alert("Delete account?", warning, [
      { text: "Cancel", style: "cancel" },
      { text: "Delete", style: "destructive", onPress: () => void deleteAccount() },
    ]);
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
        <Text style={styles.title}>{session ? "Your account" : "Sign in"}</Text>
        <Text style={styles.description}>
          {session
            ? "Track the rulings you challenged and manage your session."
            : "Sign in to use account features. Public rules questions remain available without an account."}
        </Text>
        {session ? (
          <>
            <Text accessibilityRole="text" style={styles.signedIn}>
              You are signed in.
            </Text>
            <Link href="/challenges" asChild>
              <Pressable accessibilityRole="button" style={styles.secondaryButton}>
                <Text style={styles.secondaryButtonText}>Track my challenges</Text>
              </Pressable>
            </Link>
            <AdminReviewLink />
            <Pressable
              accessibilityRole="button"
              onPress={() => void beginSignOut()}
              style={styles.button}
            >
              <Text style={styles.buttonText}>Sign out</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ disabled: deleting }}
              disabled={deleting}
              onPress={confirmDeleteAccount}
              style={({ pressed }) => [
                styles.deleteButton,
                deleting && styles.disabled,
                pressed && styles.pressed,
              ]}
            >
              {deleting ? (
                <ActivityIndicator color={colors.danger} />
              ) : (
                <Text style={styles.deleteButtonText}>Delete account</Text>
              )}
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
                  <ActivityIndicator color={colors.ink} />
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
  safeArea: { flex: 1, backgroundColor: colors.background },
  page: { flex: 1, justifyContent: "center", padding: 24, gap: 14 },
  title: { color: colors.goldBright, fontFamily: fonts.display, fontSize: 28 },
  description: { color: colors.textMuted, fontSize: 16, lineHeight: 23, marginBottom: 8 },
  setup: {
    padding: 12,
    borderRadius: 8,
    backgroundColor: colors.warningSurface,
    color: colors.warning,
  },
  signedIn: { color: colors.goldBright, fontWeight: "700" },
  button: {
    minHeight: 48,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 10,
    backgroundColor: colors.gold,
    paddingHorizontal: 16,
  },
  buttonText: { color: colors.ink, fontSize: 16, fontWeight: "700" },
  secondaryButton: {
    minHeight: 48,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1.5,
    borderColor: colors.gold,
    borderRadius: 10,
    paddingHorizontal: 16,
  },
  secondaryButtonText: { color: colors.goldBright, fontSize: 16, fontWeight: "700" },
  deleteButton: {
    minHeight: 48,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: colors.danger,
    borderRadius: 10,
    paddingHorizontal: 16,
  },
  deleteButtonText: { color: colors.danger, fontSize: 16, fontWeight: "700" },
  disabled: { opacity: 0.48 },
  pressed: { opacity: 0.75 },
  message: { color: colors.danger, fontWeight: "600" },
});
