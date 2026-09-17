import {
  createUserWithEmailAndPassword,
  deleteUser,
  signInWithEmailAndPassword,
  signOut,
  updateProfile,
} from 'firebase/auth';
import { ref, runTransaction, set } from 'firebase/database';
import { auth, database } from '@/lib/firebase';

export async function signUp(
  email: string,
  password: string,
  username: string,
  displayName: string,
) {
  const normalized = username.trim().toLowerCase();
  const credential = await createUserWithEmailAndPassword(
    auth,
    email.trim(),
    password,
  );
  const usernameRef = ref(database, `usernames/${normalized}`);
  let usernameClaimed = false;
  try {
    const claim = await runTransaction(usernameRef, (current) =>
      current === null ? credential.user.uid : undefined,
    );
    if (!claim.committed) throw new Error('That username is already taken.');
    usernameClaimed = true;
    await Promise.all([
      set(ref(database, `users/${credential.user.uid}`), {
        email: email.trim(),
        username: normalized,
        displayName: displayName.trim(),
        displayNameLower: displayName.trim().toLowerCase(),
        bio: '',
        pfpURL: '',
        createdAt: Date.now(),
        online: false,
      }),
      updateProfile(credential.user, { displayName: displayName.trim() }),
    ]);
  } catch (error) {
    if (usernameClaimed)
      await runTransaction(usernameRef, (current) =>
        current === credential.user.uid ? null : current,
      ).catch(() => undefined);
    await deleteUser(credential.user).catch(() => undefined);
    throw error;
  }
}
export const logIn = (email: string, password: string) =>
  signInWithEmailAndPassword(auth, email.trim(), password);
export const logOut = () => signOut(auth);
