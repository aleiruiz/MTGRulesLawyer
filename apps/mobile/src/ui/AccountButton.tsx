import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { Pressable, StyleSheet, View } from "react-native";
import { useAuth } from "../auth/AuthProvider";
import { colors } from "../theme";

export default function AccountButton() {
  const { session } = useAuth();

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={session ? "Account" : "Sign in"}
      accessibilityHint="Opens sign-in and account features."
      hitSlop={8}
      onPress={() => router.push("/sign-in")}
      style={({ pressed }) => [
        styles.button,
        session && styles.signedIn,
        pressed && styles.pressed,
      ]}
    >
      <Ionicons
        name={session ? "person" : "person-outline"}
        size={20}
        color={session ? colors.ink : colors.goldBright}
      />
      {session ? <View style={styles.dot} /> : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1.5,
    borderColor: colors.gold,
    borderRadius: 22,
    backgroundColor: colors.surface,
  },
  signedIn: { backgroundColor: colors.gold },
  pressed: { opacity: 0.75 },
  dot: {
    position: "absolute",
    right: 1,
    bottom: 1,
    width: 11,
    height: 11,
    borderWidth: 2,
    borderColor: colors.background,
    borderRadius: 6,
    backgroundColor: colors.success,
  },
});
