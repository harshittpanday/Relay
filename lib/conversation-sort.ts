import type { Conversation } from '@/types/chat';

export function sortConversations(
  conversations: Conversation[],
  pinnedIds: ReadonlySet<string>,
): Conversation[] {
  return [...conversations].sort(
    (a, b) =>
      Number(pinnedIds.has(b.id)) - Number(pinnedIds.has(a.id)) ||
      (b.updatedAt || b.latestMessage?.time || 0) -
        (a.updatedAt || a.latestMessage?.time || 0),
  );
}
