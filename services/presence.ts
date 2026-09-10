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
  const userRef = ref(database, `users/${uid}`);
  const disconnect = onDisconnect(userRef);
  let closed = false;
  const unsubscribe = onValue(connectedRef, async (snapshot) => {
    if (snapshot.val() !== true) return;
    await disconnect.update({
      online: false,
      lastSeen: serverTimestamp(),
    });
    if (closed) return;
    await update(userRef, { online: true, lastSeen: serverTimestamp() });
  });
  return () => {
    closed = true;
    unsubscribe();
    void disconnect.cancel();
    void update(userRef, {
      online: false,
      lastSeen: serverTimestamp(),
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
