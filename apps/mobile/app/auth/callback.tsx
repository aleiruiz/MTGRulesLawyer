import { useEffect, useState } from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import { Link, useLocalSearchParams, useRouter } from "expo-router";
import { useAuth } from "../../src/auth/AuthProvider";
import { completeOAuthCallback, getAuthRedirectUrl } from "../../src/auth/oauth";

export default function AuthCallbackScreen() {
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
      setCallbackError(error instanceof Error ? error.message : "Sign-in could not be completed.");
    });
  }, [code, error, errorDescription]);

  return (
    <View style={styles.page}>
      {loading || (code && !session && !errorMessage) ? (
        <ActivityIndicator color="#1f5d50" />
      ) : null}
      <Text accessibilityRole={errorMessage ? "alert" : "text"} style={styles.message}>
        {errorMessage
          ? `Sign-in did not finish: ${errorMessage}`
          : loading || (code && !session)
            ? "Finishing sign-in…"
            : "Sign-in could not be completed."}
      </Text>
      {errorMessage || (!loading && !session) ? (
        <Link href="/sign-in">Return to sign in</Link>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, justifyContent: "center", alignItems: "center", padding: 24, gap: 16 },
  message: { color: "#18312f", fontSize: 16, textAlign: "center" },
});
