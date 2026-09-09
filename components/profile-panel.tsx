import { useRef, useState, type SyntheticEvent } from 'react';
import { Bell, BellOff, Download, LogOut, Upload, X } from 'lucide-react';
import type { ChatUser, NotificationState } from '@/types/chat';
import { Avatar } from './avatar';
import { updateUserProfile } from '@/services/users';
import { uploadImage } from '@/services/uploads';
import { logOut } from '@/services/auth';
import {
  disableNotifications,
  enableNotifications,
} from '@/services/notifications';
import { friendlyError } from '@/lib/format';
import { useToast } from './toast';

interface ProfilePanelProps {
  user: ChatUser;
  onClose: () => void;
  notifications: NotificationState;
  onNotifications: (state: NotificationState) => void;
  canInstall: boolean;
  onInstall: () => void;
}

export function ProfilePanel({
  user,
  onClose,
  notifications,
  onNotifications,
  canInstall,
  onInstall,
}: ProfilePanelProps) {
  const toast = useToast();
  const picker = useRef<HTMLInputElement>(null);
  const [displayName, setDisplayName] = useState(user.displayName);
  const [bio, setBio] = useState(user.bio || '');
  const [pfpURL, setPfpURL] = useState(user.pfpURL || '');
  const [busy, setBusy] = useState(false);
  async function save(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    try {
      setBusy(true);
      await updateUserProfile(user.uid, {
        displayName: displayName.trim(),
        bio: bio.trim(),
        pfpURL,
      });
      toast('Profile updated', 'success');
    } catch (error) {
      toast(friendlyError(error), 'error');
    } finally {
      setBusy(false);
    }
  }
  async function choose(file?: File) {
    if (!file) return;
    try {
      setBusy(true);
      setPfpURL(await uploadImage(file));
      toast('Photo ready — save to apply it.', 'success');
    } catch (error) {
      toast(friendlyError(error), 'error');
    } finally {
      setBusy(false);
    }
  }
  async function toggleNotifications() {
    try {
      onNotifications(
        notifications.enabled
          ? disableNotifications()
          : await enableNotifications(),
      );
    } catch (error) {
      toast(friendlyError(error), 'error');
    }
  }
  return (
    <div className="panel-backdrop">
      <aside className="profile-panel" aria-label="Profile and settings">
        <header>
          <div>
            <span>Settings</span>
            <h2>Your profile</h2>
          </div>
          <button
            className="icon-button"
            onClick={onClose}
            aria-label="Close settings"
          >
            <X />
          </button>
        </header>
        <form onSubmit={save}>
          <div className="profile-photo">
            <Avatar user={{ ...user, pfpURL }} size="xl" />
            <input
              ref={picker}
              hidden
              type="file"
              accept="image/*"
              onChange={(event) => choose(event.target.files?.[0])}
            />
            <button type="button" onClick={() => picker.current?.click()}>
              <Upload size={16} /> Change photo
            </button>
          </div>
          <label>
            Display name
            <input
              value={displayName}
              onChange={(event) => setDisplayName(event.target.value)}
              required
              minLength={2}
              maxLength={50}
            />
          </label>
          <label>
            Username
            <input value={`@${user.username}`} disabled />
            <small>
              Usernames are kept fixed to protect existing chat links.
            </small>
          </label>
          <label>
            Bio
            <textarea
              value={bio}
              onChange={(event) => setBio(event.target.value)}
              maxLength={160}
              rows={3}
              placeholder="A little about you"
            />
          </label>
          <button
            className="primary-button"
            disabled={busy || !displayName.trim()}
          >
            {busy ? <span className="spinner" /> : 'Save profile'}
          </button>
        </form>
        <div className="settings-list">
          <button onClick={toggleNotifications}>
            {notifications.enabled ? <Bell size={19} /> : <BellOff size={19} />}
            <span>
              <strong>Message notifications</strong>
              <small>
                {notifications.permission === 'denied'
                  ? 'Blocked in browser settings'
                  : notifications.enabled
                    ? 'On while Relay is running'
                    : 'Off'}
              </small>
            </span>
            <i className={notifications.enabled ? 'switch on' : 'switch'} />
          </button>
          {canInstall && (
            <button onClick={onInstall}>
              <Download size={19} />
              <span>
                <strong>Install Relay</strong>
                <small>Add the app to this device</small>
              </span>
            </button>
          )}
          <button className="danger-row" onClick={() => logOut()}>
            <LogOut size={19} />
            <span>
              <strong>Sign out</strong>
              <small>Return to the sign in screen</small>
            </span>
          </button>
        </div>
      </aside>
    </div>
  );
}
