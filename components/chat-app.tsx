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
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { createPortal } from 'react-dom';
import {
  ArrowLeft,
  Bell,
  CheckCheck,
  Image as ImageIcon,
  MessageCircleMore,
  MoreHorizontal,
  Paperclip,
  Pencil,
  Pin,
  Reply,
  SmilePlus,
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
import { emojiSize } from '@/lib/emoji';
import { placeMessageToolbar } from '@/lib/message-toolbar';
import { sortConversations } from '@/lib/conversation-sort';
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
  editMessage,
  markChatRead,
  MAX_MESSAGE_LENGTH,
  REACTIONS,
  replyReference,
  sendMessage,
  setChatPinned,
  subscribeConversations,
  subscribeMessages,
  subscribePins,
  subscribeTyping,
  toggleReaction,
} from '@/services/chats';
import type { ReactionEmoji } from '@/services/chats';
import { searchUsers, subscribeUser } from '@/services/users';
import { uploadImage } from '@/services/uploads';
import { getNotificationState, notifyIncoming } from '@/services/notifications';
import type {
  ChatUser,
  Conversation,
  Message,
  NotificationState,
} from '@/types/chat';

type ComposerMode =
  | { kind: 'normal' }
  | { kind: 'reply'; target: Message }
  | { kind: 'edit'; target: Message; previousDraft: string };
const EMPTY_PINS = new Set<string>();

const editableMessage = (message: Message, uid: string) =>
  message.sender === uid &&
  message.type === 'text' &&
  !message.imageURL &&
  Boolean(message.text.trim());
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
  const [pinState, setPinState] = useState<{
    uid: string;
    ids: Set<string>;
  } | null>(null);
  const pinnedIds =
    pinState && pinState.uid === authUser?.uid ? pinState.ids : EMPTY_PINS;
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

  useEffect(() => {
    const viewport = window.visualViewport;
    if (!viewport) return;
    let frame = 0;
    let previous = 0;
    const sync = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const height = Math.round(
          Math.min(window.innerHeight, viewport.height + viewport.offsetTop),
        );
        if (Math.abs(height - previous) < 2) return;
        previous = height;
        document.documentElement.style.setProperty(
          '--relay-viewport-height',
          `${height}px`,
        );
      });
    };
    sync();
    viewport.addEventListener('resize', sync);
    viewport.addEventListener('scroll', sync);
    window.addEventListener('resize', sync);
    window.addEventListener('orientationchange', sync);
    return () => {
      cancelAnimationFrame(frame);
      viewport.removeEventListener('resize', sync);
      viewport.removeEventListener('scroll', sync);
      window.removeEventListener('resize', sync);
      window.removeEventListener('orientationchange', sync);
      document.documentElement.style.removeProperty('--relay-viewport-height');
    };
  }, []);

  const sortedConversations = useMemo(
    () => sortConversations(conversations, pinnedIds),
    [conversations, pinnedIds],
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
    if (!authUser) {
      setPinState(null);
      return;
    }
    return subscribePins(
      authUser.uid,
      (ids) => setPinState({ uid: authUser.uid, ids }),
      (error) => {
        console.warn(
          `[Relay pins] subscribe /userPins/${authUser.uid} failed`,
          error,
        );
        if (!/permission.denied/i.test(error.message))
          toast(friendlyError(error), 'error');
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
  const togglePin = useCallback(
    async (chatId: string) => {
      if (!authUser) return;
      try {
        await setChatPinned(authUser.uid, chatId, !pinnedIds.has(chatId));
      } catch (error) {
        toast(friendlyError(error), 'error');
      }
    },
    [authUser, pinnedIds, toast],
  );
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
        pinnedIds={pinnedIds}
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
            pinned={pinnedIds.has(active.id)}
            onTogglePin={() => void togglePin(active.id)}
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
  pinnedIds,
  activeId,
  onSelect,
  onSettings,
  onNewChat,
}: {
  me: ChatUser;
  conversations: Conversation[];
  pinnedIds: Set<string>;
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
              pinned={pinnedIds.has(conversation.id)}
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
  pinned,
  active,
  onSelect,
}: {
  conversation: Conversation;
  meUid: string;
  pinned: boolean;
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
          {pinned && (
            <Pin
              className="pinned-icon"
              size={13}
              aria-label="Pinned conversation"
            />
          )}
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
  pinned,
  onTogglePin,
  network,
  onBack,
}: {
  conversation: Conversation;
  me: ChatUser;
  messages: Message[];
  loading: boolean;
  typing: boolean;
  pinned: boolean;
  onTogglePin: () => void;
  network: string;
  onBack: () => void;
}) {
  const other = conversation.otherUser;
  const status = other.online ? 'Online' : formatPresence(other.lastSeen);
  const toast = useToast();
  const [draft, setDraft] = useState('');
  const [mode, setMode] = useState<ComposerMode>({ kind: 'normal' });
  const draftRef = useRef(draft);
  const modeRef = useRef(mode);
  draftRef.current = draft;
  modeRef.current = mode;
  const [highlightedId, setHighlightedId] = useState<string>();
  const [sending, setSending] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [failed, setFailed] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);
  const [optionsOpen, setOptionsOpen] = useState(false);
  const optionsRef = useRef<HTMLDivElement>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(true);
  const picker = useRef<HTMLInputElement>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const messageNodes = useRef(new Map<string, HTMLDivElement>());
  const highlightTimer = useRef<number | null>(null);
  const typingTimer = useRef<number | null>(null);
  const typingActive = useRef(false);
  useEffect(() => {
    if (!optionsOpen) return;
    const close = (event: PointerEvent) => {
      if (!optionsRef.current?.contains(event.target as Node))
        setOptionsOpen(false);
    };
    const escape = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') setOptionsOpen(false);
    };
    document.addEventListener('pointerdown', close);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('pointerdown', close);
      document.removeEventListener('keydown', escape);
    };
  }, [optionsOpen]);
  useLayoutEffect(() => {
    if (!stickToBottom.current) return;
    const frame = requestAnimationFrame(() => {
      const scroller = scrollRef.current;
      if (scroller) scroller.scrollTop = scroller.scrollHeight;
      else endRef.current?.scrollIntoView({ block: 'end' });
    });
    return () => cancelAnimationFrame(frame);
  }, [messages.length, typing]);
  useEffect(() => {
    const scroller = scrollRef.current;
    if (!scroller) return;
    let frame = 0;
    const observer = new ResizeObserver(() => {
      if (!stickToBottom.current) return;
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        scroller.scrollTop = scroller.scrollHeight;
      });
    });
    observer.observe(scroller);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, []);
  useEffect(
    () => () => {
      if (typingTimer.current) clearTimeout(typingTimer.current);
      if (typingActive.current)
        setTyping(conversation.id, me.uid, false).catch(() => undefined);
      if (highlightTimer.current) clearTimeout(highlightTimer.current);
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
  const focusComposer = useCallback(() => {
    requestAnimationFrame(() => composerRef.current?.focus());
  }, []);
  const startReply = useCallback(
    (message: Message) => {
      const currentMode = modeRef.current;
      if (currentMode.kind === 'edit') setDraft(currentMode.previousDraft);
      setMode({ kind: 'reply', target: message });
      focusComposer();
    },
    [focusComposer],
  );
  const startEdit = useCallback(
    (message: Message) => {
      if (!editableMessage(message, me.uid)) return;
      const currentMode = modeRef.current;
      setMode({
        kind: 'edit',
        target: message,
        previousDraft:
          currentMode.kind === 'edit'
            ? currentMode.previousDraft
            : draftRef.current,
      });
      setDraft(message.text);
      focusComposer();
    },
    [focusComposer, me.uid],
  );
  function cancelMode() {
    if (mode.kind === 'edit') setDraft(mode.previousDraft);
    setMode({ kind: 'normal' });
    focusComposer();
  }
  const jumpToOriginal = useCallback(
    (id: string) => {
      const node = messageNodes.current.get(id);
      if (!node) {
        toast('Original message unavailable', 'error');
        return;
      }
      const reduced = window.matchMedia(
        '(prefers-reduced-motion: reduce)',
      ).matches;
      node.scrollIntoView({
        behavior: reduced ? 'auto' : 'smooth',
        block: 'center',
      });
      setHighlightedId(id);
      if (highlightTimer.current) clearTimeout(highlightTimer.current);
      highlightTimer.current = window.setTimeout(
        () => setHighlightedId(undefined),
        1800,
      );
    },
    [toast],
  );
  const registerMessage = useCallback(
    (id: string, node: HTMLDivElement | null) => {
      if (node) messageNodes.current.set(id, node);
      else messageNodes.current.delete(id);
    },
    [],
  );
  const reactToMessage = useCallback(
    async (message: Message, emoji: ReactionEmoji) => {
      try {
        await toggleReaction(conversation.id, message.id, me.uid, emoji);
      } catch (error) {
        toast(friendlyError(error), 'error');
      }
    },
    [conversation.id, me.uid, toast],
  );
  async function sendText() {
    const text = draft.trim();
    if (!text || sending || network !== 'online') return;
    if (text.length > MAX_MESSAGE_LENGTH) {
      toast(`Keep messages under ${MAX_MESSAGE_LENGTH} characters.`, 'error');
      return;
    }
    try {
      setSending(true);
      setFailed(false);
      if (mode.kind === 'edit') {
        await editMessage(conversation.id, mode.target, me.uid, text);
        setDraft(mode.previousDraft);
      } else {
        await sendMessage(conversation.id, me.uid, other.uid, {
          text,
          ...(mode.kind === 'reply'
            ? { replyTo: replyReference(mode.target) }
            : {}),
        });
        setDraft('');
      }
      setMode({ kind: 'normal' });
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
      await sendMessage(conversation.id, me.uid, other.uid, {
        imageURL,
        ...(mode.kind === 'reply'
          ? { replyTo: replyReference(mode.target) }
          : {}),
      });
      setMode({ kind: 'normal' });
    } catch (error) {
      toast(friendlyError(error), 'error');
    } finally {
      setUploading(false);
    }
  }
  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.nativeEvent.isComposing) return;
    if (event.key === 'Escape' && mode.kind !== 'normal') {
      event.preventDefault();
      cancelMode();
      return;
    }
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
          <span>{status}</span>
        </div>
        <div className="header-options" ref={optionsRef}>
          <button
            className="icon-button header-action"
            aria-label="Conversation options"
            aria-expanded={optionsOpen}
            onClick={() => setOptionsOpen((open) => !open)}
          >
            <MoreHorizontal />
          </button>
          {optionsOpen && (
            <div className="header-menu">
              <button
                type="button"
                aria-label={pinned ? 'Unpin conversation' : 'Pin conversation'}
                onClick={() => {
                  onTogglePin();
                  setOptionsOpen(false);
                }}
              >
                <Pin size={15} /> {pinned ? 'Unpin chat' : 'Pin chat'}
              </button>
            </div>
          )}
        </div>
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
            me={me}
            other={other}
            onPreview={setPreview}
            onReply={startReply}
            onEdit={startEdit}
            onReact={reactToMessage}
            onJump={jumpToOriginal}
            registerMessage={registerMessage}
            highlightedId={highlightedId}
          />
        )}
        {typing && !loading && (
          <output
            className="typing-line"
            aria-label={`${other.displayName} is typing`}
          >
            <Avatar user={other} size="sm" />
            <div className="typing-bubble" aria-hidden="true">
              <span />
              <span />
              <span />
            </div>
          </output>
        )}
        <div ref={endRef} />
      </div>
      <div className="composer-wrap">
        {mode.kind !== 'normal' && (
          <div className="composer-context">
            <div className="composer-context-icon">
              {mode.kind === 'reply' ? (
                <Reply size={17} />
              ) : (
                <Pencil size={17} />
              )}
            </div>
            <div>
              <strong>
                {mode.kind === 'reply'
                  ? `Replying to ${mode.target.sender === me.uid ? 'yourself' : other.displayName}`
                  : 'Editing message'}
              </strong>
              <span>
                {mode.target.type === 'image'
                  ? 'Photo'
                  : mode.target.text.slice(0, 120)}
              </span>
            </div>
            <button
              type="button"
              onClick={cancelMode}
              aria-label={
                mode.kind === 'reply' ? 'Cancel reply' : 'Cancel edit'
              }
            >
              <X size={17} />
            </button>
          </div>
        )}
        {failed && (
          <div className="send-failed">
            <span>
              {mode.kind === 'edit'
                ? 'Edit not saved. Your text is still here.'
                : 'Message not sent. Your text is still here.'}
            </span>
            <button onClick={sendText}>
              {mode.kind === 'edit' ? 'Try again' : 'Retry'}
            </button>
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
            disabled={uploading || mode.kind === 'edit' || network !== 'online'}
            aria-label="Attach image"
          >
            {uploading ? <span className="spinner" /> : <Paperclip />}
          </button>
          <textarea
            ref={composerRef}
            value={draft}
            onChange={(e) => changed(e.target.value)}
            onKeyDown={onKeyDown}
            rows={1}
            placeholder={
              network === 'offline'
                ? 'Waiting for connection…'
                : mode.kind === 'edit'
                  ? 'Edit message'
                  : 'Write a message'
            }
            aria-label={mode.kind === 'edit' ? 'Edit message' : 'Message'}
            maxLength={MAX_MESSAGE_LENGTH}
          />
          <button
            className="send-button"
            onClick={sendText}
            disabled={!draft.trim() || sending || network !== 'online'}
            aria-label={mode.kind === 'edit' ? 'Save edit' : 'Send message'}
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
  me,
  other,
  onPreview,
  onReply,
  onEdit,
  onReact,
  onJump,
  registerMessage,
  highlightedId,
}: {
  messages: Message[];
  meUid: string;
  me: ChatUser;
  other: ChatUser;
  onPreview: (url: string) => void;
  onReply: (message: Message) => void;
  onEdit: (message: Message) => void;
  onReact: (message: Message, emoji: ReactionEmoji) => Promise<void>;
  onJump: (id: string) => void;
  registerMessage: (id: string, node: HTMLDivElement | null) => void;
  highlightedId?: string;
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
            <MessageBubble
              message={message}
              mine={mine}
              grouped={Boolean(grouped)}
              read={read}
              me={me}
              other={other}
              highlighted={highlightedId === message.id}
              onPreview={onPreview}
              onReply={onReply}
              onEdit={onEdit}
              onReact={onReact}
              onJump={onJump}
              registerMessage={registerMessage}
            />
          </div>
        );
      })}
    </div>
  );
});

const MessageBubble = memo(function MessageBubble({
  message,
  mine,
  grouped,
  read,
  me,
  other,
  highlighted,
  onPreview,
  onReply,
  onEdit,
  onReact,
  onJump,
  registerMessage,
}: {
  message: Message;
  mine: boolean;
  grouped: boolean;
  read: boolean;
  me: ChatUser;
  other: ChatUser;
  highlighted: boolean;
  onPreview: (url: string) => void;
  onReply: (message: Message) => void;
  onEdit: (message: Message) => void;
  onReact: (message: Message, emoji: ReactionEmoji) => Promise<void>;
  onJump: (id: string) => void;
  registerMessage: (id: string, node: HTMLDivElement | null) => void;
}) {
  const canEdit = editableMessage(message, me.uid);
  const largeEmoji = useMemo(
    () => (message.type === 'text' ? emojiSize(message.text) : null),
    [message.text, message.type],
  );
  const [reactionOpen, setReactionOpen] = useState(false);
  const [longPressActions, setLongPressActions] = useState(false);
  const [pickerPosition, setPickerPosition] = useState({ top: 0, left: 0 });
  const [toolbarActive, setToolbarActive] = useState(false);
  const shellRef = useRef<HTMLDivElement>(null);
  const bubbleRef = useRef<HTMLDivElement>(null);
  const actionsRef = useRef<HTMLDivElement>(null);
  const pickerRef = useRef<HTMLFieldSetElement>(null);
  const reactionTrigger = useRef<HTMLButtonElement>(null);
  const longPressTimer = useRef<number | null>(null);
  const longPressed = useRef(false);
  const suppressContextMenu = useRef(false);
  const reactionBusy = useRef(false);
  const gesture = useRef<{
    pointerId: number;
    x: number;
    y: number;
    dx: number;
    mode: 'pending' | 'horizontal' | 'vertical';
  } | null>(null);
  const suppressClick = useRef(false);
  const positionToolbar = useCallback(() => {
    const bubble = bubbleRef.current;
    const shell = shellRef.current;
    const actions = actionsRef.current;
    const viewport = bubble?.closest('.message-scroll');
    if (!bubble || !shell || !actions || !viewport) return;
    const position = placeMessageToolbar(
      bubble.getBoundingClientRect(),
      shell.getBoundingClientRect(),
      viewport.getBoundingClientRect(),
      actions.offsetWidth,
      actions.offsetHeight,
    );
    actions.style.right = 'auto';
    actions.style.left = `${position.left}px`;
    actions.style.top = `${position.top}px`;
  }, []);
  useLayoutEffect(() => {
    if (!toolbarActive) return;
    const viewport = bubbleRef.current?.closest('.message-scroll');
    positionToolbar();
    viewport?.addEventListener('scroll', positionToolbar, { passive: true });
    window.addEventListener('resize', positionToolbar);
    window.visualViewport?.addEventListener('resize', positionToolbar);
    return () => {
      viewport?.removeEventListener('scroll', positionToolbar);
      window.removeEventListener('resize', positionToolbar);
      window.visualViewport?.removeEventListener('resize', positionToolbar);
    };
  }, [toolbarActive, positionToolbar]);
  useLayoutEffect(() => {
    if (!reactionOpen) return;
    const position = () => {
      const rect = shellRef.current?.getBoundingClientRect();
      if (!rect) return;
      const width = Math.min(292, window.innerWidth - 16);
      const pickerHeight = longPressActions ? 96 : 56;
      setPickerPosition({
        top:
          rect.top >= pickerHeight + 6
            ? rect.top - pickerHeight - 2
            : Math.min(window.innerHeight - pickerHeight - 8, rect.bottom + 8),
        left: Math.max(
          8,
          Math.min(
            mine ? rect.right - width : rect.left,
            window.innerWidth - width - 8,
          ),
        ),
      });
    };
    const closeOutside = (event: PointerEvent) => {
      const target = event.target as Node;
      if (
        !pickerRef.current?.contains(target) &&
        !shellRef.current?.contains(target)
      )
        setReactionOpen(false);
    };
    const escape = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') {
        setReactionOpen(false);
        reactionTrigger.current?.focus();
      }
    };
    position();
    requestAnimationFrame(() =>
      pickerRef.current?.querySelector('button')?.focus(),
    );
    window.addEventListener('resize', position);
    document.addEventListener('scroll', position, true);
    document.addEventListener('pointerdown', closeOutside);
    document.addEventListener('keydown', escape);
    return () => {
      window.removeEventListener('resize', position);
      document.removeEventListener('scroll', position, true);
      document.removeEventListener('pointerdown', closeOutside);
      document.removeEventListener('keydown', escape);
    };
  }, [reactionOpen, mine, longPressActions]);
  useEffect(
    () => () => {
      if (longPressTimer.current) clearTimeout(longPressTimer.current);
    },
    [],
  );
  function clearLongPress() {
    if (longPressTimer.current) clearTimeout(longPressTimer.current);
    longPressTimer.current = null;
  }
  async function react(emoji: ReactionEmoji) {
    if (reactionBusy.current) return;
    reactionBusy.current = true;
    setReactionOpen(false);
    try {
      await onReact(message, emoji);
    } finally {
      reactionBusy.current = false;
    }
  }
  const setNode = useCallback(
    (node: HTMLDivElement | null) => {
      registerMessage(message.id, node);
    },
    [message.id, registerMessage],
  );
  function resetGesture() {
    const bubble = bubbleRef.current;
    const shell = shellRef.current;
    bubble?.classList.remove('dragging');
    if (bubble) bubble.style.transform = '';
    shell?.removeAttribute('data-swipe');
    shell?.removeAttribute('data-armed');
    gesture.current = null;
  }
  function pointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if (
      event.pointerType !== 'touch' ||
      event.clientX < 24 ||
      event.clientX > window.innerWidth - 24 ||
      (event.target as Element).closest(
        '.message-actions, .reply-quote, .reaction-chips',
      ) ||
      window.getSelection()?.toString()
    )
      return;
    gesture.current = {
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      dx: 0,
      mode: 'pending',
    };
    longPressed.current = false;
    clearLongPress();
    longPressTimer.current = window.setTimeout(() => {
      if (gesture.current?.mode !== 'pending') return;
      longPressed.current = true;
      suppressContextMenu.current = true;
      gesture.current = null;
      suppressClick.current = true;
      setLongPressActions(true);
      setReactionOpen(true);
    }, 480);
  }
  function pointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    const active = gesture.current;
    if (!active || active.pointerId !== event.pointerId) return;
    const dx = event.clientX - active.x;
    const dy = event.clientY - active.y;
    if (Math.max(Math.abs(dx), Math.abs(dy)) > 9) clearLongPress();
    if (active.mode === 'pending' && Math.max(Math.abs(dx), Math.abs(dy)) > 9) {
      active.mode =
        Math.abs(dx) > Math.abs(dy) * 1.35 && (dx > 0 || canEdit)
          ? 'horizontal'
          : 'vertical';
      if (active.mode === 'horizontal') {
        event.currentTarget.setPointerCapture(event.pointerId);
        bubbleRef.current?.classList.add('dragging');
      }
    }
    if (active.mode !== 'horizontal') return;
    active.dx = dx;
    const direction = dx >= 0 ? 'reply' : 'edit';
    const shell = shellRef.current;
    if (shell) {
      shell.dataset.swipe = direction;
      shell.dataset.armed = String(Math.abs(dx) >= 58);
    }
    if (bubbleRef.current)
      bubbleRef.current.style.transform = `translateX(${Math.sign(dx) * Math.min(68, Math.abs(dx) * 0.58)}px)`;
  }
  function pointerEnd(
    event: ReactPointerEvent<HTMLDivElement>,
    cancelled = false,
  ) {
    clearLongPress();
    if (longPressed.current) {
      longPressed.current = false;
      window.setTimeout(() => {
        suppressClick.current = false;
        suppressContextMenu.current = false;
      }, 700);
      return;
    }
    const active = gesture.current;
    if (!active || active.pointerId !== event.pointerId) return;
    const action =
      !cancelled && active.mode === 'horizontal' && Math.abs(active.dx) >= 58
        ? active.dx > 0
          ? 'reply'
          : 'edit'
        : undefined;
    if (active.mode === 'horizontal') {
      suppressClick.current = true;
      window.setTimeout(() => {
        suppressClick.current = false;
      }, 100);
    }
    resetGesture();
    if (action === 'reply') onReply(message);
    if (action === 'edit' && canEdit) onEdit(message);
  }
  const reply = message.replyTo;
  const reactionChips = REACTIONS.filter(
    ({ emoji }) => Object.keys(message.reactions?.[emoji] || {}).length > 0,
  );
  const replySender =
    reply?.senderId === me.uid
      ? me.displayName
      : reply?.senderId === other.uid
        ? other.displayName
        : 'Unknown user';
  return (
    <div
      ref={setNode}
      className={`message-line ${mine ? 'mine' : 'theirs'} ${grouped ? 'grouped' : ''} ${highlighted ? 'message-highlight' : ''}`}
    >
      {!mine && !grouped && <Avatar user={other} size="sm" />}
      <div
        className={`message-swipe-shell ${message.type === 'image' ? 'image-shell' : ''}`}
        ref={shellRef}
        onMouseEnter={() => setToolbarActive(true)}
        onMouseLeave={() => {
          if (!shellRef.current?.contains(document.activeElement))
            setToolbarActive(false);
        }}
        onFocusCapture={() => setToolbarActive(true)}
        onBlurCapture={() => {
          requestAnimationFrame(() => {
            if (
              !shellRef.current?.contains(document.activeElement) &&
              !shellRef.current?.matches(':hover')
            )
              setToolbarActive(false);
          });
        }}
        onPointerDown={pointerDown}
        onPointerMove={pointerMove}
        onPointerUp={pointerEnd}
        onPointerCancel={(event) => pointerEnd(event, true)}
        onContextMenu={(event) => {
          if (suppressContextMenu.current || reactionOpen)
            event.preventDefault();
        }}
        onClickCapture={(event) => {
          if (suppressClick.current) {
            event.preventDefault();
            event.stopPropagation();
          }
        }}
      >
        <span className="swipe-indicator" aria-hidden="true">
          <Reply size={17} className="swipe-reply-icon" />
          <Pencil size={17} className="swipe-edit-icon" />
        </span>
        <div
          ref={bubbleRef}
          className={`bubble swipe-bubble ${message.type === 'image' ? 'image-bubble' : ''} ${largeEmoji ? `emoji-message emoji-${largeEmoji}` : ''}`}
        >
          <div
            ref={actionsRef}
            className="message-actions"
            aria-label="Message actions"
          >
            <button
              type="button"
              onClick={() => onReply(message)}
              aria-label="Reply to message"
              title="Reply"
            >
              <Reply size={15} />
            </button>
            {canEdit && (
              <button
                type="button"
                onClick={() => onEdit(message)}
                aria-label="Edit message"
                title="Edit"
              >
                <Pencil size={15} />
              </button>
            )}
            <button
              type="button"
              ref={reactionTrigger}
              onClick={() => {
                setLongPressActions(false);
                setReactionOpen((open) => !open);
              }}
              aria-label="React to message"
              aria-expanded={reactionOpen}
              title="React"
            >
              <SmilePlus size={15} />
            </button>
          </div>
          {reply && (
            <button
              type="button"
              className="reply-quote"
              onClick={() => onJump(reply.messageId)}
              aria-label={`Jump to message from ${replySender}`}
            >
              <strong>{replySender}</strong>
              <span>
                {reply.type === 'image' ? 'Photo' : reply.text || 'Message'}
              </span>
            </button>
          )}
          {message.type === 'image' && message.imageURL ? (
            <button
              className="message-image"
              onClick={() => onPreview(message.imageURL!)}
              aria-label="Open shared photo"
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
            {message.editedAt && <span className="edited-label">· Edited</span>}
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
        {reactionChips.length > 0 && (
          <div className="reaction-chips" aria-label="Message reactions">
            {reactionChips.map(({ emoji, label }) => {
              const users = message.reactions?.[emoji] || {};
              const count = Object.keys(users).length;
              return (
                <button
                  type="button"
                  key={emoji}
                  className={users[me.uid] ? 'selected' : ''}
                  aria-label={`${label}, ${count} ${count === 1 ? 'reaction' : 'reactions'}; ${users[me.uid] ? 'remove yours' : 'add yours'}`}
                  aria-pressed={Boolean(users[me.uid])}
                  onClick={() => void react(emoji)}
                >
                  <span>{emoji}</span>
                  {count > 1 && <small>{count}</small>}
                </button>
              );
            })}
          </div>
        )}
      </div>
      {reactionOpen &&
        createPortal(
          <fieldset
            ref={pickerRef}
            className="reaction-picker"
            style={{ top: pickerPosition.top, left: pickerPosition.left }}
            aria-label="Choose a reaction"
          >
            <div className="reaction-picker-choices">
              {REACTIONS.map(({ emoji, label }) => (
                <button
                  type="button"
                  key={emoji}
                  aria-label={`React with ${label}`}
                  onClick={() => void react(emoji)}
                >
                  {emoji}
                </button>
              ))}
            </div>
            {longPressActions && (
              <div className="reaction-picker-actions">
                <button
                  type="button"
                  onClick={() => {
                    setReactionOpen(false);
                    onReply(message);
                  }}
                >
                  <Reply size={15} /> Reply
                </button>
                {canEdit && (
                  <button
                    type="button"
                    onClick={() => {
                      setReactionOpen(false);
                      onEdit(message);
                    }}
                  >
                    <Pencil size={15} /> Edit
                  </button>
                )}
              </div>
            )}
          </fieldset>,
          document.body,
        )}
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
