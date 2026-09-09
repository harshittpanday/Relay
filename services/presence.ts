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
  return onValue(connectedRef, async (snapshot) => {
    if (snapshot.val() !== true) return;
    await onDisconnect(userRef).update({
      online: false,
      lastSeen: serverTimestamp(),
    });
    await update(userRef, { online: true, lastSeen: serverTimestamp() });
  });
}
export async function setTyping(chatId: string, uid: string, typing: boolean) {
  const typingRef = ref(database, `chats/${chatId}/typing/${uid}`);
  if (typing) {
    await onDisconnect(typingRef).remove();
    await set(typingRef, Date.now());
  } else await set(typingRef, null);
}
