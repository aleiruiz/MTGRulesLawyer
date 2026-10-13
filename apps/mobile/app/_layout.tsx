import { useEffect, useState } from "react";
import { StyleSheet, View } from "react-native";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useFonts } from "expo-font";
import {
  Spectral_400Regular,
  Spectral_400Regular_Italic,
  Spectral_600SemiBold,
} from "@expo-google-fonts/spectral";
import {
  InstrumentSans_400Regular,
  InstrumentSans_500Medium,
  InstrumentSans_600SemiBold,
} from "@expo-google-fonts/instrument-sans";
import { IBMPlexMono_400Regular, IBMPlexMono_500Medium } from "@expo-google-fonts/ibm-plex-mono";
import { AuthProvider, useAuth } from "../src/auth/AuthProvider";
import LoadingScreen from "../src/ui/LoadingScreen";
import { FontsReadyContext } from "../src/ui/fonts-ready";
import { colors, fonts } from "../src/theme";
import { LanguageProvider, useT } from "../src/i18n/LanguageProvider";

// Keeps the loading screen up long enough to read instead of flashing for a frame.
const MIN_SPLASH_MS = 1_200;

function AppStack() {
  const { loading: authLoading } = useAuth();
  const { t } = useT();
  const [fontsLoaded, fontError] = useFonts({
    Spectral_400Regular,
    Spectral_400Regular_Italic,
    Spectral_600SemiBold,
    InstrumentSans_400Regular,
    InstrumentSans_500Medium,
    InstrumentSans_600SemiBold,
    IBMPlexMono_400Regular,
    IBMPlexMono_500Medium,
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
              headerTintColor: colors.text,
              headerTitleStyle: fontsLoaded
                ? { fontFamily: fonts.bodyMedium, fontSize: 16, color: colors.textMuted }
                : undefined,
              headerShadowVisible: false,
              contentStyle: { backgroundColor: colors.background },
            }}
          >
            <Stack.Screen name="index" options={{ title: t.titles.home, headerShown: false }} />
            <Stack.Screen name="sign-in" options={{ title: t.titles.account }} />
            <Stack.Screen name="challenges" options={{ title: t.titles.disputes }} />
            <Stack.Screen name="dispute" options={{ title: t.titles.dispute }} />
            <Stack.Screen name="review-queue" options={{ title: t.titles.reviewQueue }} />
            <Stack.Screen name="admin-verify" options={{ title: t.titles.adminVerify }} />
            <Stack.Screen name="rulings" options={{ title: t.titles.sharedRuling }} />
            <Stack.Screen name="table" options={{ title: t.titles.table }} />
            <Stack.Screen name="chat" options={{ title: t.titles.ruling }} />
            <Stack.Screen name="privacy" options={{ title: t.titles.privacy }} />
            <Stack.Screen name="terms" options={{ title: t.titles.terms }} />
            <Stack.Screen
              name="auth/callback"
              options={{ title: t.titles.signInCallback, headerBackVisible: false }}
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
    <LanguageProvider>
      <AuthProvider>
        <AppStack />
      </AuthProvider>
    </LanguageProvider>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
});
