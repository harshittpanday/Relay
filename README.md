# Relay Chat

Relay is a modern TypeScript rebuild of the original Firebase ChatApp. It uses React on Vite/Vinext, Firebase Authentication and Realtime Database, Cloudinary-compatible image uploads, and an installable PWA shell.

## Features

- Email/password sign-up and login with atomic username claims
- Legacy-compatible `users`, `usernames`, `chats`, `messages`, `unread`, `typing`, and `seenBy` data
- Realtime conversations, presence, last seen, typing, unread counts, and read receipts
- Text and Cloudinary-hosted image messages with a lightbox
- Responsive desktop/mobile navigation, safe-area support, loading/empty/error states
- User search, profile editing, profile images, bio, and immutable usernames
- Opt-in service-worker browser notifications while Relay is running in a background tab or installed PWA window
- Installable PWA, cached application shell, cached Cloudinary images, and a prompt-based update flow
- Offline/reconnecting UI and failed-message retry without losing the draft

## Local development

Requires Node.js 22.13 or newer.

```bash
npm install
npm run dev
```

Open the local URL printed by the development server. Production checks:

```bash
npm run typecheck
npm run lint
npm run build
```

## Vercel deployment

The repository includes `vercel.json`. Vercel must run `npm run build` and publish `dist/client`; the static export produces `index.html`, the web manifest, and the service worker in that directory.

Add every required value from `.env.example` to the Vercel project's Environment Variables, then redeploy the latest `main` commit. Use the production domain or URL shown on the successful deployment. A Vercel response containing `X-Vercel-Error: DEPLOYMENT_NOT_FOUND` means the URL points to a deployment that does not exist or was removed; it is not an in-app route error.

## Environment

Copy `.env.example` to `.env.local` and fill in the Firebase web app configuration. Firebase web configuration identifies the Firebase project but is not a server secret; security must be enforced with Firebase Authentication and database/storage rules. Never add Admin SDK credentials or private service keys to a `VITE_` variable.

Required variables:

- `VITE_FIREBASE_API_KEY`
- `VITE_FIREBASE_AUTH_DOMAIN`
- `VITE_FIREBASE_DATABASE_URL`
- `VITE_FIREBASE_PROJECT_ID`
- `VITE_FIREBASE_STORAGE_BUCKET`
- `VITE_FIREBASE_MESSAGING_SENDER_ID`
- `VITE_FIREBASE_APP_ID`

Optional image-upload variables:

- `VITE_CLOUDINARY_CLOUD_NAME`
- `VITE_CLOUDINARY_UPLOAD_PRESET` (must be an unsigned preset with appropriate size/type limits)

## Firebase setup

1. Enable Email/Password under Firebase Authentication.
2. Create a Realtime Database.
3. For an existing database, backfill public profiles **before** deploying the new rules (see below). Then review and deploy `database.rules.json` from the Firebase Console or CLI. Relay keeps a lightweight `userChats/{uid}/{chatId}` index, reads only each conversation's `lastMessage` and current user's unread count for the sidebar, and subscribes to the full message list only for the open chat. On the first load after this update, each existing user performs one legacy chat lookup to populate the index; later loads use only the index.
4. Add the development and production hosts to Authentication → Authorized domains.
5. Existing messages remain compatible when `type`, `text`, or `seenBy` fields are missing.

The app extends existing records safely with `lastSeen`, `updatedAt`, and `lastMessage`. Usernames remain immutable in the UI so the existing `usernames/{username}` mapping cannot drift.

### Public profile migration

Search reads `publicProfiles/{uid}`, which contains only username, display name, bio, avatar URL, and presence metadata. The existing `users/{uid}` records remain intact but are readable only by their owner; legacy email fields are never copied to the public directory. New signups create both records in one database update after claiming the username. Existing users also populate their own public record on login, but an administrative backfill makes _inactive_ existing users discoverable immediately.

Using an administrator's Application Default Credentials, run the dry run and then apply it to the **correct** Realtime Database URL. Do not put service-account credentials in `VITE_` environment variables or commit them.

```bash
node scripts/backfill-public-profiles.mjs --database-url=https://YOUR-PROJECT-default-rtdb.firebaseio.com
node scripts/backfill-public-profiles.mjs --database-url=https://YOUR-PROJECT-default-rtdb.firebaseio.com --apply
```

The script only adds missing public profiles and username mappings. It stops on missing profile names or username collisions so existing data is not silently overwritten. After the backfill, deploy the new rules; otherwise new search reads will be denied by the live rules. Existing private `/users` records are not deleted.

If startup reports `onValue /publicProfiles/{uid}: PERMISSION_DENIED`, the deployed Realtime Database rules do not yet allow the new profile listener. Relay can open from the signed-in user's own legacy `/users/{uid}` record while those rules are pending, but directory search still requires the `publicProfiles` rules to be deployed. The backfill is only needed to make existing accounts that have not logged in since the change searchable; it is not required for a returning user's own profile to load.

User search makes two bounded reads at `/publicProfiles`: one ordered by `username`, one by `displayNameLower`, each with `startAt`, `endAt`, and `limitToFirst(12)`. The deployed rules must grant `".read": "auth != null"` **at `/publicProfiles` itself**, not just at `/publicProfiles/$uid`, and set `".indexOn": ["username", "displayNameLower"]` at that collection path. A child-only read rule does not authorize a collection query. The indexes improve query efficiency; a `PERMISSION_DENIED` response indicates the read authorization (or the database endpoint) is wrong, not merely a missing index. Check that the rules are deployed to the same Realtime Database instance as `VITE_FIREBASE_DATABASE_URL`.

## PWA and offline behavior

The generated service worker caches the application shell and previously loaded Cloudinary images. The current UI remains visible during a network interruption and reports Offline/Reconnecting. Relay does not claim durable offline message delivery: sending is paused while disconnected, and a failed text send leaves the draft intact with a Retry action.

When a new service worker is ready, Relay shows **Update available — Refresh** and never reloads a conversation automatically.

## Notifications

Notifications are requested only when the user enables them in Profile → Settings. While Relay is running, an incoming message in any conversation can create a service-worker notification when Relay is hidden or unfocused. If that exact chat is visible and focused, the notification is suppressed. Clicking a notification focuses or opens Relay and navigates to the conversation. Initial listener hydration, own messages, and duplicate message IDs are excluded, and text previews are sanitized and truncated.

True notifications when the app is fully closed require Firebase Cloud Messaging, a VAPID key, a messaging service worker, and a trusted backend/Cloud Function that sends FCM messages. Those pieces are intentionally not faked or included here.

## Database compatibility

The app continues to use:

```text
users/{uid}
publicProfiles/{uid}
usernames/{username}
chats/{chatId}/participants/{uid}
chats/{chatId}/messages/{messageId}
chats/{chatId}/unread/{uid}
chats/{chatId}/typing/{uid}
userChats/{uid}/{chatId}
userChatIndexVersion/{uid}
```

New messages use `sender`, `text`, `type`, `imageURL`, `time`, and `seenBy`. The deterministic chat ID remains the two user IDs sorted and joined by `_`.
