import type { Prisma } from "@prisma/client";
import { MAX_SAVED_CONVERSATIONS } from "@mtg-rules/contracts";

/** Who a new ruling belongs to, and which of their conversations it continues. */
export interface RulingOwner {
  userId: string;
  conversationId?: string;
}

const MAX_TITLE_CHARACTERS = 160;

function titleFromQuestion(question: string): string {
  const singleLine = question.replace(/\s+/g, " ").trim();
  return singleLine.length <= MAX_TITLE_CHARACTERS
    ? singleLine
    : `${singleLine.slice(0, MAX_TITLE_CHARACTERS - 1)}…`;
}

/**
 * Inside the ruling transaction: continue the owner's conversation or start a new one, then
 * forget all but the owner's most recently active conversations. Forgetting a conversation
 * only unlinks its questions; shared ruling links and challenges keep working.
 *
 * The route checks ownership before generating, but the conversation can still disappear
 * while the model runs (deleted, or pruned by another save). The answer is already paid for,
 * so it starts a new conversation instead of failing.
 */
export async function attachToConversation(
  tx: Prisma.TransactionClient,
  owner: RulingOwner,
  question: string,
): Promise<string> {
  let conversationId: string;
  const continued = owner.conversationId
    ? await tx.conversation.updateMany({
        where: { id: owner.conversationId, userId: owner.userId },
        data: { updatedAt: new Date() },
      })
    : { count: 0 };
  if (owner.conversationId && continued.count > 0) {
    conversationId = owner.conversationId;
  } else {
    const created = await tx.conversation.create({
      data: { userId: owner.userId, title: titleFromQuestion(question) },
      select: { id: true },
    });
    conversationId = created.id;
  }
  const stale = await tx.conversation.findMany({
    where: { userId: owner.userId },
    orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
    skip: MAX_SAVED_CONVERSATIONS,
    select: { id: true },
  });
  if (stale.length > 0) {
    await tx.conversation.deleteMany({
      where: { id: { in: stale.map(({ id }) => id) }, userId: owner.userId },
    });
  }
  return conversationId;
}
