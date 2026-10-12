import { useEffect, useState } from "react";
import { StyleSheet, View } from "react-native";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useFonts } from "expo-font";
import { Cinzel_700Bold, Cinzel_800ExtraBold } from "@expo-google-fonts/cinzel";
import {
  CormorantGaramond_500Medium_Italic,
  CormorantGaramond_600SemiBold,
} from "@expo-google-fonts/cormorant-garamond";
import { AuthProvider, useAuth } from "../src/auth/AuthProvider";
import LoadingScreen from "../src/ui/LoadingScreen";
import { FontsReadyContext } from "../src/ui/fonts-ready";
import { colors, fonts } from "../src/theme";

// Keeps the loading screen up long enough to read instead of flashing for a frame.
const MIN_SPLASH_MS = 1_200;

function AppStack() {
  const { loading: authLoading } = useAuth();
  const [fontsLoaded, fontError] = useFonts({
    Cinzel_700Bold,
    Cinzel_800ExtraBold,
    CormorantGaramond_500Medium_Italic,
    CormorantGaramond_600SemiBold,
  });
  const [minimumElapsed, setMinimumElapsed] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setMinimumElapsed(true), MIN_SPLASH_MS);
    return () => clearTimeout(timer);
  }, []);

  // A font failure falls back to system fonts rather than blocking the app.
  const fontsReady = fontsLoaded || fontError !== null;
  const showSplash = !fontsReady || authLoading || !minimumElapsed;

  // The navigator always mounts so deep links (sign-in return, shared rulings) resolve
  // while the loading screen covers it.
  return (
    <View style={styles.root}>
      <StatusBar style="light" />
      <View
        style={styles.root}
        accessibilityElementsHidden={showSplash}
        importantForAccessibility={showSplash ? "no-hide-descendants" : "auto"}
      >
        <FontsReadyContext.Provider value={fontsLoaded}>
          <Stack
            screenOptions={{
              headerStyle: { backgroundColor: colors.backgroundDeep },
              headerTintColor: colors.goldBright,
              headerTitleStyle: fontsLoaded ? { fontFamily: fonts.display } : undefined,
              headerShadowVisible: false,
              contentStyle: { backgroundColor: colors.background },
            }}
          >
            <Stack.Screen name="index" options={{ title: "Rules Lawyer", headerShown: false }} />
            <Stack.Screen name="sign-in" options={{ title: "Account" }} />
            <Stack.Screen name="challenges" options={{ title: "My challenges" }} />
            <Stack.Screen name="review-queue" options={{ title: "Challenge review" }} />
            <Stack.Screen name="admin-verify" options={{ title: "Verify identity" }} />
            <Stack.Screen name="rulings" options={{ title: "Shared ruling" }} />
            <Stack.Screen name="chat" options={{ title: "The judge" }} />
            <Stack.Screen
              name="auth/callback"
              options={{ title: "Sign in", headerBackVisible: false }}
            />
          </Stack>
        </FontsReadyContext.Provider>
      </View>
      {showSplash ? (
        <View style={StyleSheet.absoluteFill}>
          <LoadingScreen fontsReady={fontsLoaded} />
        </View>
      ) : null}
    </View>
  );
}

export default function RootLayout() {
  return (
    <AuthProvider>
      <AppStack />
    </AuthProvider>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
});
