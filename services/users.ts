import {
  endAt,
  get,
  limitToFirst,
  onValue,
  orderByChild,
  query,
  ref,
  startAt,
  update,
} from 'firebase/database';
import { database } from '@/lib/firebase';
import type { ChatUser } from '@/types/chat';

const cache = new Map<string, ChatUser>();
const pendingReads = new Map<string, Promise<ChatUser>>();
const searchCache = new Map<string, { expires: number; users: ChatUser[] }>();
const subscriptions = new Map<
  string,
  {
    listeners: Set<(user: ChatUser) => void>;
    stop: () => void;
    user?: ChatUser;
  }
>();
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
  const active = subscriptions.get(uid)?.user;
  if (active) return active;
  const existing = pendingReads.get(uid);
  if (existing) return existing;
  const read = get(ref(database, `users/${uid}`)).then((snapshot) => {
    const user = normalize(uid, snapshot.val());
    cache.set(uid, user);
    return user;
  });
  pendingReads.set(uid, read);
  try {
    return await read;
  } finally {
    pendingReads.delete(uid);
  }
}
export function subscribeUser(uid: string, callback: (user: ChatUser) => void) {
  let subscription = subscriptions.get(uid);
  if (!subscription) {
    const listeners = new Set<(user: ChatUser) => void>();
    const next: {
      listeners: Set<(user: ChatUser) => void>;
      stop: () => void;
      user?: ChatUser;
    } = { listeners, stop: () => undefined, user: cache.get(uid) };
    next.stop = onValue(ref(database, `users/${uid}`), (snapshot) => {
      const user = normalize(uid, snapshot.val());
      next.user = user;
      cache.set(uid, user);
      listeners.forEach((listener) => listener(user));
    });
    subscriptions.set(uid, next);
    subscription = next;
  }
  subscription.listeners.add(callback);
  if (subscription.user) callback(subscription.user);
  return () => {
    const current = subscriptions.get(uid);
    if (!current) return;
    current.listeners.delete(callback);
    if (current.listeners.size === 0) {
      current.stop();
      subscriptions.delete(uid);
    }
  };
}
export async function searchUsers(term: string, currentUid: string) {
  const displayTerm = term.trim();
  const normalizedTerm = displayTerm.toLowerCase();
  if (!normalizedTerm) return [];
  const cacheKey = `${currentUid}:${normalizedTerm}`;
  const cached = searchCache.get(cacheKey);
  if (cached && cached.expires > Date.now()) return cached.users;

  const usersRef = ref(database, 'users');
  const upperBound = `${normalizedTerm}\uf8ff`;
  const titleCaseTerm = normalizedTerm.replace(/\b\w/g, (letter) =>
    letter.toUpperCase(),
  );
  const searches = [
    get(
      query(
        usersRef,
        orderByChild('username'),
        startAt(normalizedTerm),
        endAt(upperBound),
        limitToFirst(12),
      ),
    ),
    get(
      query(
        usersRef,
        orderByChild('displayNameLower'),
        startAt(normalizedTerm),
        endAt(upperBound),
        limitToFirst(12),
      ),
    ),
    ...[displayTerm, titleCaseTerm]
      .filter((value, index, values) => values.indexOf(value) === index)
      .map((value) =>
        get(
          query(
            usersRef,
            orderByChild('displayName'),
            startAt(value),
            endAt(`${value}\uf8ff`),
            limitToFirst(12),
          ),
        ),
      ),
  ];
  const snapshots = await Promise.all(searches);
  const matches = new Map<string, ChatUser>();
  snapshots.forEach((snapshot) =>
    snapshot.forEach((child) => {
      if (child.key !== currentUid)
        matches.set(child.key!, normalize(child.key!, child.val()));
    }),
  );
  const users = [...matches.values()].slice(0, 12);
  if (searchCache.size >= 50)
    searchCache.delete(searchCache.keys().next().value!);
  searchCache.set(cacheKey, { expires: Date.now() + 30_000, users });
  return users;
}
export const updateUserProfile = (
  uid: string,
  data: Pick<ChatUser, 'displayName' | 'bio' | 'pfpURL'>,
) =>
  update(ref(database, `users/${uid}`), {
    ...data,
    displayNameLower: data.displayName.trim().toLowerCase(),
  });
