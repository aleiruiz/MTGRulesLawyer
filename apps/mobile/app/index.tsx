import { useEffect, useState } from "react";
import { ActivityIndicator, Platform, StyleSheet, Text, View } from "react-native";
import { StatusBar } from "expo-status-bar";
import { healthResponseSchema } from "@mtg-rules/contracts";

const localApiUrl = Platform.OS === "android" ? "http://10.0.2.2:3000" : "http://localhost:3000";
const apiUrl = process.env.EXPO_PUBLIC_API_URL || localApiUrl;

export default function HomeScreen() {
  const [message, setMessage] = useState("Checking API…");

  useEffect(() => {
    let active = true;

    fetch(`${apiUrl}/health`)
      .then(async (response) => {
        if (!response.ok) throw new Error("API unavailable");
        return healthResponseSchema.parse(await response.json());
      })
      .then((health) => {
        if (active) setMessage(`API ${health.status}`);
      })
      .catch(() => {
        if (active) setMessage("API unavailable. Start the local API to connect.");
      });

    return () => {
      active = false;
    };
  }, []);

  return (
    <View style={styles.container}>
      <StatusBar style="auto" />
      <Text style={styles.title}>MTG Rules Lawyer</Text>
      <Text style={styles.subtitle}>Unofficial Magic rules research assistant</Text>
      <ActivityIndicator accessibilityLabel="Checking API" />
      <Text accessibilityLiveRegion="polite">{message}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: "center", justifyContent: "center", gap: 12, padding: 24 },
  title: { fontSize: 28, fontWeight: "700" },
  subtitle: { fontSize: 16, textAlign: "center" },
});
