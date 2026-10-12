import { useEffect, useState } from "react";
import * as Linking from "expo-linking";
import { router } from "expo-router";
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useAuth } from "../src/auth/AuthProvider";
import { supabase } from "../src/auth/supabase";

interface PendingEnrollment {
  factorId: string;
  secret: string;
  uri: string;
}

// Keeps an unfinished setup key while the app runs, so leaving and reopening this screen does not
// replace a key the admin may already have added to their authenticator app.
const pendingEnrollments = new Map<string, PendingEnrollment>();

/** Admin step-up: enroll an authenticator app once, then enter a fresh code before reviewing. */
export default function AdminVerifyScreen() {
  const { session, loading: authLoading } = useAuth();
  const [factorId, setFactorId] = useState<string | null>(null);
  const [enrollment, setEnrollment] = useState<PendingEnrollment | null>(null);
  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(true);
  const [verifying, setVerifying] = useState(false);
  const [message, setMessage] = useState("");
  const [setupFailed, setSetupFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const userId = session?.user.id;

  useEffect(() => {
    let active = true;
    // Never keep another account's setup key on screen while this account's factors load.
    setFactorId(null);
    setEnrollment(null);
    setCode("");
    if (!userId) {
      setLoading(false);
      return () => {
        active = false;
      };
    }
    setLoading(true);
    setSetupFailed(false);
    setMessage("");
    void (async () => {
      const { data, error } = await supabase.auth.mfa.listFactors();
      if (error) throw error;
      const verified = data.totp[0];
      if (verified) {
        pendingEnrollments.delete(userId);
        if (active) setFactorId(verified.id);
        return;
      }
      const pending = pendingEnrollments.get(userId);
      if (
        pending &&
        data.all.some((factor) => factor.id === pending.factorId && factor.status === "unverified")
      ) {
        if (!active) return;
        setFactorId(pending.factorId);
        setEnrollment(pending);
        return;
      }
      // An abandoned enrollment cannot be completed without its secret, so start a new one.
      for (const factor of data.all) {
        if (factor.factor_type === "totp" && factor.status === "unverified") {
          const { error: unenrollError } = await supabase.auth.mfa.unenroll({
            factorId: factor.id,
          });
          if (unenrollError) throw unenrollError;
        }
      }
      const { data: enrolled, error: enrollError } = await supabase.auth.mfa.enroll({
        factorType: "totp",
        friendlyName: "MTG Rules Lawyer admin",
      });
      if (enrollError) throw enrollError;
      const created = {
        factorId: enrolled.id,
        secret: enrolled.totp.secret,
        uri: enrolled.totp.uri,
      };
      pendingEnrollments.set(userId, created);
      if (!active) return;
      setFactorId(created.factorId);
      setEnrollment(created);
    })()
      .catch(() => {
        if (!active) return;
        setSetupFailed(true);
        setMessage("Authenticator setup is unavailable. Check your connection and try again.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [userId, attempt]);

  async function verify() {
    if (!factorId) return;
    const trimmed = code.trim();
    if (!/^\d{6}$/.test(trimmed)) {
      setMessage("Enter the 6-digit code from your authenticator app.");
      return;
    }
    setVerifying(true);
    setMessage("");
    try {
      const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId, code: trimmed });
      if (error) {
        setMessage("That code was not accepted. Check the time on your device and try again.");
        return;
      }
      setCode("");
      if (userId) pendingEnrollments.delete(userId);
      if (router.canGoBack()) router.back();
      else router.replace("/review-queue");
    } catch {
      setMessage("Verification is unavailable. Check your connection and try again.");
    } finally {
      setVerifying(false);
    }
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.page}>
        <Text accessibilityRole="header" style={styles.title}>
          Verify admin identity
        </Text>
        {authLoading || loading ? (
          <ActivityIndicator accessibilityLabel="Loading authenticator setup" />
        ) : null}
        {!session && !authLoading ? (
          <Text style={styles.description}>Sign in with an admin account first.</Text>
        ) : null}
        {enrollment ? (
          <View style={styles.setup}>
            <Text style={styles.description}>
              Add this account to an authenticator app, then enter the code it shows. You will only
              need to do this once.
            </Text>
            <Pressable
              accessibilityRole="button"
              onPress={() => void Linking.openURL(enrollment.uri).catch(() => undefined)}
              style={styles.secondaryButton}
            >
              <Text style={styles.secondaryButtonText}>Open authenticator app</Text>
            </Pressable>
            <Text style={styles.meta}>Or enter this setup key manually:</Text>
            <Text selectable accessibilityLabel="Authenticator setup key" style={styles.secret}>
              {enrollment.secret}
            </Text>
          </View>
        ) : factorId ? (
          <Text style={styles.description}>
            Enter the current code from your authenticator app to continue reviewing challenges.
          </Text>
        ) : null}
        {factorId ? (
          <>
            <TextInput
              accessibilityLabel="Authenticator code"
              autoComplete="one-time-code"
              inputMode="numeric"
              keyboardType="number-pad"
              maxLength={6}
              onChangeText={setCode}
              placeholder="123456"
              style={styles.input}
              textContentType="oneTimeCode"
              value={code}
            />
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ disabled: verifying }}
              disabled={verifying}
              onPress={() => void verify()}
              style={[styles.button, verifying && styles.disabled]}
            >
              {verifying ? (
                <ActivityIndicator color="#ffffff" />
              ) : (
                <Text style={styles.buttonText}>Verify</Text>
              )}
            </Pressable>
          </>
        ) : null}
        {message ? (
          <Text accessibilityLiveRegion="polite" accessibilityRole="alert" style={styles.message}>
            {message}
          </Text>
        ) : null}
        {setupFailed ? (
          <Pressable
            accessibilityRole="button"
            onPress={() => setAttempt((current) => current + 1)}
            style={styles.secondaryButton}
          >
            <Text style={styles.secondaryButtonText}>Try again</Text>
          </Pressable>
        ) : null}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: "#f4f6f1" },
  page: { width: "100%", maxWidth: 560, alignSelf: "center", padding: 24, gap: 14 },
  title: { color: "#18312f", fontSize: 28, fontWeight: "800" },
  description: { color: "#49615c", fontSize: 16, lineHeight: 23 },
  setup: { gap: 10 },
  meta: { color: "#5b5a55", fontSize: 13 },
  secret: {
    padding: 12,
    borderRadius: 8,
    backgroundColor: "#ffffff",
    color: "#18312f",
    fontFamily: "monospace",
    fontSize: 16,
    letterSpacing: 1,
  },
  input: {
    minHeight: 48,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderColor: "#9caaa2",
    borderRadius: 8,
    backgroundColor: "#ffffff",
    fontSize: 20,
    letterSpacing: 4,
  },
  button: {
    minHeight: 48,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 10,
    backgroundColor: "#1f5d50",
    paddingHorizontal: 16,
  },
  buttonText: { color: "#ffffff", fontSize: 16, fontWeight: "700" },
  secondaryButton: {
    minHeight: 44,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "#1f5d50",
    borderRadius: 10,
    paddingHorizontal: 16,
  },
  secondaryButtonText: { color: "#1f5d50", fontSize: 15, fontWeight: "700" },
  disabled: { opacity: 0.48 },
  message: { color: "#7c2932", fontWeight: "600" },
});
