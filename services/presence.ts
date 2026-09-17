import {
  onDisconnect,
  onValue,
  ref,
  serverTimestamp,
  set,
  update,
} from 'firebase/database';
import { database } from '@/lib/firebase';

export function connectPresence(uid: string) {
  const connectedRef = ref(database, '.info/connected');
  const rootRef = ref(database);
  const disconnect = onDisconnect(rootRef);
  let closed = false;
  const unsubscribe = onValue(connectedRef, async (snapshot) => {
    if (snapshot.val() !== true) return;
    await disconnect.update({
      [`users/${uid}/online`]: false,
      [`users/${uid}/lastSeen`]: serverTimestamp(),
      [`publicProfiles/${uid}/online`]: false,
      [`publicProfiles/${uid}/lastSeen`]: serverTimestamp(),
    });
    if (closed) return;
    await update(rootRef, {
      [`users/${uid}/online`]: true,
      [`users/${uid}/lastSeen`]: serverTimestamp(),
      [`publicProfiles/${uid}/online`]: true,
      [`publicProfiles/${uid}/lastSeen`]: serverTimestamp(),
    });
  });
  return () => {
    closed = true;
    unsubscribe();
    void disconnect.cancel();
    void update(rootRef, {
      [`users/${uid}/online`]: false,
      [`users/${uid}/lastSeen`]: serverTimestamp(),
      [`publicProfiles/${uid}/online`]: false,
      [`publicProfiles/${uid}/lastSeen`]: serverTimestamp(),
    });
  };
}
export async function setTyping(chatId: string, uid: string, typing: boolean) {
  const typingRef = ref(database, `chats/${chatId}/typing/${uid}`);
  if (typing) {
    await onDisconnect(typingRef).remove();
    await set(typingRef, Date.now());
  } else await set(typingRef, null);
}
