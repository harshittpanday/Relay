import type { Message } from '@/types/chat';

export const messagePreview = (
  message?: Message | { text?: string; type?: string },
) =>
  !message
    ? 'No messages yet'
    : message.type === 'image'
      ? 'Photo'
      : message.text?.trim() || 'Message';
export function formatConversationTime(value?: number) {
  if (!value) return '';
  const date = new Date(value);
  const now = new Date();
  if (date.toDateString() === now.toDateString())
    return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  return date.toDateString() === yesterday.toDateString()
    ? 'Yesterday'
    : date.toLocaleDateString([], { month: 'short', day: 'numeric' });
}
export const formatMessageTime = (value: number) =>
  new Date(value).toLocaleTimeString([], {
    hour: 'numeric',
    minute: '2-digit',
  });
export function formatDay(value: number) {
  const date = new Date(value);
  const now = new Date();
  if (date.toDateString() === now.toDateString()) return 'Today';
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (date.toDateString() === yesterday.toDateString()) return 'Yesterday';
  return date.toLocaleDateString([], {
    day: 'numeric',
    month: 'short',
    year: date.getFullYear() === now.getFullYear() ? undefined : 'numeric',
  });
}
export function formatPresence(lastSeen?: number) {
  if (!lastSeen) return 'Offline';
  const diff = Date.now() - lastSeen;
  if (diff < 120_000) return 'Last seen recently';
  if (diff < 86_400_000)
    return `Last seen ${new Date(lastSeen).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`;
  return `Last seen ${new Date(lastSeen).toLocaleDateString([], { month: 'short', day: 'numeric' })}`;
}
export function friendlyError(error: unknown) {
  const code =
    typeof error === 'object' && error && 'code' in error
      ? String(error.code)
      : '';
  const messages: Record<string, string> = {
    'auth/invalid-credential': 'The email or password is incorrect.',
    'auth/email-already-in-use': 'An account already uses this email.',
    'auth/weak-password': 'Use a password with at least 6 characters.',
    'auth/invalid-email': 'Enter a valid email address.',
    'auth/network-request-failed':
      'You appear to be offline. Try again when connected.',
    PERMISSION_DENIED: 'Firebase permissions blocked this action.',
  };
  return (
    messages[code] ||
    (error instanceof Error
      ? error.message
      : 'Something went wrong. Please try again.')
  );
}
