import { StyleSheet, View } from "react-native";
import Text from "./Text";
import Loader from "./Loader";
import GlassesLogo from "./GlassesLogo";
import RaisedHand from "./RaisedHand";
import { colors, fonts } from "../theme";
import { useT } from "../i18n/LanguageProvider";

interface LoadingScreenProps {
  // Custom fonts may still be loading, so the splash only uses them once they are ready.
  fontsReady: boolean;
}

export default function LoadingScreen({ fontsReady }: LoadingScreenProps) {
  const { t } = useT();
  return (
    <View style={styles.screen}>
      <View style={styles.center}>
        <RaisedHand />
        <View style={styles.brandBlock}>
          <View style={styles.brand}>
            <GlassesLogo width={52} />
            <Text
              accessibilityRole="header"
              style={[styles.title, fontsReady && { fontFamily: fonts.displaySemibold }]}
            >
              Rules Lawyer
            </Text>
          </View>
          {/* Remount once fonts load so Android re-measures the text width. */}
          <View key={fontsReady ? "fonts" : "system"} style={styles.calling}>
            <Text style={styles.callingText}>{t.splash.judge}</Text>
            <Loader accessibilityLabel={t.splash.loading} size={6} color={colors.textMuted} />
          </View>
        </View>
      </View>
      <Text style={styles.notice}>{t.splash.fanContent}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: 34, padding: 32 },
  brandBlock: { alignItems: "center", gap: 10 },
  brand: { flexDirection: "row", alignItems: "center", gap: 10 },
  title: { color: colors.text, fontSize: 30 },
  calling: { flexDirection: "row", alignItems: "center", gap: 8 },
  callingText: { color: colors.textMuted, fontSize: 15 },
  notice: {
    paddingHorizontal: 28,
    paddingBottom: 28,
    color: colors.textSubtle,
    fontSize: 11,
    lineHeight: 15,
    textAlign: "center",
  },
});
