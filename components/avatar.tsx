'use client';

import { memo, useEffect, useMemo, useState } from 'react';
import type { ChatUser } from '@/types/chat';

export const Avatar = memo(function Avatar({
  user,
  size = 'md',
  online = false,
}: {
  user: Pick<ChatUser, 'uid' | 'displayName' | 'pfpURL'>;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  online?: boolean;
}) {
  const [broken, setBroken] = useState(false);
  useEffect(() => setBroken(false), [user.pfpURL]);
  const initials = useMemo(
    () =>
      user.displayName
        .split(/\s+/)
        .map((part) => part[0])
        .join('')
        .slice(0, 2)
        .toUpperCase(),
    [user.displayName],
  );
  return (
    <span
      className={`avatar-shell avatar-${size}`}
      aria-label={`${user.displayName}${online ? ', online' : ''}`}
    >
      <span
        className="avatar"
        data-tone={
          Array.from(user.uid).reduce((a, c) => a + c.charCodeAt(0), 0) % 6
        }
      >
        {user.pfpURL && !broken ? (
          <img
            src={user.pfpURL}
            alt=""
            loading="lazy"
            decoding="async"
            onError={() => setBroken(true)}
          />
        ) : (
          <span aria-hidden="true">{initials || '?'}</span>
        )}
      </span>
      {online && <i className="presence-dot" aria-label="Online" />}
    </span>
  );
});
