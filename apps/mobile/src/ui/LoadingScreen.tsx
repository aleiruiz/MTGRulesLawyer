import { StyleSheet, View } from "react-native";
import Text from "./Text";
import ManaLoader from "./ManaLoader";
import GrimoireBackdrop from "./GrimoireBackdrop";
import { colors, fonts } from "../theme";

interface LoadingScreenProps {
  // Custom fonts may still be loading, so the splash only uses them once they are ready.
  fontsReady: boolean;
}

export default function LoadingScreen({ fontsReady }: LoadingScreenProps) {
  return (
    <View style={styles.screen}>
      <GrimoireBackdrop />
      <View style={styles.center}>
        <View style={styles.card} importantForAccessibility="no-hide-descendants">
          <View style={styles.art}>
            <View style={styles.sigil} />
          </View>
          <View style={styles.textLine} />
          <View style={styles.textLine} />
          <View style={[styles.textLine, styles.shortLine]} />
        </View>
        <Text
          accessibilityRole="header"
          style={[styles.title, fontsReady && { fontFamily: fonts.displayHeavy }]}
        >
          Rules Lawyer
        </Text>
        <ManaLoader accessibilityLabel="Loading Rules Lawyer" size={16} />
        <Text style={[styles.flavor, fontsReady && { fontFamily: fonts.serifItalic }]}>
          Shuffling the rules…
        </Text>
      </View>
      <Text style={styles.notice}>
        Unofficial Fan Content permitted under the Fan Content Policy. Not approved/endorsed by
        Wizards.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: 22, padding: 24 },
  card: {
    width: 96,
    height: 134,
    padding: 7,
    gap: 7,
    borderWidth: 2,
    borderColor: colors.gold,
    borderRadius: 8,
    backgroundColor: colors.surface,
  },
  art: {
    height: 52,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: colors.goldDeep,
    borderRadius: 3,
    backgroundColor: colors.backgroundGlow,
  },
  sigil: {
    width: 22,
    height: 22,
    borderWidth: 2,
    borderColor: colors.goldBright,
    transform: [{ rotate: "45deg" }],
  },
  textLine: { height: 3, borderRadius: 2, backgroundColor: colors.goldDeep, opacity: 0.7 },
  shortLine: { width: "65%" },
  title: { color: colors.goldBright, fontSize: 30, fontWeight: "800", letterSpacing: 0.5 },
  flavor: { color: colors.textMuted, fontSize: 18 },
  notice: {
    paddingHorizontal: 28,
    paddingBottom: 28,
    color: colors.textSubtle,
    fontSize: 11,
    lineHeight: 15,
    textAlign: "center",
  },
});
