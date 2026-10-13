import { useLocalSearchParams } from "expo-router";
import DisputeScreen from "../src/challenges/DisputeScreen";

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export default function DisputeRoute() {
  const { ruling } = useLocalSearchParams<{ ruling?: string }>();
  return (
    <DisputeScreen
      rulingId={typeof ruling === "string" && uuidPattern.test(ruling) ? ruling : undefined}
    />
  );
}
