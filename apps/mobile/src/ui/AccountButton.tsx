import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { Image } from "expo-image";
import { avatarUrl } from "../auth/avatar";
import { useAuth } from "../auth/AuthProvider";
import { colors } from "../theme";
import { useT } from "../i18n/LanguageProvider";

export default function AccountButton() {
  const { session } = useAuth();
  const { t } = useT();
  const photo = avatarUrl(session);
  const [failedPhoto, setFailedPhoto] = useState<string | null>(null);

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={session ? t.accountButton.account : t.accountButton.signIn}
      accessibilityHint={t.accountButton.hint}
      hitSlop={8}
      onPress={() => router.push("/sign-in")}
      style={({ pressed }) => [
        styles.button,
        session && styles.signedIn,
        pressed && styles.pressed,
      ]}
    >
      {photo && photo !== failedPhoto ? (
        <Image
          source={{ uri: photo }}
          style={styles.photo}
          accessibilityIgnoresInvertColors
          onError={() => setFailedPhoto(photo)}
        />
      ) : (
        <Ionicons name={session ? "person" : "person-outline"} size={20} color={colors.accent} />
      )}
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
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 22,
    backgroundColor: colors.surface,
  },
  signedIn: { borderColor: colors.accent },
  photo: { width: 40, height: 40, borderRadius: 20 },
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
    backgroundColor: colors.successDot,
  },
});
