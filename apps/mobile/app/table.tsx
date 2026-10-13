import { useLocalSearchParams } from "expo-router";
import TableScreen from "../src/questions/TableScreen";
import { getQuestion } from "../src/questions/question-store";

export default function TableRoute() {
  const { q } = useLocalSearchParams<{ q?: string }>();
  return <TableScreen question={typeof q === "string" ? getQuestion(q) : undefined} />;
}
