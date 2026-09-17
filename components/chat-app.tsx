'use client';
import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type KeyboardEvent,
} from 'react';
import {
  ArrowLeft,
  Bell,
  CheckCheck,
  Image as ImageIcon,
  MessageCircleMore,
  MoreHorizontal,
  Paperclip,
  Search,
  Send,
  Settings,
  WifiOff,
  X,
} from 'lucide-react';
import { useAuth } from '@/hooks/use-auth';
import { useNetwork } from '@/hooks/use-network';
import { usePwa } from '@/hooks/use-pwa';
import { firebaseConfigured } from '@/lib/firebase';
import {
  formatConversationTime,
  formatDay,
  formatMessageTime,
  formatPresence,
  friendlyError,
  messagePreview,
} from '@/lib/format';
import { connectPresence, setTyping } from '@/services/presence';
import {
  ensureChat,
  markChatRead,
  sendMessage,
  subscribeConversations,
  subscribeMessages,
  subscribeTyping,
} from '@/services/chats';
import { searchUsers, subscribeUser } from '@/services/users';
import { uploadImage } from '@/services/uploads';
import { getNotificationState, notifyIncoming } from '@/services/notifications';
import type {
  ChatUser,
  Conversation,
  Message,
  NotificationState,
} from '@/types/chat';
import { AuthScreen } from './auth-screen';
import { Avatar } from './avatar';
import { ProfilePanel } from './profile-panel';
import { ToastProvider, useToast } from './toast';

export function ChatApp() {
  return (
    <ToastProvider>
      <ChatAppInner />
    </ToastProvider>
  );
}

function ChatAppInner() {
  const { user: authUser, loading: authLoading } = useAuth();
  const network = useNetwork();
  const pwa = usePwa();
  const toast = useToast();
  const [me, setMe] = useState<ChatUser | null>(null);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeId, setActiveId] = useState<string>();
  const [activeFallback, setActiveFallback] = useState<Conversation | null>(
    null,
  );
  const [activeUser, setActiveUser] = useState<ChatUser | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [messagesLoading, setMessagesLoading] = useState(false);
  const [otherTyping, setOtherTyping] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [attentionTick, setAttentionTick] = useState(0);
  const [notifications, setNotifications] = useState<NotificationState>({
    enabled: false,
    permission: 'unsupported',
    availability: 'unsupported',
  });
  const activeIdRef = useRef(activeId);
  const conversationsRef = useRef<Conversation[]>([]);

  const sortedConversations = useMemo(
    () =>
      [...conversations].sort(
        (a, b) =>
          (b.updatedAt || b.latestMessage?.time || 0) -
          (a.updatedAt || a.latestMessage?.time || 0),
      ),
    [conversations],
  );
  const baseActive = useMemo(
    () =>
      sortedConversations.find((item) => item.id === activeId) ||
      (activeFallback?.id === activeId ? activeFallback : null),
    [activeFallback, activeId, sortedConversations],
  );
  const active = useMemo(
    () =>
      baseActive && activeUser?.uid === baseActive.otherUser.uid
        ? { ...baseActive, otherUser: activeUser }
        : baseActive,
    [activeUser, baseActive],
  );
  activeIdRef.current = activeId;
  conversationsRef.current = sortedConversations;

  useEffect(() => setNotifications(getNotificationState()), []);
  useEffect(() => {
    const changed = () => {
      setAttentionTick((value) => value + 1);
      setNotifications(getNotificationState());
    };
    document.addEventListener('visibilitychange', changed);
    window.addEventListener('focus', changed);
    return () => {
      document.removeEventListener('visibilitychange', changed);
      window.removeEventListener('focus', changed);
    };
  }, []);
  useEffect(() => {
    if (!authUser) {
      setMe(null);
      return;
    }
    const stopUser = subscribeUser(authUser.uid, setMe);
    const stopPresence = connectPresence(authUser.uid);
    return () => {
      stopUser();
      stopPresence();
    };
  }, [authUser]);
  useEffect(() => {
    if (!authUser) return;
    return subscribeConversations(
      authUser.uid,
      setConversations,
      (error) => toast(friendlyError(error), 'error'),
      (conversation, message) => {
        const relevantChatVisible =
          activeIdRef.current === conversation.id &&
          document.visibilityState === 'visible' &&
          document.hasFocus();
        void notifyIncoming(
          conversation.otherUser,
          message,
          conversation.id,
          authUser.uid,
          relevantChatVisible,
        );
      },
    );
  }, [authUser, toast]);
  useEffect(() => {
    if (!baseActive) {
      setActiveUser(null);
      return;
    }
    return subscribeUser(baseActive.otherUser.uid, setActiveUser);
  }, [baseActive?.otherUser.uid]);
  useEffect(() => {
    if (!active) {
      setMessages([]);
      return;
    }
    setMessagesLoading(true);
    const stopMessages = subscribeMessages(
      active.id,
      (next) => {
        setMessages(next);
        setMessagesLoading(false);
      },
      (error) => {
        toast(friendlyError(error), 'error');
        setMessagesLoading(false);
      },
    );
    const stopTyping = subscribeTyping(
      active.id,
      active.otherUser.uid,
      setOtherTyping,
    );
    return () => {
      stopMessages();
      stopTyping();
    };
  }, [active?.id, toast]);
  useEffect(() => {
    if (
      !active ||
      !authUser ||
      document.visibilityState !== 'visible' ||
      !document.hasFocus() ||
      !messages.length
    )
      return;
    const hasUnread = Boolean(active.unread?.[authUser.uid]);
    const hasUnseen = messages.some(
      (message) =>
        message.sender !== authUser.uid && !message.seenBy[authUser.uid],
    );
    if (hasUnread || hasUnseen)
      markChatRead(active.id, authUser.uid, messages).catch(() => undefined);
  }, [active?.id, active?.unread, authUser, messages, attentionTick]);
  useEffect(() => {
    const openFromHash = () => {
      const id = location.hash.match(/chat=([^&]+)/)?.[1];
      if (id) {
        const decoded = decodeURIComponent(id);
        const match = conversationsRef.current.find(
          (item) => item.id === decoded,
        );
        if (match) {
          setActiveId(decoded);
          setActiveFallback(match);
        }
      } else {
        setActiveId(undefined);
        setActiveFallback(null);
      }
    };
    openFromHash();
    window.addEventListener('hashchange', openFromHash);
    window.addEventListener('popstate', openFromHash);
    return () => {
      window.removeEventListener('hashchange', openFromHash);
      window.removeEventListener('popstate', openFromHash);
    };
  }, []);
  useEffect(() => {
    const id = location.hash.match(/chat=([^&]+)/)?.[1];
    if (!id || activeIdRef.current) return;
    const decoded = decodeURIComponent(id);
    const match = sortedConversations.find((item) => item.id === decoded);
    if (match) {
      setActiveId(decoded);
      setActiveFallback(match);
    }
  }, [sortedConversations]);

  const selectConversation = useCallback((conversation: Conversation) => {
    setActiveId(conversation.id);
    setActiveFallback(conversation);
    history.pushState(
      { chatId: conversation.id },
      '',
      `#chat=${encodeURIComponent(conversation.id)}`,
    );
  }, []);
  const closeConversation = useCallback(() => {
    setActiveId(undefined);
    setActiveFallback(null);
    history.pushState({}, '', location.pathname);
  }, []);
  const openSettings = useCallback(() => setProfileOpen(true), []);
  const startConversation = useCallback(
    async (other: ChatUser) => {
      if (!me) return;
      try {
        const chatId = await ensureChat(me.uid, other.uid);
        const existing = conversationsRef.current.find(
          (item) => item.id === chatId,
        );
        selectConversation(
          existing || {
            id: chatId,
            participants: { [me.uid]: true, [other.uid]: true },
            otherUser: other,
          },
        );
      } catch (error) {
        toast(friendlyError(error), 'error');
      }
    },
    [me, selectConversation, toast],
  );

  if (!firebaseConfigured) return <ConfigMissing />;
  if (authLoading || (authUser && !me)) return <LoadingScreen />;
  if (!authUser || !me) return <AuthScreen />;

  return (
    <main className={`app-shell ${active ? 'chat-open' : ''}`}>
      <Sidebar
        me={me}
        conversations={sortedConversations}
        activeId={active?.id}
        onSelect={selectConversation}
        onSettings={openSettings}
        onNewChat={startConversation}
      />
      <section className="conversation-pane">
        {active ? (
          <ConversationView
            key={active.id}
            conversation={active}
            me={me}
            messages={messages}
            loading={messagesLoading}
            typing={otherTyping}
            network={network}
            onBack={closeConversation}
          />
        ) : (
          <EmptyConversation />
        )}
      </section>
      <div className={`network-chip ${network}`}>
        <span />
        {network === 'online'
          ? 'Online'
          : network === 'offline'
            ? 'Offline'
            : 'Reconnecting…'}
      </div>
      {network === 'offline' && (
        <div className="offline-banner">
          <WifiOff size={16} /> You’re offline. Existing conversations remain
          visible; sending is paused.
        </div>
      )}
      {pwa.updateReady && (
        <div className="update-toast">
          Update available <button onClick={pwa.applyUpdate}>Refresh</button>
        </div>
      )}
      {profileOpen && (
        <ProfilePanel
          user={me}
          onClose={() => setProfileOpen(false)}
          notifications={notifications}
          onNotifications={setNotifications}
          canInstall={pwa.canInstall}
          onInstall={pwa.install}
        />
      )}
    </main>
  );
}

const Sidebar = memo(function Sidebar({
  me,
  conversations,
  activeId,
  onSelect,
  onSettings,
  onNewChat,
}: {
  me: ChatUser;
  conversations: Conversation[];
  activeId?: string;
  onSelect: (conversation: Conversation) => void;
  onSettings: () => void;
  onNewChat: (user: ChatUser) => void;
}) {
  const toast = useToast();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<ChatUser[]>([]);
  const [searching, setSearching] = useState(false);
  useEffect(() => {
    if (query.trim().length < 2) {
      setResults([]);
      setSearching(false);
      return;
    }
    setSearching(true);
    let cancelled = false;
    const timer = window.setTimeout(() => {
      searchUsers(query, me.uid)
        .then((users) => !cancelled && setResults(users))
        .catch((error) => {
          if (!cancelled) toast(friendlyError(error), 'error');
        })
        .finally(() => !cancelled && setSearching(false));
    }, 350);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query, me.uid, toast]);
  return (
    <aside className="sidebar">
      <header className="sidebar-header">
        <div className="wordmark">
          <span>
            <MessageCircleMore size={21} />
          </span>
          Relay
        </div>
        <button
          className="icon-button"
          onClick={onSettings}
          aria-label="Open profile and settings"
        >
          <Settings size={20} />
        </button>
      </header>
      <div className="search-box">
        <Search size={18} />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search people"
          aria-label="Search people"
        />
        {query && (
          <button onClick={() => setQuery('')} aria-label="Clear search">
            <X size={16} />
          </button>
        )}
      </div>
      <div className="sidebar-title">
        <h1>{query ? 'People' : 'Messages'}</h1>
        <span>
          {query
            ? 'Search results'
            : `${conversations.length} conversation${conversations.length === 1 ? '' : 's'}`}
        </span>
      </div>
      <div className="chat-list">
        {query ? (
          <SearchResults
            results={results}
            searching={searching}
            onSelect={(user) => {
              onNewChat(user);
              setQuery('');
            }}
          />
        ) : conversations.length ? (
          conversations.map((conversation) => (
            <ConversationRow
              key={conversation.id}
              conversation={conversation}
              meUid={me.uid}
              active={activeId === conversation.id}
              onSelect={onSelect}
            />
          ))
        ) : (
          <div className="sidebar-empty">
            <MessageCircleMore />
            <strong>No conversations yet</strong>
            <span>Search for someone to send your first message.</span>
          </div>
        )}
      </div>
      <footer className="sidebar-profile">
        <Avatar user={me} size="sm" online />
        <div>
          <strong>{me.displayName}</strong>
          <span>@{me.username}</span>
        </div>
        <button
          className="icon-button"
          onClick={onSettings}
          aria-label="Profile menu"
        >
          <MoreHorizontal />
        </button>
      </footer>
    </aside>
  );
});

const SearchResults = memo(function SearchResults({
  results,
  searching,
  onSelect,
}: {
  results: ChatUser[];
  searching: boolean;
  onSelect: (user: ChatUser) => void;
}) {
  if (searching)
    return (
      <div className="skeleton-list">
        {[1, 2, 3].map((n) => (
          <div key={n}>
            <i />
            <span />
          </div>
        ))}
      </div>
    );
  if (!results.length)
    return (
      <div className="sidebar-empty">
        <Search />
        <strong>No one found</strong>
        <span>Try a display name or exact username.</span>
      </div>
    );
  return (
    <>
      {results.map((user) => (
        <button
          className="person-result"
          key={user.uid}
          onClick={() => onSelect(user)}
        >
          <Avatar user={user} size="md" online={user.online} />
          <span>
            <strong>{user.displayName}</strong>
            <small>@{user.username}</small>
          </span>
          <i>Message</i>
        </button>
      ))}
    </>
  );
});

const ConversationRow = memo(function ConversationRow({
  conversation,
  meUid,
  active,
  onSelect,
}: {
  conversation: Conversation;
  meUid: string;
  active: boolean;
  onSelect: (conversation: Conversation) => void;
}) {
  const [user, setUser] = useState(conversation.otherUser);
  useEffect(
    () => subscribeUser(conversation.otherUser.uid, setUser),
    [conversation.otherUser.uid],
  );
  const unread = conversation.unread?.[meUid] || 0;
  const latest = conversation.latestMessage;
  return (
    <button
      className={`conversation-row ${active ? 'active' : ''}`}
      onClick={() => onSelect(conversation)}
    >
      <Avatar user={user} online={user.online} />
      <span className="conversation-copy">
        <span>
          <strong>{user.displayName}</strong>
          <time>
            {formatConversationTime(conversation.updatedAt || latest?.time)}
          </time>
        </span>
        <span>
          <small>
            {latest?.sender === meUid && 'You: '}
            {messagePreview(latest)}
          </small>
          {unread > 0 && (
            <i aria-label={`${unread} unread messages`}>
              {unread > 99 ? '99+' : unread}
            </i>
          )}
        </span>
      </span>
    </button>
  );
});

function ConversationView({
  conversation,
  me,
  messages,
  loading,
  typing,
  network,
  onBack,
}: {
  conversation: Conversation;
  me: ChatUser;
  messages: Message[];
  loading: boolean;
  typing: boolean;
  network: string;
  onBack: () => void;
}) {
  const other = conversation.otherUser;
  const status = typing
    ? 'Typing…'
    : other.online
      ? 'Online'
      : formatPresence(other.lastSeen);
  const toast = useToast();
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [failed, setFailed] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(true);
  const picker = useRef<HTMLInputElement>(null);
  const typingTimer = useRef<number | null>(null);
  const typingActive = useRef(false);
  useLayoutEffect(() => {
    if (!stickToBottom.current) return;
    const frame = requestAnimationFrame(() => {
      const scroller = scrollRef.current;
      if (scroller) scroller.scrollTop = scroller.scrollHeight;
      else endRef.current?.scrollIntoView({ block: 'end' });
    });
    return () => cancelAnimationFrame(frame);
  }, [messages.length]);
  useEffect(
    () => () => {
      if (typingTimer.current) clearTimeout(typingTimer.current);
      if (typingActive.current)
        setTyping(conversation.id, me.uid, false).catch(() => undefined);
    },
    [conversation.id, me.uid],
  );
  function changed(value: string) {
    setDraft(value);
    setFailed(false);
    if (typingTimer.current) clearTimeout(typingTimer.current);
    const shouldType = Boolean(value.trim());
    if (shouldType !== typingActive.current) {
      typingActive.current = shouldType;
      setTyping(conversation.id, me.uid, shouldType).catch(() => undefined);
    }
    if (shouldType)
      typingTimer.current = window.setTimeout(() => {
        typingActive.current = false;
        setTyping(conversation.id, me.uid, false).catch(() => undefined);
      }, 3000);
  }
  async function sendText() {
    const text = draft.trim();
    if (!text || sending || network !== 'online') return;
    try {
      setSending(true);
      setFailed(false);
      await sendMessage(conversation.id, me.uid, other.uid, { text });
      setDraft('');
      if (typingTimer.current) {
        clearTimeout(typingTimer.current);
        typingTimer.current = null;
      }
      if (typingActive.current) {
        typingActive.current = false;
        await setTyping(conversation.id, me.uid, false);
      }
    } catch (error) {
      setFailed(true);
      toast(friendlyError(error), 'error');
    } finally {
      setSending(false);
    }
  }
  async function attach(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file || network !== 'online') return;
    try {
      setUploading(true);
      const imageURL = await uploadImage(file);
      await sendMessage(conversation.id, me.uid, other.uid, { imageURL });
    } catch (error) {
      toast(friendlyError(error), 'error');
    } finally {
      setUploading(false);
    }
  }
  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      void sendText();
    }
  }
  return (
    <div className="conversation">
      <header className="conversation-header">
        <button
          className="icon-button back-button"
          onClick={onBack}
          aria-label="Back to conversations"
        >
          <ArrowLeft />
        </button>
        <Avatar user={other} size="sm" online={other.online} />
        <div>
          <strong>{other.displayName}</strong>
          <span className={typing ? 'typing' : ''}>{status}</span>
        </div>
        <button
          className="icon-button header-action"
          aria-label="Conversation options"
        >
          <MoreHorizontal />
        </button>
      </header>
      <div
        ref={scrollRef}
        className="message-scroll"
        onScroll={(event) => {
          const target = event.currentTarget;
          stickToBottom.current =
            target.scrollHeight - target.scrollTop - target.clientHeight < 120;
        }}
      >
        {loading ? (
          <MessageSkeleton />
        ) : !messages.length ? (
          <div className="new-conversation">
            <Avatar user={other} size="xl" />
            <h2>{other.displayName}</h2>
            <p>@{other.username}</p>
            <span>This is the beginning of your conversation.</span>
          </div>
        ) : (
          <MessageList
            messages={messages}
            meUid={me.uid}
            other={other}
            onPreview={setPreview}
          />
        )}
        <div ref={endRef} />
      </div>
      <div className="composer-wrap">
        {failed && (
          <div className="send-failed">
            <span>Message not sent. Your text is still here.</span>
            <button onClick={sendText}>Retry</button>
          </div>
        )}
        <div className="composer">
          <input
            ref={picker}
            hidden
            type="file"
            accept="image/*"
            onChange={attach}
          />
          <button
            className="icon-button"
            onClick={() => picker.current?.click()}
            disabled={uploading || network !== 'online'}
            aria-label="Attach image"
          >
            {uploading ? <span className="spinner" /> : <Paperclip />}
          </button>
          <textarea
            value={draft}
            onChange={(e) => changed(e.target.value)}
            onKeyDown={onKeyDown}
            rows={1}
            placeholder={
              network === 'offline'
                ? 'Waiting for connection…'
                : 'Write a message'
            }
            aria-label="Message"
          />
          <button
            className="send-button"
            onClick={sendText}
            disabled={!draft.trim() || sending || network !== 'online'}
            aria-label="Send message"
          >
            {sending ? <span className="spinner dark" /> : <Send size={18} />}
          </button>
        </div>
      </div>
      {preview && (
        <dialog open className="lightbox" aria-label="Attachment preview">
          <button onClick={() => setPreview(null)} aria-label="Close preview">
            <X />
          </button>
          <img src={preview} alt="Shared attachment" />
        </dialog>
      )}
    </div>
  );
}

const MessageList = memo(function MessageList({
  messages,
  meUid,
  other,
  onPreview,
}: {
  messages: Message[];
  meUid: string;
  other: ChatUser;
  onPreview: (url: string) => void;
}) {
  return (
    <div className="messages">
      {messages.map((message, index) => {
        const day = new Date(message.time).toDateString();
        const showDay =
          index === 0 ||
          new Date(messages[index - 1].time).toDateString() !== day;
        const mine = message.sender === meUid;
        const previous = messages[index - 1];
        const grouped =
          previous &&
          previous.sender === message.sender &&
          message.time - previous.time < 5 * 60_000 &&
          new Date(previous.time).toDateString() === day;
        const read =
          mine &&
          Object.keys(message.seenBy || {}).some(
            (uid) => uid !== meUid && message.seenBy[uid],
          );
        return (
          <div key={message.id}>
            {showDay && (
              <div className="date-separator">
                <span>{formatDay(message.time)}</span>
              </div>
            )}
            <div
              className={`message-line ${mine ? 'mine' : 'theirs'} ${grouped ? 'grouped' : ''}`}
            >
              {!mine && !grouped && <Avatar user={other} size="sm" />}
              <div
                className={`bubble ${message.type === 'image' ? 'image-bubble' : ''}`}
              >
                {message.type === 'image' && message.imageURL ? (
                  <button
                    className="message-image"
                    onClick={() => onPreview(message.imageURL!)}
                  >
                    <img
                      src={message.imageURL}
                      loading="lazy"
                      decoding="async"
                      alt="Shared attachment"
                    />
                    <span>
                      <ImageIcon size={16} /> Open photo
                    </span>
                  </button>
                ) : (
                  <p>{message.text}</p>
                )}
                <span className="message-meta">
                  <time>{formatMessageTime(message.time)}</time>
                  {mine && (
                    <span
                      title={read ? 'Read' : 'Sent'}
                      className={read ? 'read' : ''}
                    >
                      <CheckCheck size={15} />
                    </span>
                  )}
                </span>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
});

function MessageSkeleton() {
  return (
    <div className="message-skeleton">
      <i />
      <i />
      <i />
      <i />
    </div>
  );
}
function EmptyConversation() {
  return (
    <div className="empty-conversation">
      <div className="empty-art">
        <MessageCircleMore />
      </div>
      <h2>Your conversations live here</h2>
      <p>Choose a message from the left, or search for someone new.</p>
      <div>
        <Bell size={16} /> Notifications are available from your profile
        settings.
      </div>
    </div>
  );
}
function LoadingScreen() {
  return (
    <main className="loading-screen">
      <div className="brand-mark">
        <MessageCircleMore />
      </div>
      <span className="spinner" />
      <p>Opening Relay…</p>
    </main>
  );
}
function ConfigMissing() {
  return (
    <main className="config-missing">
      <div className="brand-mark">
        <MessageCircleMore />
      </div>
      <h1>Relay needs Firebase configuration</h1>
      <p>
        Copy <code>.env.example</code> to <code>.env.local</code> and add the
        Firebase web app values.
      </p>
    </main>
  );
}
