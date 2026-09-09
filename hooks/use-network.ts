'use client';
import { useEffect, useState } from 'react';
import { onValue, ref } from 'firebase/database';
import { database } from '@/lib/firebase';

export function useNetwork() {
  const [browserOnline, setBrowserOnline] = useState(true);
  const [firebaseOnline, setFirebaseOnline] = useState(false);
  useEffect(() => {
    const sync = () => setBrowserOnline(navigator.onLine);
    sync();
    window.addEventListener('online', sync);
    window.addEventListener('offline', sync);
    const unsubscribe = onValue(ref(database, '.info/connected'), (snapshot) =>
      setFirebaseOnline(snapshot.val() === true),
    );
    return () => {
      window.removeEventListener('online', sync);
      window.removeEventListener('offline', sync);
      unsubscribe();
    };
  }, []);
  return !browserOnline
    ? 'offline'
    : firebaseOnline
      ? 'online'
      : 'reconnecting';
}
