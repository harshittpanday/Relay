import {
  equalTo,
  get,
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
import { logDatabaseError } from '@/lib/database-error';
import { subscribeUser } from './users';
import type { Chat, Conversation, Message, ReplyReference } from '@/types/chat';

export const MAX_MESSAGE_LENGTH = 4000;
const REPLY_PREVIEW_LENGTH = 160;

const normalizeReply = (value: unknown): ReplyReference | undefined => {
  if (!value || typeof value !== 'object') return undefined;
  const raw = value as Record<string, unknown>;
  if (
    typeof raw.messageId !== 'string' ||
    !raw.messageId ||
    typeof raw.senderId !== 'string' ||
    !raw.senderId
  )
    return undefined;
  return {
    messageId: raw.messageId,
    senderId: raw.senderId,
    type: raw.type === 'image' ? 'image' : 'text',
    text:
      typeof raw.text === 'string'
        ? raw.text.slice(0, REPLY_PREVIEW_LENGTH)
        : '',
  };
};

export const replyReference = (message: Message): ReplyReference => ({
  messageId: message.id,
  senderId: message.sender,
  type: message.type,
  text:
    message.type === 'image' ? '' : message.text.slice(0, REPLY_PREVIEW_LENGTH),
});

const normalizeMessage = (id: string, raw: Partial<Message>): Message => ({
  id,
  sender: raw.sender || '',
  text: raw.text || '',
  type: raw.type === 'image' || raw.imageURL ? 'image' : 'text',
  imageURL: raw.imageURL,
  time: Number(raw.time) || Date.now(),
  seenBy: raw.seenBy || {},
  replyTo: normalizeReply(raw.replyTo),
  editedAt:
    typeof raw.editedAt === 'number' && Number.isFinite(raw.editedAt)
      ? raw.editedAt
      : undefined,
});

export function subscribeConversations(
  uid: string,
  callback: (items: Conversation[]) => void,
  onError: (error: Error) => void,
  onIncoming?: (conversation: Conversation, message: Message) => void,
) {
  const items = new Map<string, Conversation>();
  const childStops = new Map<string, Array<() => void>>();
  let closed = false;
  let notificationsReady = false;
  let usingLegacyFallback = false;
  let stopAdded: () => void = () => undefined;
  let stopRemoved: () => void = () => undefined;
  const emit = () => callback([...items.values()]);
  const indexRef = ref(database, `userChats/${uid}`);

  const removeConversation = (id: string) => {
    childStops.get(id)?.forEach((stop) => stop());
    childStops.delete(id);
    items.delete(id);
    emit();
  };

  const attachConversation = async (
    id: string,
    otherUidHint?: string,
    initialChat?: Chat,
  ) => {
    if (closed || childStops.has(id)) return;
    const stops: Array<() => void> = [];
    childStops.set(id, stops);

    let otherUid = otherUidHint;
    if (!otherUid) {
      const participants = await get(ref(database, `chats/${id}/participants`));
      otherUid = Object.keys(participants.val() || {}).find(
        (candidate) => candidate !== uid,
      );
    }
    if (closed || childStops.get(id) !== stops) return;
    if (!otherUid) {
      childStops.delete(id);
      return;
    }
    let userReady = false;
    let latestOtherUser: Conversation['otherUser'];
    const initialLatest = getLatestMessage(initialChat);
    const stopUser = subscribeUser(otherUid, (otherUser) => {
      if (closed || childStops.get(id) !== stops) return;
      latestOtherUser = otherUser;
      if (userReady) return;
      userReady = true;
      items.set(id, {
        id,
        participants: { [uid]: true, [otherUid]: true },
        otherUser,
        unread: initialChat?.unread,
        latestMessage: initialLatest,
        updatedAt: initialLatest?.time || initialChat?.updatedAt,
      });
      emit();

      let latestHydrated = false;
      let latestKey = '';
      stops.push(
        onValue(
          ref(database, `chats/${id}/lastMessage`),
          (messageSnapshot) => {
            const raw = messageSnapshot.val() as Partial<Message> | null;
            const latest = raw
              ? normalizeMessage(
                  raw.id || `${raw.sender || 'unknown'}-${raw.time || 0}`,
                  raw,
                )
              : items.get(id)?.latestMessage;
            const nextKey = latest?.id || '';
            const current = items.get(id);
            if (!current) return;
            const nextConversation = {
              ...current,
              latestMessage: latest,
              updatedAt: latest?.time || current.updatedAt,
            };
            items.set(id, nextConversation);
            emit();
            if (
              notificationsReady &&
              latestHydrated &&
              latest &&
              nextKey !== latestKey &&
              latest.sender !== uid
            )
              onIncoming?.(
                { ...nextConversation, otherUser: latestOtherUser },
                latest,
              );
            latestKey = nextKey;
            latestHydrated = true;
          },
          onError,
        ),
        onValue(
          ref(database, `chats/${id}/unread/${uid}`),
          (unreadSnapshot) => {
            const current = items.get(id);
            if (!current) return;
            items.set(id, {
              ...current,
              unread: { [uid]: Number(unreadSnapshot.val()) || 0 },
            });
            emit();
          },
          onError,
        ),
      );
    });
    stops.push(stopUser);
  };

  const startLegacyFallback = () => {
    if (closed || usingLegacyFallback) return;
    usingLegacyFallback = true;
    stopAdded();
    stopRemoved();
    const legacyQuery = getLegacyChatQuery(uid);
    const handleLegacyError = (error: Error) => {
      if (isMissingIndexError(error)) {
        console.debug(
          '[Relay chats] Legacy chat query is running without an optional Firebase index.',
        );
        return;
      }
      onError(error);
    };
    stopAdded = onChildAdded(
      legacyQuery,
      (snapshot) => {
        const raw = snapshot.val() as Chat;
        const otherUid = Object.keys(raw.participants || {}).find(
          (candidate) => candidate !== uid,
        );
        void attachConversation(snapshot.key!, otherUid, raw);
      },
      handleLegacyError,
    );
    stopRemoved = onChildRemoved(
      legacyQuery,
      (snapshot) => removeConversation(snapshot.key!),
      handleLegacyError,
    );
    void get(legacyQuery)
      .then(() => {
        notificationsReady = true;
      })
      .catch(handleLegacyError);
  };

  const fallBackFromIndex = (error: Error) => {
    if (usingLegacyFallback || closed) return;
    console.warn(
      '[Relay chats] The optimized userChats index is unavailable; using the existing chat membership query until the new Firebase rules are deployed.',
      error,
    );
    startLegacyFallback();
  };

  void migrateUserChatIndex(uid).then(() => {
    if (closed) return;
    stopAdded = onChildAdded(
      indexRef,
      (snapshot) => {
        const otherUid =
          typeof snapshot.val() === 'string' ? snapshot.val() : undefined;
        void attachConversation(snapshot.key!, otherUid);
      },
      fallBackFromIndex,
    );
    stopRemoved = onChildRemoved(
      indexRef,
      (snapshot) => removeConversation(snapshot.key!),
      fallBackFromIndex,
    );
    notificationsReady = true;
  }, fallBackFromIndex);

  return () => {
    closed = true;
    stopAdded();
    stopRemoved();
    childStops.forEach((stops) => stops.forEach((stop) => stop()));
    childStops.clear();
  };
}

const getLatestMessage = (chat?: Chat) => {
  if (chat?.lastMessage)
    return normalizeMessage(
      chat.lastMessage.id ||
        `${chat.lastMessage.sender || 'unknown'}-${chat.lastMessage.time || 0}`,
      chat.lastMessage,
    );
  if (!chat?.messages) return undefined;
  return Object.entries(chat.messages)
    .map(([id, message]) => normalizeMessage(id, message))
    .sort((a, b) => b.time - a.time)[0];
};

const getLegacyChatQuery = (uid: string) =>
  query(
    ref(database, 'chats'),
    orderByChild(`participants/${uid}`),
    equalTo(true),
  );

const isMissingIndexError = (error: Error) => {
  const message = error.message.toLowerCase();
  return message.includes('index not defined') || message.includes('.indexon');
};

async function migrateUserChatIndex(uid: string) {
  const versionRef = ref(database, `userChatIndexVersion/${uid}`);
  const [version, index] = await Promise.all([
    get(versionRef),
    get(ref(database, `userChats/${uid}`)),
  ]);
  if (version.val() === 1 && index.exists()) return;

  const legacyQuery = getLegacyChatQuery(uid);
  const snapshot = await get(legacyQuery);
  const updates: Record<string, unknown> = {
    [`userChatIndexVersion/${uid}`]: 1,
  };
  snapshot.forEach((child) => {
    const raw = child.val() as Chat;
    const chatId = child.key!;
    const otherUid = Object.keys(raw.participants || {}).find(
      (candidate) => candidate !== uid,
    );
    if (!otherUid) return;
    updates[`userChats/${uid}/${chatId}`] = otherUid;
    updates[`userChats/${otherUid}/${chatId}`] = uid;

    if (!raw.lastMessage && raw.messages) {
      const latest = Object.entries(raw.messages)
        .map(([id, message]) => normalizeMessage(id, message))
        .sort((a, b) => b.time - a.time)[0];
      if (latest)
        updates[`chats/${chatId}/lastMessage`] = {
          id: latest.id,
          sender: latest.sender,
          text: latest.text,
          imageURL: latest.imageURL || null,
          type: latest.type,
          time: latest.time,
        };
    }
  });
  await update(ref(database), updates);
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
  try {
    await update(ref(database), {
      [`userChats/${myUid}/${chatId}`]: otherUid,
      [`userChats/${otherUid}/${chatId}`]: myUid,
    });
  } catch (error) {
    console.warn(
      '[Relay chats] Chat created, but its optional optimized index could not be updated.',
      error,
    );
  }
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
  payload: { text?: string; imageURL?: string; replyTo?: ReplyReference },
) {
  const text = (payload.text || '').trim();
  if ((!payload.imageURL && !text) || text.length > MAX_MESSAGE_LENGTH)
    throw new Error(`Message must be 1–${MAX_MESSAGE_LENGTH} characters.`);
  const replyTo = payload.replyTo ? normalizeReply(payload.replyTo) : undefined;
  if (payload.replyTo && !replyTo) throw new Error('Reply target is invalid.');
  const time = Date.now();
  const type = payload.imageURL ? 'image' : 'text';
  const messageRef = push(ref(database, `chats/${chatId}/messages`));
  await set(messageRef, {
    sender: senderUid,
    text,
    type,
    imageURL: payload.imageURL || null,
    time,
    seenBy: { [senderUid]: true },
    ...(replyTo ? { replyTo } : {}),
  }).catch((error: unknown) => {
    throw logDatabaseError(
      'send set',
      `/chats/${chatId}/messages/${messageRef.key}`,
      error,
    );
  });
  await Promise.all([
    update(ref(database), {
      [`chats/${chatId}/lastMessage`]: {
        id: messageRef.key!,
        sender: senderUid,
        text,
        imageURL: payload.imageURL || null,
        type,
        time,
      },
      [`chats/${chatId}/updatedAt`]: time,
    }).catch((error: unknown) => {
      throw logDatabaseError(
        'send update',
        `/chats/${chatId}/lastMessage`,
        error,
      );
    }),
    runTransaction(
      ref(database, `chats/${chatId}/unread/${otherUid}`),
      (value) => (Number(value) || 0) + 1,
    ).catch((error: unknown) => {
      throw logDatabaseError(
        'send unread transaction',
        `/chats/${chatId}/unread/${otherUid}`,
        error,
      );
    }),
  ]);
}

export async function editMessage(
  chatId: string,
  message: Message,
  uid: string,
  nextText: string,
) {
  const text = nextText.trim();
  if (!text || text.length > MAX_MESSAGE_LENGTH)
    throw new Error(`Message must be 1–${MAX_MESSAGE_LENGTH} characters.`);
  const path = `chats/${chatId}/messages/${message.id}`;
  const snapshot = await get(ref(database, path)).catch((error: unknown) => {
    throw logDatabaseError('edit get', `/${path}`, error);
  });
  if (!snapshot.exists())
    throw new Error('This message is no longer available.');
  const current = normalizeMessage(message.id, snapshot.val());
  if (current.sender !== uid || current.type !== 'text' || current.imageURL)
    throw new Error('This message cannot be edited.');
  if (current.text !== message.text)
    throw new Error(
      'This message changed. Reopen Edit to use its latest text.',
    );
  const editedAt = Date.now();
  await update(ref(database), {
    [`${path}/text`]: text,
    [`${path}/editedAt`]: editedAt,
  }).catch((error: unknown) => {
    throw logDatabaseError('edit update', `/${path}/text + editedAt`, error);
  });
  try {
    const latest = await get(ref(database, `chats/${chatId}/lastMessage`));
    if (latest.val()?.id === message.id)
      await set(ref(database, `chats/${chatId}/lastMessage/text`), text);
  } catch (error) {
    console.warn(
      `[Relay messages] Edited message saved; could not refresh chats/${chatId}/lastMessage`,
      error,
    );
  }
}
