import {
  endAt,
  get,
  limitToFirst,
  onValue,
  orderByChild,
  query,
  ref,
  runTransaction,
  startAt,
  update,
} from 'firebase/database';
import { database } from '@/lib/firebase';
import { logDatabaseError } from '@/lib/database-error';
import type { ChatUser } from '@/types/chat';

const profileRef = (uid: string) => ref(database, `publicProfiles/${uid}`);

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
});
export async function ensurePublicProfile(
  uid: string,
  legacy: Partial<ChatUser> | null,
) {
  if (!legacy?.username || !legacy.displayName) return;
  const username = legacy.username.trim().toLowerCase();
  const claim = await runTransaction(
    ref(database, `usernames/${username}`),
    (current) => (current === null ? uid : undefined),
    { applyLocally: false },
  ).catch((error: unknown) => {
    throw logDatabaseError('runTransaction', `/usernames/${username}`, error);
  });
  if (!claim.committed && claim.snapshot.val() !== uid)
    throw new Error('Your username is assigned to another account.');
  await update(profileRef(uid), {
    username,
    displayName: legacy.displayName,
    displayNameLower: legacy.displayName.toLowerCase(),
    bio: legacy.bio || '',
    pfpURL: legacy.pfpURL || '',
    createdAt: legacy.createdAt || Date.now(),
    online: Boolean(legacy.online),
    ...(legacy.lastSeen ? { lastSeen: legacy.lastSeen } : {}),
  }).catch((error: unknown) => {
    throw logDatabaseError('update', `/publicProfiles/${uid}`, error);
  });
}

export function subscribeCurrentUser(
  uid: string,
  callback: (user: ChatUser) => void,
  onCriticalError: (error: Error) => void,
) {
  const publicPath = `/publicProfiles/${uid}`;
  const legacyPath = `/users/${uid}`;
  let closed = false;
  let legacyStop: (() => void) | undefined;
  let migrationStarted = false;
  let publicReadAllowed = true;
  let missingTimer: ReturnType<typeof setTimeout> | undefined;

  const startLegacy = () => {
    if (closed || legacyStop) return;
    legacyStop = onValue(
      ref(database, `users/${uid}`),
      (snapshot) => {
        if (closed) return;
        if (!snapshot.exists()) {
          missingTimer ??= setTimeout(() => {
            if (!closed)
              onCriticalError(
                new Error(
                  `No profile exists at ${legacyPath} or ${publicPath}. Retry after signup completes.`,
                ),
              );
          }, 5000);
          return;
        }
        clearTimeout(missingTimer);
        missingTimer = undefined;
        const raw = snapshot.val() as Partial<ChatUser>;
        callback(normalize(uid, raw));
        if (publicReadAllowed && !migrationStarted) {
          migrationStarted = true;
          void ensurePublicProfile(uid, raw).catch((error) => {
            console.warn(
              '[Relay Firebase] Optional public profile migration failed',
              error,
            );
          });
        }
      },
      (error) =>
        onCriticalError(logDatabaseError('onValue', legacyPath, error)),
    );
  };
  const stopPublic = onValue(
    profileRef(uid),
    (snapshot) => {
      if (closed) return;
      if (!snapshot.exists()) {
        startLegacy();
        return;
      }
      clearTimeout(missingTimer);
      missingTimer = undefined;
      legacyStop?.();
      legacyStop = undefined;
      callback(normalize(uid, snapshot.val()));
    },
    (error) => {
      publicReadAllowed = false;
      logDatabaseError('onValue', publicPath, error);
      startLegacy();
    },
  );
  return () => {
    closed = true;
    stopPublic();
    legacyStop?.();
    clearTimeout(missingTimer);
  };
}
export async function getUser(uid: string) {
  if (cache.has(uid)) return cache.get(uid)!;
  const active = subscriptions.get(uid)?.user;
  if (active) return active;
  const existing = pendingReads.get(uid);
  if (existing) return existing;
  const read = get(profileRef(uid)).then((snapshot) => {
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
    next.stop = onValue(
      profileRef(uid),
      (snapshot) => {
        if (!snapshot.exists()) return;
        const user = normalize(uid, snapshot.val());
        next.user = user;
        cache.set(uid, user);
        listeners.forEach((listener) => listener(user));
      },
      (error) => {
        logDatabaseError('onValue', `/publicProfiles/${uid}`, error);
      },
    );
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

  const usersRef = ref(database, 'publicProfiles');
  const upperBound = `${normalizedTerm}\uf8ff`;
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
  update(ref(database), {
    [`users/${uid}/displayName`]: data.displayName,
    [`users/${uid}/displayNameLower`]: data.displayName.trim().toLowerCase(),
    [`users/${uid}/bio`]: data.bio,
    [`users/${uid}/pfpURL`]: data.pfpURL,
    [`publicProfiles/${uid}/displayName`]: data.displayName,
    [`publicProfiles/${uid}/displayNameLower`]: data.displayName
      .trim()
      .toLowerCase(),
    [`publicProfiles/${uid}/bio`]: data.bio,
    [`publicProfiles/${uid}/pfpURL`]: data.pfpURL,
  });
