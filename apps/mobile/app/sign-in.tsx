import { useState, type ComponentProps } from "react";
import { Alert, Platform, Pressable, ScrollView, StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { apiUrl } from "../src/api-url";
import { readAdminAccessDenial } from "../src/auth/admin-access";
import { useAuth } from "../src/auth/AuthProvider";
import { SOCIAL_PROVIDERS } from "../src/auth/oauth";
import type { SocialProvider } from "../src/auth/oauth";
import { isSupabaseConfigured, supabase } from "../src/auth/supabase";
import RecentRulings, { useRecentConversations } from "../src/home/RecentRulings";
import AdminReviewLink, { useIsAdmin } from "../src/reviews/AdminReviewLink";
import GlassesLogo from "../src/ui/GlassesLogo";
import Loader from "../src/ui/Loader";
import Text from "../src/ui/Text";
import { colors, eyebrow, fonts } from "../src/theme";

const providers: Record<
  SocialProvider,
  { label: string; name: string; icon: ComponentProps<typeof Ionicons>["name"] }
> = {
  google: { label: "Continue with Google", name: "Google", icon: "logo-google" },
  apple: { label: "Continue with Apple", name: "Apple", icon: "logo-apple" },
  github: { label: "Continue with GitHub", name: "GitHub", icon: "logo-github" },
};

function isSocialProvider(value: unknown): value is SocialProvider {
  return typeof value === "string" && value in providers;
}

export default function AccountScreen() {
  const { session, signIn, signOut } = useAuth();
  const isAdmin = useIsAdmin();
  const recent = useRecentConversations();
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
      if (response.status === 429) {
        setMessage("Too many deletion attempts. Wait an hour and try again. Nothing was deleted.");
        return;
      }
      const denial = await readAdminAccessDenial(response);
      if (denial === "mfa_required" || denial === "reauthentication_required") {
        setMessage("Admin accounts need a fresh authenticator code before they can be deleted.");
        router.push("/admin-verify");
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
      "This permanently deletes your account, your saved rulings and your disputes. Reviewed disputes stay for the audit record without your name or text. This cannot be undone.";
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

  const email = session?.user.email ?? "";
  const provider: unknown = session?.user.app_metadata.provider;
  const initial = (email.trim()[0] ?? "?").toUpperCase();

  return (
    <SafeAreaView edges={["bottom", "left", "right"]} style={styles.safeArea}>
      <ScrollView contentContainerStyle={styles.page}>
        {session ? (
          <>
            <View style={styles.profile}>
              <View style={styles.avatar}>
                <Text style={styles.avatarText}>{initial}</Text>
              </View>
              <View style={styles.profileText}>
                <Text numberOfLines={1} style={styles.name}>
                  {email || "Signed in"}
                </Text>
                <Text style={styles.detail}>
                  {[
                    isSocialProvider(provider)
                      ? `Signed in with ${providers[provider].name}`
                      : null,
                    isAdmin ? "Judge reviewer" : null,
                  ]
                    .filter(Boolean)
                    .join(" · ") || "Signed in"}
                </Text>
              </View>
            </View>

            <AdminReviewLink />

            <View style={styles.section}>
              <View style={styles.sectionHeader}>
                <Text style={eyebrow}>Your last 10 rulings</Text>
                <Text style={styles.detail}>Tap one to keep asking</Text>
              </View>
              {recent.loaded && recent.conversations.length === 0 && !recent.error ? (
                <Text style={styles.detail}>Rulings you ask while signed in are kept here.</Text>
              ) : null}
              <RecentRulings {...recent} hideTitle />
            </View>

            <Pressable
              accessibilityRole="button"
              onPress={() => router.push("/challenges")}
              style={({ pressed }) => [styles.linkRow, pressed && styles.pressed]}
            >
              <Ionicons name="flag-outline" size={18} color={colors.textSoft} />
              <Text style={styles.linkRowText}>Your disputes</Text>
              <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
            </Pressable>

            <View style={styles.section}>
              <Text style={eyebrow}>Account</Text>
              <Pressable
                accessibilityRole="button"
                onPress={() => void beginSignOut()}
                style={({ pressed }) => [styles.secondary, pressed && styles.pressed]}
              >
                <Text style={styles.secondaryText}>Sign out</Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ disabled: deleting }}
                disabled={deleting}
                onPress={confirmDeleteAccount}
                style={({ pressed }) => [
                  styles.secondary,
                  styles.danger,
                  deleting && styles.disabled,
                  pressed && styles.pressed,
                ]}
              >
                {deleting ? (
                  <Loader accessibilityLabel="Deleting account" size={7} color={colors.danger} />
                ) : (
                  <Text style={styles.dangerText}>Delete account and history</Text>
                )}
              </Pressable>
            </View>
          </>
        ) : (
          <View style={styles.signIn}>
            <GlassesLogo width={64} />
            <Text accessibilityRole="header" style={styles.heading}>
              Keep your rulings
            </Text>
            <Text style={styles.lead}>
              Sign in to keep your last 10 rulings and dispute a ruling. Asking the judge works
              without an account.
            </Text>
            {!isSupabaseConfigured ? (
              <Text style={styles.setup}>
                Add the Supabase URL and publishable key to the local environment to enable sign-in.
              </Text>
            ) : null}
            {SOCIAL_PROVIDERS.map((item) => (
              <Pressable
                key={item}
                accessibilityRole="button"
                accessibilityState={{ disabled: !isSupabaseConfigured || pendingProvider !== null }}
                disabled={!isSupabaseConfigured || pendingProvider !== null}
                onPress={() => void beginSignIn(item)}
                style={({ pressed }) => [
                  styles.provider,
                  (!isSupabaseConfigured || pendingProvider !== null) && styles.disabled,
                  pressed && styles.pressed,
                ]}
              >
                {pendingProvider === item ? (
                  <Loader accessibilityLabel="Signing in" size={7} />
                ) : (
                  <>
                    <Ionicons name={providers[item].icon} size={18} color={colors.text} />
                    <Text style={styles.providerText}>{providers[item].label}</Text>
                  </>
                )}
              </Pressable>
            ))}
          </View>
        )}

        {message ? (
          <Text accessibilityLiveRegion="polite" accessibilityRole="alert" style={styles.message}>
            {message}
          </Text>
        ) : null}

        <Text style={styles.notice}>
          Rules from the Comprehensive Rules. Card text and official rulings from Scryfall.
          Unofficial Fan Content permitted under the Fan Content Policy. Not approved/endorsed by
          Wizards.
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.background },
  page: {
    flexGrow: 1,
    width: "100%",
    maxWidth: 640,
    alignSelf: "center",
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 28,
    gap: 24,
  },
  profile: { flexDirection: "row", alignItems: "center", gap: 14 },
  avatar: {
    width: 52,
    height: 52,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: colors.accent,
    borderRadius: 26,
    backgroundColor: colors.accentSurface,
  },
  avatarText: { color: colors.accentText, fontFamily: fonts.displaySemibold, fontSize: 22 },
  profileText: { flex: 1, gap: 3 },
  name: { fontSize: 17 },
  detail: { color: colors.textMuted, fontSize: 12.5 },
  section: { gap: 10 },
  sectionHeader: { flexDirection: "row", alignItems: "baseline", justifyContent: "space-between" },
  linkRow: {
    minHeight: 52,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: colors.divider,
  },
  linkRowText: { flex: 1, fontSize: 15 },
  secondary: {
    minHeight: 48,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 16,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 24,
  },
  secondaryText: { fontSize: 15 },
  danger: { borderColor: colors.dangerSurface },
  dangerText: { color: colors.danger, fontSize: 15 },
  signIn: { flexGrow: 1, justifyContent: "center", gap: 14, paddingTop: 24 },
  heading: { fontFamily: fonts.display, fontSize: 30, lineHeight: 36 },
  lead: { color: colors.textSoft, fontSize: 15, lineHeight: 22, marginBottom: 6 },
  setup: {
    padding: 12,
    borderRadius: 12,
    backgroundColor: colors.warningSurface,
    color: colors.warning,
    fontSize: 13.5,
    lineHeight: 19,
  },
  provider: {
    minHeight: 52,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 26,
    backgroundColor: colors.surface,
  },
  providerText: { fontFamily: fonts.bodyMedium, fontSize: 15 },
  disabled: { opacity: 0.45 },
  pressed: { opacity: 0.75 },
  message: { color: colors.textSoft, fontFamily: fonts.bodyMedium },
  notice: { color: colors.textSubtle, fontSize: 11.5, lineHeight: 16 },
});
