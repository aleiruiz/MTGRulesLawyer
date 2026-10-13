import { useEffect, useState } from "react";
import { ActivityIndicator, StyleSheet, View } from "react-native";
import Text from "../../src/ui/Text";
import { Link, useLocalSearchParams, useRouter } from "expo-router";
import { useAuth } from "../../src/auth/AuthProvider";
import { completeOAuthCallback, getAuthRedirectUrl } from "../../src/auth/oauth";
import { colors } from "../../src/theme";
import { useT } from "../../src/i18n/LanguageProvider";
import { strings } from "../../src/i18n/core";

export default function AuthCallbackScreen() {
  const { t } = useT();
  const { loading, session } = useAuth();
  const router = useRouter();
  const params = useLocalSearchParams<{
    code?: string;
    error?: string;
    error_description?: string;
  }>();
  const [callbackError, setCallbackError] = useState("");
  const { code, error, error_description: errorDescription } = params;
  const errorMessage = callbackError || errorDescription || error || "";

  useEffect(() => {
    if (!loading && session && !errorMessage) router.replace("/");
  }, [errorMessage, loading, router, session]);

  useEffect(() => {
    const callbackUrl = new URL(getAuthRedirectUrl());
    if (code) callbackUrl.searchParams.set("code", code);
    if (error) callbackUrl.searchParams.set("error", error);
    if (errorDescription) callbackUrl.searchParams.set("error_description", errorDescription);
    void completeOAuthCallback(callbackUrl.toString()).catch((error: unknown) => {
      setCallbackError(error instanceof Error ? error.message : strings().account.signInFailed);
    });
  }, [code, error, errorDescription]);

  return (
    <View style={styles.page}>
      {loading || (code && !session && !errorMessage) ? (
        <ActivityIndicator color={colors.accent} />
      ) : null}
      <Text accessibilityRole={errorMessage ? "alert" : "text"} style={styles.message}>
        {errorMessage
          ? t.auth.didNotFinish(errorMessage)
          : loading || (code && !session)
            ? t.auth.finishing
            : t.account.signInFailed}
      </Text>
      {errorMessage || (!loading && !session) ? (
        <Link href="/sign-in">{t.auth.returnToSignIn}</Link>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, justifyContent: "center", alignItems: "center", padding: 24, gap: 16 },
  message: { color: colors.text, fontSize: 16, textAlign: "center" },
});
