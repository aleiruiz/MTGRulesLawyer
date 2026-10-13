import { useEffect, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { router } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useAuth } from "../auth/AuthProvider";
import { apiUrl } from "../api-url";
import Text from "../ui/Text";
import { colors } from "../theme";

/** Whether the signed-in account is a judge who reviews disputes. */
export function useIsAdmin(): boolean {
  const { session } = useAuth();
  const [isAdmin, setIsAdmin] = useState(false);

  useEffect(() => {
    let active = true;
    setIsAdmin(false);
    if (!session)
      return () => {
        active = false;
      };
    void fetch(`${apiUrl}/api/auth/me`, {
      headers: { authorization: `Bearer ${session.access_token}` },
    })
      .then(async (response) => {
        if (!response.ok) return false;
        const body: unknown = await response.json();
        return typeof body === "object" && body !== null && "role" in body && body.role === "ADMIN";
      })
      .then((allowed) => {
        if (active) setIsAdmin(allowed);
      })
      .catch(() => {
        if (active) setIsAdmin(false);
      });
    return () => {
      active = false;
    };
  }, [session]);

  return isAdmin;
}

/** The review queue entry on the account screen, shown only to judges. */
export default function AdminReviewLink({ isAdmin }: { isAdmin: boolean }) {
  if (!isAdmin) return null;
  return (
    <Pressable
      accessibilityRole="button"
      onPress={() => router.push("/review-queue")}
      style={({ pressed }) => [styles.row, pressed && styles.pressed]}
    >
      <Ionicons name="shield-checkmark-outline" size={20} color={colors.accent} />
      <View style={styles.text}>
        <Text style={styles.title}>Review queue</Text>
        <Text style={styles.detail}>Disputes waiting for a judge</Text>
      </View>
      <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    minHeight: 64,
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    paddingHorizontal: 16,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 16,
    backgroundColor: colors.surface,
  },
  pressed: { opacity: 0.75 },
  text: { flex: 1, gap: 2 },
  title: { fontSize: 15 },
  detail: { color: colors.textMuted, fontSize: 12.5 },
});
