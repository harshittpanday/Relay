import {
  equalTo,
  get,
  limitToLast,
  onChildAdded,
  onChildRemoved,
  onValue,
  orderByChild,
  push,
  query,
  ref,
  runTransaction,
  serverTimestamp,
  set,
  update,
} from 'firebase/database';
import { database } from '@/lib/firebase';
import { getUser } from './users';
import type { Chat, Conversation, Message } from '@/types/chat';

const normalizeMessage = (id: string, raw: Partial<Message>): Message => ({
  id,
  sender: raw.sender || '',
  text: raw.text || '',
  type: raw.type === 'image' || raw.imageURL ? 'image' : 'text',
  imageURL: raw.imageURL,
  time: Number(raw.time) || Date.now(),
  seenBy: raw.seenBy || {},
});

export function subscribeConversations(
  uid: string,
  callback: (items: Conversation[]) => void,
  onError: (error: Error) => void,
) {
  const items = new Map<string, Conversation>();
  const childStops = new Map<string, Array<() => void>>();
  let closed = false;
  const emit = () =>
    callback(
      [...items.values()].sort(
        (a, b) =>
          (b.updatedAt || b.latestMessage?.time || 0) -
          (a.updatedAt || a.latestMessage?.time || 0),
      ),
    );
  const membershipQuery = query(
    ref(database, 'chats'),
    orderByChild(`participants/${uid}`),
    equalTo(true),
  );
  const stopAdded = onChildAdded(
    membershipQuery,
    async (snapshot) => {
      const raw = snapshot.val() as Chat;
      const id = snapshot.key!;
      if (closed || !raw.participants?.[uid] || childStops.has(id)) return;
      const otherUid = Object.keys(raw.participants).find(
        (candidate) => candidate !== uid,
      );
      if (!otherUid) return;
      const otherUser = await getUser(otherUid);
      if (closed) return;
      items.set(id, {
        id,
        participants: raw.participants,
        otherUser,
        unread: raw.unread,
        updatedAt: raw.updatedAt,
      });
      emit();
      const stopLatest = onValue(
        query(ref(database, `chats/${id}/messages`), limitToLast(1)),
        (messageSnapshot) => {
          let latest: Message | undefined;
          messageSnapshot.forEach((child) => {
            latest = normalizeMessage(child.key!, child.val());
          });
          const current = items.get(id);
          if (current)
            items.set(id, {
              ...current,
              latestMessage: latest,
              updatedAt: latest?.time || current.updatedAt,
            });
          emit();
        },
        onError,
      );
      const stopUnread = onValue(
        ref(database, `chats/${id}/unread/${uid}`),
        (unreadSnapshot) => {
          const current = items.get(id);
          if (current)
            items.set(id, {
              ...current,
              unread: { [uid]: Number(unreadSnapshot.val()) || 0 },
            });
          emit();
        },
        onError,
      );
      childStops.set(id, [stopLatest, stopUnread]);
    },
    onError,
  );
  const stopRemoved = onChildRemoved(
    membershipQuery,
    (snapshot) => {
      const id = snapshot.key!;
      childStops.get(id)?.forEach((stop) => stop());
      childStops.delete(id);
      items.delete(id);
      emit();
    },
    onError,
  );
  return () => {
    closed = true;
    stopAdded();
    stopRemoved();
    childStops.forEach((stops) => stops.forEach((stop) => stop()));
    childStops.clear();
  };
}

export async function ensureChat(myUid: string, otherUid: string) {
  const chatId = [myUid, otherUid].sort().join('_');
  const chatRef = ref(database, `chats/${chatId}`);
  const snapshot = await get(chatRef);
  if (!snapshot.exists())
    await set(chatRef, {
      participants: { [myUid]: true, [otherUid]: true },
      unread: { [myUid]: 0, [otherUid]: 0 },
      updatedAt: serverTimestamp(),
    });
  return chatId;
}
export function subscribeMessages(
  chatId: string,
  callback: (messages: Message[]) => void,
  onError: (error: Error) => void,
) {
  return onValue(
    ref(database, `chats/${chatId}/messages`),
    (snapshot) => {
      const messages: Message[] = [];
      snapshot.forEach((child) => {
        messages.push(normalizeMessage(child.key!, child.val()));
      });
      callback(messages.sort((a, b) => a.time - b.time));
    },
    onError,
  );
}
export function subscribeTyping(
  chatId: string,
  otherUid: string,
  callback: (typing: boolean) => void,
) {
  return onValue(
    ref(database, `chats/${chatId}/typing/${otherUid}`),
    (snapshot) => {
      const value = snapshot.val();
      callback(
        value === true ||
          (typeof value === 'number' && Date.now() - value < 8000),
      );
    },
  );
}
export async function markChatRead(
  chatId: string,
  uid: string,
  messages: Message[],
) {
  const updates: Record<string, boolean | number> = {
    [`chats/${chatId}/unread/${uid}`]: 0,
  };
  messages.forEach((message) => {
    if (message.sender !== uid && !message.seenBy[uid])
      updates[`chats/${chatId}/messages/${message.id}/seenBy/${uid}`] = true;
  });
  await update(ref(database), updates);
}
export async function sendMessage(
  chatId: string,
  senderUid: string,
  otherUid: string,
  payload: { text?: string; imageURL?: string },
) {
  const time = Date.now();
  const type = payload.imageURL ? 'image' : 'text';
  const messageRef = push(ref(database, `chats/${chatId}/messages`));
  await set(messageRef, {
    sender: senderUid,
    text: payload.text || '',
    type,
    imageURL: payload.imageURL || null,
    time,
    seenBy: { [senderUid]: true },
  });
  await Promise.all([
    update(ref(database, `chats/${chatId}`), {
      lastMessage: { sender: senderUid, text: payload.text || '', type, time },
      updatedAt: time,
    }),
    runTransaction(
      ref(database, `chats/${chatId}/unread/${otherUid}`),
      (value) => (Number(value) || 0) + 1,
    ),
  ]);
}
