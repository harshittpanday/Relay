import { get, onValue, ref, update } from 'firebase/database';
import { database } from '@/lib/firebase';
import type { ChatUser } from '@/types/chat';

const cache = new Map<string, ChatUser>();
const normalize = (uid: string, value: Partial<ChatUser> | null): ChatUser => ({
  uid,
  username: value?.username || 'unknown',
  displayName: value?.displayName || value?.username || 'Unknown user',
  bio: value?.bio || '',
  pfpURL: value?.pfpURL || '',
  online: Boolean(value?.online),
  lastSeen: value?.lastSeen,
  email: value?.email,
});
export async function getUser(uid: string) {
  if (cache.has(uid)) return cache.get(uid)!;
  const snapshot = await get(ref(database, `users/${uid}`));
  const user = normalize(uid, snapshot.val());
  cache.set(uid, user);
  return user;
}
export function subscribeUser(uid: string, callback: (user: ChatUser) => void) {
  return onValue(ref(database, `users/${uid}`), (snapshot) => {
    const user = normalize(uid, snapshot.val());
    cache.set(uid, user);
    callback(user);
  });
}
export async function searchUsers(term: string, currentUid: string) {
  const snapshot = await get(ref(database, 'users'));
  const query = term.trim().toLowerCase();
  const results: ChatUser[] = [];
  snapshot.forEach((child) => {
    if (child.key === currentUid) return;
    const user = normalize(child.key!, child.val());
    if (
      user.username.toLowerCase().includes(query) ||
      user.displayName.toLowerCase().includes(query)
    )
      results.push(user);
  });
  return results.slice(0, 12);
}
export const updateUserProfile = (
  uid: string,
  data: Pick<ChatUser, 'displayName' | 'bio' | 'pfpURL'>,
) => update(ref(database, `users/${uid}`), data);
