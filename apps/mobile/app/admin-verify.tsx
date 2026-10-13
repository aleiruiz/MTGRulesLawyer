import { useEffect, useState } from "react";
import * as Linking from "expo-linking";
import { router } from "expo-router";
import { ActivityIndicator, Pressable, StyleSheet, View } from "react-native";
import TextInput from "../src/ui/TextInput";
import Text from "../src/ui/Text";
import { SvgXml } from "react-native-svg";
import { SafeAreaView } from "react-native-safe-area-context";
import { useAuth } from "../src/auth/AuthProvider";
import { supabase } from "../src/auth/supabase";
import { totpQrSvg } from "../src/auth/totp-qr";
import { colors, fonts } from "../src/theme";
import { useT } from "../src/i18n/LanguageProvider";
import { strings } from "../src/i18n/core";

interface PendingEnrollment {
  factorId: string;
  secret: string;
  uri: string;
  qrSvg: string | null;
}

// Keeps an unfinished setup key while the app runs, so leaving and reopening this screen does not
// replace a key the admin may already have added to their authenticator app.
const pendingEnrollments = new Map<string, PendingEnrollment>();

/** Admin step-up: enroll an authenticator app once, then enter a fresh code before reviewing. */
export default function AdminVerifyScreen() {
  const { session, loading: authLoading } = useAuth();
  const { t } = useT();
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
        qrSvg: totpQrSvg(enrolled.totp.qr_code),
      };
      pendingEnrollments.set(userId, created);
      if (!active) return;
      setFactorId(created.factorId);
      setEnrollment(created);
    })()
      .catch(() => {
        if (!active) return;
        setSetupFailed(true);
        setMessage(strings().adminVerify.setupUnavailable);
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
      setMessage(t.adminVerify.codeFormat);
      return;
    }
    setVerifying(true);
    setMessage("");
    try {
      const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId, code: trimmed });
      if (error) {
        setMessage(t.adminVerify.codeRejected);
        return;
      }
      setCode("");
      if (userId) pendingEnrollments.delete(userId);
      if (router.canGoBack()) router.back();
      else router.replace("/review-queue");
    } catch {
      setMessage(t.adminVerify.verifyUnavailable);
    } finally {
      setVerifying(false);
    }
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.page}>
        <Text accessibilityRole="header" style={styles.title}>
          {t.adminVerify.title}
        </Text>
        {authLoading || loading ? (
          <ActivityIndicator accessibilityLabel={t.adminVerify.loading} />
        ) : null}
        {!session && !authLoading ? (
          <Text style={styles.description}>{t.adminVerify.signInFirst}</Text>
        ) : null}
        {enrollment ? (
          <View style={styles.setup}>
            <Text style={styles.description}>
              {enrollment.qrSvg ? t.adminVerify.scanQr : t.adminVerify.addAccount}
            </Text>
            {enrollment.qrSvg ? (
              <View
                accessible
                accessibilityLabel={t.adminVerify.qrLabel}
                accessibilityRole="image"
                style={styles.qr}
              >
                <SvgXml xml={enrollment.qrSvg} width={200} height={200} />
              </View>
            ) : null}
            <Pressable
              accessibilityRole="button"
              onPress={() => void Linking.openURL(enrollment.uri).catch(() => undefined)}
              style={styles.secondaryButton}
            >
              <Text style={styles.secondaryButtonText}>{t.adminVerify.openApp}</Text>
            </Pressable>
            <Text style={styles.meta}>{t.adminVerify.manualKey}</Text>
            <Text selectable accessibilityLabel={t.adminVerify.setupKey} style={styles.secret}>
              {enrollment.secret}
            </Text>
          </View>
        ) : factorId ? (
          <Text style={styles.description}>{t.adminVerify.enterCode}</Text>
        ) : null}
        {factorId ? (
          <>
            <TextInput
              placeholderTextColor={colors.textSubtle}
              accessibilityLabel={t.adminVerify.codeLabel}
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
                <ActivityIndicator color={colors.accentInk} />
              ) : (
                <Text style={styles.buttonText}>{t.adminVerify.verify}</Text>
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
            <Text style={styles.secondaryButtonText}>{t.common.tryAgain}</Text>
          </Pressable>
        ) : null}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.background },
  page: { width: "100%", maxWidth: 560, alignSelf: "center", padding: 24, gap: 14 },
  title: { color: colors.accent, fontFamily: fonts.bodySemibold, fontSize: 28 },
  description: { color: colors.textMuted, fontSize: 16, lineHeight: 23 },
  setup: { gap: 10 },
  // Authenticator apps scan most reliably with dark modules on a light quiet zone.
  qr: { alignSelf: "center", padding: 12, borderRadius: 8, backgroundColor: "#ffffff" },
  meta: { color: colors.textMuted, fontSize: 13 },
  secret: {
    padding: 12,
    borderRadius: 8,
    backgroundColor: colors.surface,
    color: colors.text,
    fontFamily: "monospace",
    fontSize: 16,
    letterSpacing: 1,
  },
  input: {
    color: colors.text,
    minHeight: 48,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    backgroundColor: colors.surface,
    fontSize: 20,
    letterSpacing: 4,
  },
  button: {
    minHeight: 48,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 10,
    backgroundColor: colors.accent,
    paddingHorizontal: 16,
  },
  buttonText: { color: colors.accentInk, fontSize: 16, fontFamily: fonts.bodySemibold },
  secondaryButton: {
    minHeight: 44,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: colors.accent,
    borderRadius: 10,
    paddingHorizontal: 16,
  },
  secondaryButtonText: { color: colors.accent, fontSize: 15, fontFamily: fonts.bodySemibold },
  disabled: { opacity: 0.48 },
  message: { color: colors.danger, fontFamily: fonts.bodySemibold },
});
