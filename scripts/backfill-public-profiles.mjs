import { applicationDefault, initializeApp } from 'firebase-admin/app';
import { getDatabase } from 'firebase-admin/database';

const databaseURL = process.argv
  .find((argument) => argument.startsWith('--database-url='))
  ?.slice('--database-url='.length);
const apply = process.argv.includes('--apply');

if (!databaseURL || !databaseURL.startsWith('https://')) {
  console.error(
    'Usage: node scripts/backfill-public-profiles.mjs --database-url=https://PROJECT-default-rtdb.firebaseio.com [--apply]',
  );
  process.exitCode = 1;
} else {
  const app = initializeApp({ credential: applicationDefault(), databaseURL });
  try {
    const database = getDatabase(app);
    const [usersSnapshot, usernamesSnapshot, publicSnapshot] =
      await Promise.all([
        database.ref('users').get(),
        database.ref('usernames').get(),
        database.ref('publicProfiles').get(),
      ]);
    const users = usersSnapshot.val() || {};
    const usernames = usernamesSnapshot.val() || {};
    const existing = publicSnapshot.val() || {};
    const updates = {};
    const claimed = new Map();

    for (const [uid, user] of Object.entries(users)) {
      if (!user || typeof user !== 'object') continue;
      const username = String(user.username || '')
        .trim()
        .toLowerCase();
      const displayName = String(user.displayName || '').trim();
      if (!username || !displayName) {
        throw new Error(
          `User ${uid} has no username/display name; repair this record before applying.`,
        );
      }
      if (
        (usernames[username] && usernames[username] !== uid) ||
        (claimed.has(username) && claimed.get(username) !== uid)
      ) {
        throw new Error(
          `Username ${username} belongs to multiple users; resolve the collision before applying.`,
        );
      }
      claimed.set(username, uid);
      if (!usernames[username]) updates[`usernames/${username}`] = uid;
      if (existing[uid]) continue;
      updates[`publicProfiles/${uid}`] = {
        username,
        displayName,
        displayNameLower: displayName.toLowerCase(),
        bio: String(user.bio || ''),
        pfpURL: String(user.pfpURL || ''),
        createdAt: Number(user.createdAt) || Date.now(),
        online: Boolean(user.online),
        ...(Number(user.lastSeen) ? { lastSeen: Number(user.lastSeen) } : {}),
      };
    }

    const profiles = Object.keys(updates).filter((path) =>
      path.startsWith('publicProfiles/'),
    ).length;
    const mappings = Object.keys(updates).length - profiles;
    console.log(
      `${profiles} public profiles and ${mappings} username mappings need backfill.`,
    );
    if (apply && Object.keys(updates).length) {
      await database.ref().update(updates);
      console.log(
        'Backfill complete. Existing /users records were left untouched.',
      );
    } else if (!apply) {
      console.log(
        'Dry run only. Re-run with --apply to write the missing records.',
      );
    }
  } finally {
    await app.delete();
  }
}
