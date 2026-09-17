'use client';
import { useEffect, useState } from 'react';
import { onAuthStateChanged, type User as FirebaseUser } from 'firebase/auth';
import { auth } from '@/lib/firebase';

export function useAuth() {
  const [user, setUser] = useState<FirebaseUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  useEffect(
    () =>
      onAuthStateChanged(
        auth,
        (next) => {
          setUser(next);
          setError(null);
          setLoading(false);
        },
        (cause) => {
          console.error(
            '[Relay Firebase] onAuthStateChanged auth failed',
            cause,
          );
          setError(cause);
          setLoading(false);
        },
      ),
    [],
  );
  return { user, loading, error };
}
