import { Stack } from "expo-router";
import { AuthProvider } from "../src/auth/AuthProvider";

export default function RootLayout() {
  return (
    <AuthProvider>
      <Stack>
        <Stack.Screen name="index" options={{ title: "MTG Rules Lawyer", headerShown: false }} />
        <Stack.Screen name="sign-in" options={{ title: "Sign in" }} />
        <Stack.Screen name="challenges" options={{ title: "My challenges" }} />
        <Stack.Screen name="review-queue" options={{ title: "Challenge review" }} />
        <Stack.Screen name="admin-verify" options={{ title: "Verify identity" }} />
        <Stack.Screen name="rulings" options={{ title: "Shared ruling" }} />
        <Stack.Screen
          name="auth/callback"
          options={{ title: "Sign in", headerBackVisible: false }}
        />
      </Stack>
    </AuthProvider>
  );
}
