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

const MAX_QUESTION_LENGTH = 4_000;

// Shown to people who have not asked anything yet. Tapping one fills the composer.
const examples = [
  {
    label: "Double strike and trample",
    question:
      "My Bolrac-Clan Basher has double strike and trample and is blocked by Llanowar Elves. How much damage does my opponent take?",
  },
  {
    label: "Blood Moon + Urborg",
    question:
      "Blood Moon and Urborg, Tomb of Yawgmoth are both on the battlefield. What can my Swamp and my Forest tap for?",
  },
  {
    label: "Is this a loop?",
    question:
      "I control Exquisite Blood and Sanguine Bond, and my opponent loses 1 life. What happens?",
  },
];

export default function HomeScreen() {
  const [question, setQuestion] = useState("");
  const recent = useRecentConversations();
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
              {"What’s happening\nat the table?"}
            </Text>
            <View style={styles.composer}>
              <TextInput
                accessibilityLabel="Your question"
                accessibilityHint="Describe the game situation, up to 4000 characters."
                multiline
                maxLength={MAX_QUESTION_LENGTH}
                onChangeText={setQuestion}
                placeholder="My opponent blocks my Bolrac-Clan Basher with Llanowar Elves. How much damage do they take?"
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
                  accessibilityLabel="Ask"
                  accessibilityState={{ disabled: !canAsk }}
                  disabled={!canAsk}
                  onPress={ask}
                  style={({ pressed }) => [
                    styles.askButton,
                    !canAsk && styles.disabled,
                    pressed && styles.pressed,
                  ]}
                >
                  <Text style={styles.askText}>Ask</Text>
                </Pressable>
              </View>
            </View>

            {showExamples ? (
              <View style={styles.examples}>
                <View style={styles.examplesLabel}>
                  <Ionicons name="sparkles-outline" size={14} color={colors.accent} />
                  <Text style={styles.examplesText}>New here? Try an example</Text>
                </View>
                <View style={styles.chips}>
                  {examples.map((example) => (
                    <Pressable
                      key={example.label}
                      accessibilityRole="button"
                      accessibilityLabel={`Example: ${example.label}`}
                      accessibilityHint="Fills in the question so you can ask it."
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

          <RecentRulings {...recent} />
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
