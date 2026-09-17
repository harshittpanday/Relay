import {
  onDisconnect,
  onValue,
  ref,
  serverTimestamp,
  set,
  update,
} from 'firebase/database';
import { database } from '@/lib/firebase';
import { logDatabaseError } from '@/lib/database-error';

export function connectPresence(uid: string) {
  const connectedRef = ref(database, '.info/connected');
  const userPath = `/users/${uid}`;
  const publicPath = `/publicProfiles/${uid}`;
  const userRef = ref(database, userPath);
  const publicRef = ref(database, publicPath);
  const userDisconnect = onDisconnect(userRef);
  const publicDisconnect = onDisconnect(publicRef);
  let closed = false;
  const mark = (target: typeof userRef, path: string, online: boolean) =>
    update(target, { online, lastSeen: serverTimestamp() }).catch((error) => {
      logDatabaseError('update', path, error);
    });
  const unsubscribe = onValue(
    connectedRef,
    (snapshot) => {
      if (snapshot.val() !== true) return;
      void Promise.allSettled([
        userDisconnect
          .update({ online: false, lastSeen: serverTimestamp() })
          .catch((error) => {
            logDatabaseError('onDisconnect.update', userPath, error);
            throw error;
          }),
        publicDisconnect
          .update({ online: false, lastSeen: serverTimestamp() })
          .catch((error) => {
            logDatabaseError('onDisconnect.update', publicPath, error);
            throw error;
          }),
      ]).then(() => {
        if (closed) return;
        void mark(userRef, userPath, true);
        void mark(publicRef, publicPath, true);
      });
    },
    (error) => {
      logDatabaseError('onValue', '/.info/connected', error);
    },
  );
  return () => {
    closed = true;
    unsubscribe();
    void userDisconnect
      .cancel()
      .catch((error) =>
        logDatabaseError('onDisconnect.cancel', userPath, error),
      );
    void publicDisconnect
      .cancel()
      .catch((error) =>
        logDatabaseError('onDisconnect.cancel', publicPath, error),
      );
    void mark(userRef, userPath, false);
    void mark(publicRef, publicPath, false);
  };
}
export async function setTyping(chatId: string, uid: string, typing: boolean) {
  const typingRef = ref(database, `chats/${chatId}/typing/${uid}`);
  if (typing) {
    await onDisconnect(typingRef).remove();
    await set(typingRef, Date.now());
  } else await set(typingRef, null);
}
