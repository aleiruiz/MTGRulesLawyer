import { useLocalSearchParams } from "expo-router";
import ChatScreen from "../src/chat/ChatScreen";

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export default function ChatRoute() {
  const { draft, id } = useLocalSearchParams<{ draft?: string; id?: string }>();
  return (
    <ChatScreen
      draftId={typeof draft === "string" ? draft : undefined}
      conversationId={typeof id === "string" && uuidPattern.test(id) ? id : undefined}
    />
  );
}
