import { StyleSheet, View } from "react-native";
import Text from "./Text";
import Loader from "./Loader";
import GlassesLogo from "./GlassesLogo";
import { colors, fonts } from "../theme";

interface LoadingScreenProps {
  // Custom fonts may still be loading, so the splash only uses them once they are ready.
  fontsReady: boolean;
}

export default function LoadingScreen({ fontsReady }: LoadingScreenProps) {
  return (
    <View style={styles.screen}>
      <View style={styles.center}>
        <GlassesLogo width={120} />
        <Text
          accessibilityRole="header"
          style={[styles.title, fontsReady && { fontFamily: fonts.display }]}
        >
          Rules Lawyer
        </Text>
        <Loader accessibilityLabel="Loading Rules Lawyer" size={16} />
        <Text style={[styles.flavor, fontsReady && { fontFamily: fonts.displayItalic }]}>
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
  title: { color: colors.accent, fontSize: 30, fontWeight: "800", letterSpacing: 0.5 },
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
