import type { ChatUser, Message, NotificationState } from '@/types/chat';
const KEY = 'relay-notifications';

export function getNotificationState(): NotificationState {
  const supported = typeof window !== 'undefined' && 'Notification' in window;
  const secure = typeof window !== 'undefined' && window.isSecureContext;
  const permission = supported ? Notification.permission : 'unsupported';
  const availability = !supported
    ? 'unsupported'
    : !secure
      ? 'insecure'
      : 'ready';
  return {
    enabled:
      availability === 'ready' &&
      localStorage.getItem(KEY) === 'on' &&
      permission === 'granted',
    permission,
    availability,
  };
}

export async function enableNotifications() {
  const state = getNotificationState();
  if (state.availability === 'unsupported')
    throw new Error('Notifications are not supported by this browser.');
  if (state.availability === 'insecure')
    throw new Error('Notifications require a secure HTTPS connection.');
  if (state.permission === 'denied')
    throw new Error(
      'Notifications are blocked. Allow them in your browser site settings.',
    );
  const permission = await Notification.requestPermission();
  const enabled = permission === 'granted';
  localStorage.setItem(KEY, enabled ? 'on' : 'off');
  return {
    enabled,
    permission,
    availability: 'ready',
  } satisfies NotificationState;
}

export function disableNotifications() {
  localStorage.setItem(KEY, 'off');
  return getNotificationState();
}

export async function notifyIncoming(
  sender: ChatUser,
  message: Message,
  chatId: string,
  currentUid: string,
  relevantChatVisible: boolean,
) {
  if (message.sender === currentUid || relevantChatVisible) return false;
  const state = getNotificationState();
  if (!state.enabled) return false;

  const body =
    message.type === 'image'
      ? 'Sent a photo'
      : message.text.replace(/\s+/g, ' ').trim().slice(0, 120) || 'New message';
  const options: NotificationOptions = {
    body,
    icon: sender.pfpURL || '/pwa-192x192.png',
    badge: '/favicon-32x32.png',
    tag: `${chatId}-${message.id}`,
    data: { url: `/#chat=${encodeURIComponent(chatId)}` },
  };

  try {
    const registration = await navigator.serviceWorker.getRegistration();
    if (registration) {
      await registration.showNotification(sender.displayName, options);
      return true;
    }

    const notification = new Notification(sender.displayName, options);
    notification.onclick = () => {
      window.focus();
      window.location.hash = `chat=${encodeURIComponent(chatId)}`;
      notification.close();
    };
    return true;
  } catch (error) {
    console.warn('[Relay notifications] Delivery failed', error);
    return false;
  }
}
