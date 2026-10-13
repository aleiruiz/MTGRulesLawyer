import { useState } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { questionInterpretRequestSchema } from "@mtg-rules/contracts";
import Text from "../ui/Text";
import TextInput from "../ui/TextInput";
import GlassesLogo from "../ui/GlassesLogo";
import AccountButton from "../ui/AccountButton";
import { colors, fonts } from "../theme";
import { saveQuestion } from "../questions/question-store";
import RecentRulings, { useRecentConversations } from "./RecentRulings";
import SourcesFooter from "./SourcesFooter";
import { useT } from "../i18n/LanguageProvider";

const MAX_QUESTION_LENGTH = 4_000;

export default function HomeScreen() {
  const [question, setQuestion] = useState("");
  const recent = useRecentConversations();
  const { t } = useT();
  // Shown to people who have not asked anything yet. Tapping one fills the composer.
  const examples = t.home.examples;
  const canAsk = question.trim().length > 0;
  const showExamples = recent.loaded && recent.conversations.length === 0 && !recent.error;

  function ask() {
    const parsed = questionInterpretRequestSchema.safeParse({ question });
    if (!parsed.success) return;
    const id = saveQuestion(parsed.data.question);
    router.push({ pathname: "/table", params: { q: id } });
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <ScrollView contentContainerStyle={styles.page} keyboardShouldPersistTaps="handled">
          <View style={styles.header}>
            <View style={styles.brand}>
              <GlassesLogo width={44} />
              <Text style={styles.brandName}>Rules Lawyer</Text>
            </View>
            <AccountButton />
          </View>

          <View style={styles.askSection}>
            <Text accessibilityRole="header" style={styles.heading}>
              {t.home.heading}
            </Text>
            <View style={styles.composer}>
              <TextInput
                accessibilityLabel={t.home.questionLabel}
                accessibilityHint={t.home.questionHint}
                multiline
                maxLength={MAX_QUESTION_LENGTH}
                onChangeText={setQuestion}
                placeholder={t.home.placeholder}
                style={styles.input}
                textAlignVertical="top"
                value={question}
              />
              <View style={styles.composerFooter}>
                <Text style={styles.counter}>
                  {question.length > MAX_QUESTION_LENGTH - 400
                    ? `${question.length}/${MAX_QUESTION_LENGTH}`
                    : ""}
                </Text>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={t.home.ask}
                  accessibilityState={{ disabled: !canAsk }}
                  disabled={!canAsk}
                  onPress={ask}
                  style={({ pressed }) => [
                    styles.askButton,
                    !canAsk && styles.disabled,
                    pressed && styles.pressed,
                  ]}
                >
                  <Text style={styles.askText}>{t.home.ask}</Text>
                </Pressable>
              </View>
            </View>

            {showExamples ? (
              <View style={styles.examples}>
                <View style={styles.examplesLabel}>
                  <Ionicons name="sparkles-outline" size={14} color={colors.accent} />
                  <Text style={styles.examplesText}>{t.home.examplesLabel}</Text>
                </View>
                <View style={styles.chips}>
                  {examples.map((example) => (
                    <Pressable
                      key={example.label}
                      accessibilityRole="button"
                      accessibilityLabel={t.home.exampleLabel(example.label)}
                      accessibilityHint={t.home.exampleHint}
                      onPress={() => setQuestion(example.question)}
                      style={({ pressed }) => [styles.chip, pressed && styles.pressed]}
                    >
                      <Text style={styles.chipText}>{example.label}</Text>
                    </Pressable>
                  ))}
                </View>
              </View>
            ) : null}
          </View>

          <RecentRulings {...recent} limit={3} />
          <View style={styles.spacer} />
          <SourcesFooter />
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.background },
  flex: { flex: 1 },
  page: {
    flexGrow: 1,
    width: "100%",
    maxWidth: 640,
    alignSelf: "center",
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 22,
    gap: 26,
  },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  brand: { flexDirection: "row", alignItems: "center", gap: 10 },
  brandName: { fontFamily: fonts.displaySemibold, fontSize: 19, letterSpacing: 0.2 },
  askSection: { gap: 14 },
  heading: { fontFamily: fonts.display, fontSize: 31, lineHeight: 36 },
  composer: {
    gap: 10,
    padding: 14,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 18,
    backgroundColor: colors.surface,
  },
  input: {
    minHeight: 92,
    padding: 0,
    color: colors.text,
    fontSize: 16,
    lineHeight: 23,
  },
  composerFooter: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  counter: { color: colors.textMuted, fontSize: 12 },
  askButton: {
    height: 44,
    minWidth: 76,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 22,
    borderRadius: 22,
    backgroundColor: colors.accent,
  },
  askText: { color: colors.accentInk, fontFamily: fonts.bodySemibold, fontSize: 15 },
  disabled: { opacity: 0.45 },
  pressed: { opacity: 0.75 },
  examples: { gap: 8 },
  examplesLabel: { flexDirection: "row", alignItems: "center", gap: 6 },
  examplesText: { color: colors.textMuted, fontSize: 13 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: {
    minHeight: 44,
    justifyContent: "center",
    paddingHorizontal: 12,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 22,
  },
  chipText: { color: colors.textSoft, fontSize: 13 },
  spacer: { flexGrow: 1 },
});
