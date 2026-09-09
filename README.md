# Relay Chat

Relay is a modern TypeScript rebuild of the original Firebase ChatApp. It uses React on Vite/Vinext, Firebase Authentication and Realtime Database, Cloudinary-compatible image uploads, and an installable PWA shell.

## Features

- Email/password sign-up and login with atomic username claims
- Legacy-compatible `users`, `usernames`, `chats`, `messages`, `unread`, `typing`, and `seenBy` data
- Realtime conversations, presence, last seen, typing, unread counts, and read receipts
- Text and Cloudinary-hosted image messages with a lightbox
- Responsive desktop/mobile navigation, safe-area support, loading/empty/error states
- User search, profile editing, profile images, bio, and immutable usernames
- Opt-in in-page browser notifications while Relay is open
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
3. Review and deploy `database.rules.json` from the Firebase Console or CLI. The included rules match the legacy data model and require the chat-list query to filter by the signed-in user's participant path. The app then keeps only a one-message query and unread listener per relevant conversation; the full message listener exists only for the open chat. A future migration can add `userChats/{uid}/{chatId}` for fully indexed per-user discovery reads.
4. Add the development and production hosts to Authentication → Authorized domains.
5. Existing messages remain compatible when `type`, `text`, or `seenBy` fields are missing.

The app extends existing records safely with `lastSeen`, `updatedAt`, and `lastMessage`. Usernames remain immutable in the UI so the existing `usernames/{username}` mapping cannot drift.

## PWA and offline behavior

The generated service worker caches the application shell and previously loaded Cloudinary images. The current UI remains visible during a network interruption and reports Offline/Reconnecting. Relay does not claim durable offline message delivery: sending is paused while disconnected, and a failed text send leaves the draft intact with a Retry action.

When a new service worker is ready, Relay shows **Update available — Refresh** and never reloads a conversation automatically.

## Notifications

Notifications are requested only when the user enables them in Profile → Settings. While Relay is running, an incoming message can create a browser notification when the tab is hidden; clicking it focuses Relay and opens the conversation. Own messages and visible-tab messages are excluded, and previews are truncated.

True notifications when the app is fully closed require Firebase Cloud Messaging, a VAPID key, a messaging service worker, and a trusted backend/Cloud Function that sends FCM messages. Those pieces are intentionally not faked or included here.

## Database compatibility

The app continues to use:

```text
users/{uid}
usernames/{username}
chats/{chatId}/participants/{uid}
chats/{chatId}/messages/{messageId}
chats/{chatId}/unread/{uid}
chats/{chatId}/typing/{uid}
```

New messages use `sender`, `text`, `type`, `imageURL`, `time`, and `seenBy`. The deterministic chat ID remains the two user IDs sorted and joined by `_`.
