export type MessageRole = 'user' | 'assistant';

export interface ChatMessage {
  role: MessageRole;
  content: string;
}

const sessions = new Map<string, ChatMessage[]>();

export function getHistory(userId: string): ChatMessage[] {
  return sessions.get(userId) ?? [];
}

export function appendHistory(userId: string, role: MessageRole, content: string): void {
  const history = sessions.get(userId) ?? [];
  history.push({ role, content });
  if (history.length > 20) {
    history.splice(0, history.length - 20);
  }
  sessions.set(userId, history);
}

export function isNewUser(userId: string): boolean {
  return !sessions.has(userId);
}

export function clearHistory(userId: string): void {
  sessions.delete(userId);
}
