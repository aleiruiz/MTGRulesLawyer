import { useState } from "react";
import { useLocalSearchParams } from "expo-router";
import TableScreen from "../src/questions/TableScreen";
import { takeQuestion } from "../src/questions/question-store";

export default function TableRoute() {
  const { q } = useLocalSearchParams<{ q?: string }>();
  // Read once: the store forgets the question as soon as this screen has it.
  const [question] = useState(() => (typeof q === "string" ? takeQuestion(q) : undefined));
  return <TableScreen question={question} />;
}
