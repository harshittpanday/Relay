export type MessageType = 'text' | 'image';
export interface ChatUser {
  uid: string;
  email?: string;
  username: string;
  displayName: string;
  bio?: string;
  pfpURL?: string;
  online?: boolean;
  lastSeen?: number;
  createdAt?: number;
}
export interface ChatParticipant {
  [uid: string]: boolean;
}
export interface PresenceState {
  online: boolean;
  lastSeen?: number;
}
export interface TypingState {
  [uid: string]: boolean | number;
}
export interface ReadReceipt {
  [uid: string]: boolean;
}
export interface Message {
  id: string;
  sender: string;
  text: string;
  type: MessageType;
  imageURL?: string;
  time: number;
  seenBy: ReadReceipt;
}
export interface Chat {
  id: string;
  participants: ChatParticipant;
  messages?: Record<string, Omit<Message, 'id'>>;
  unread?: Record<string, number>;
  typing?: TypingState;
  lastMessage?: {
    id?: string;
    text: string;
    type: MessageType;
    sender: string;
    imageURL?: string;
    time: number;
  };
  updatedAt?: number;
}
export interface Conversation extends Chat {
  otherUser: ChatUser;
  latestMessage?: Message;
}
export interface NotificationState {
  enabled: boolean;
  permission: NotificationPermission | 'unsupported';
  availability: 'ready' | 'unsupported' | 'insecure';
}
export interface PendingMessage {
  id: string;
  chatId: string;
  text: string;
  status: 'sending' | 'failed';
}
