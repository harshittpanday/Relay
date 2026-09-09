'use client';
import { useState, type SyntheticEvent } from 'react';
import {
  ArrowRight,
  LockKeyhole,
  Mail,
  MessageCircleMore,
  UserRound,
} from 'lucide-react';
import { logIn, signUp } from '@/services/auth';
import { friendlyError } from '@/lib/format';

export function AuthScreen() {
  const [mode, setMode] = useState<'login' | 'signup'>('login');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function submit(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    const data = new FormData(event.currentTarget);
    const value = (name: string) => {
      const item = data.get(name);
      return typeof item === 'string' ? item : '';
    };
    const email = value('email');
    const password = value('password');
    try {
      setBusy(true);
      if (mode === 'login') await logIn(email, password);
      else {
        const username = value('username');
        const displayName = value('displayName');
        if (!/^[a-z0-9_]{3,24}$/.test(username))
          throw new Error(
            'Username must be 3–24 letters, numbers, or underscores.',
          );
        if (displayName.trim().length < 2)
          throw new Error('Enter your display name.');
        await signUp(email, password, username, displayName);
      }
    } catch (cause) {
      setError(friendlyError(cause));
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="auth-shell">
      <section className="auth-brand">
        <div className="brand-mark">
          <MessageCircleMore size={25} />
        </div>
        <div>
          <strong>Relay</strong>
          <span>Conversations, without the noise.</span>
        </div>
        <div className="auth-copy">
          <p>Private space</p>
          <h1>Stay close to your people.</h1>
          <span>
            Messages arrive in real time, photos keep their detail, and your
            conversations stay focused.
          </span>
        </div>
        <div className="auth-quote">
          <div className="mini-avatars">
            <i />
            <i />
            <i />
          </div>
          <p>Pick up exactly where you left off.</p>
        </div>
      </section>
      <section className="auth-panel">
        <form className="auth-card" onSubmit={submit}>
          <header>
            <span>
              {mode === 'login' ? 'Welcome back' : 'Create your account'}
            </span>
            <h2>
              {mode === 'login' ? 'Sign in to Relay' : 'Start a conversation'}
            </h2>
            <p>
              {mode === 'login'
                ? 'Enter your details to continue.'
                : 'Choose a unique username people can find.'}
            </p>
          </header>
          {mode === 'signup' && (
            <>
              <label>
                Display name
                <div className="field">
                  <UserRound size={18} />
                  <input
                    name="displayName"
                    autoComplete="name"
                    placeholder="How people see you"
                    required
                  />
                </div>
              </label>
              <label>
                Username
                <div className="field prefix">
                  <span>@</span>
                  <input
                    name="username"
                    autoCapitalize="none"
                    autoComplete="username"
                    placeholder="your_username"
                    minLength={3}
                    maxLength={24}
                    pattern="[a-zA-Z0-9_]+"
                    required
                  />
                </div>
              </label>
            </>
          )}
          <label>
            Email
            <div className="field">
              <Mail size={18} />
              <input
                name="email"
                type="email"
                autoComplete="email"
                placeholder="you@example.com"
                required
              />
            </div>
          </label>
          <label>
            Password
            <div className="field">
              <LockKeyhole size={18} />
              <input
                name="password"
                type="password"
                autoComplete={
                  mode === 'login' ? 'current-password' : 'new-password'
                }
                minLength={6}
                placeholder="At least 6 characters"
                required
              />
            </div>
          </label>
          {error && (
            <div className="form-error" role="alert">
              {error}
            </div>
          )}
          <button className="primary-button" disabled={busy}>
            {busy ? (
              <span className="spinner" />
            ) : (
              <>
                {mode === 'login' ? 'Sign in' : 'Create account'}
                <ArrowRight size={18} />
              </>
            )}
          </button>
          <p className="auth-switch">
            {mode === 'login' ? 'New to Relay?' : 'Already have an account?'}{' '}
            <button
              type="button"
              onClick={() => {
                setMode(mode === 'login' ? 'signup' : 'login');
                setError('');
              }}
            >
              {mode === 'login' ? 'Create account' : 'Sign in'}
            </button>
          </p>
        </form>
      </section>
    </main>
  );
}
