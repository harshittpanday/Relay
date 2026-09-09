import { useState } from 'react';
import type { ChatUser } from '@/types/chat';

export function Avatar({
  user,
  size = 'md',
  online = false,
}: {
  user: Pick<ChatUser, 'uid' | 'displayName' | 'pfpURL'>;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  online?: boolean;
}) {
  const [broken, setBroken] = useState(false);
  const initials = user.displayName
    .split(/\s+/)
    .map((part) => part[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();
  return (
    <span
      className={`avatar avatar-${size}`}
      data-tone={
        Array.from(user.uid).reduce((a, c) => a + c.charCodeAt(0), 0) % 6
      }
    >
      {user.pfpURL && !broken ? (
        <img
          src={user.pfpURL}
          alt={`${user.displayName}'s profile`}
          onError={() => setBroken(true)}
        />
      ) : (
        <span aria-hidden="true">{initials || '?'}</span>
      )}
      {online && <i className="presence-dot" aria-label="Online" />}
    </span>
  );
}
