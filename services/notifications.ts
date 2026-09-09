import type { ChatUser, Message, NotificationState } from '@/types/chat';
const KEY = 'relay-notifications';
export function getNotificationState(): NotificationState {
  const permission =
    typeof Notification === 'undefined'
      ? 'unsupported'
      : Notification.permission;
  return {
    enabled:
      typeof localStorage !== 'undefined' &&
      localStorage.getItem(KEY) === 'on' &&
      permission === 'granted',
    permission,
  };
}
export async function enableNotifications() {
  if (typeof Notification === 'undefined')
    throw new Error('Notifications are not supported by this browser.');
  const permission = await Notification.requestPermission();
  const enabled = permission === 'granted';
  localStorage.setItem(KEY, enabled ? 'on' : 'off');
  return { enabled, permission } satisfies NotificationState;
}
export function disableNotifications() {
  localStorage.setItem(KEY, 'off');
  return getNotificationState();
}
export function notifyIncoming(
  sender: ChatUser,
  message: Message,
  chatId: string,
) {
  const state = getNotificationState();
  if (!state.enabled || document.visibilityState === 'visible') return;
  const notification = new Notification(sender.displayName, {
    body:
      message.type === 'image' ? 'Sent a photo' : message.text.slice(0, 120),
    icon: sender.pfpURL || '/pwa-192x192.png',
    tag: `${chatId}-${message.id}`,
  });
  notification.onclick = () => {
    window.focus();
    window.location.hash = `chat=${chatId}`;
    notification.close();
  };
}
