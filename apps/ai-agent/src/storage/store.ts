import { createHash } from 'node:crypto';
import type { Conversation } from '../conversation/types.js';

export function hashId(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}
export interface ConversationStore {
  load(key: string): Promise<Conversation | undefined>;
  save(key: string, value: Conversation): Promise<void>;
}

export class MemoryConversationStore implements ConversationStore {
  private readonly values = new Map<string, Conversation>();
  async load(key: string) {
    const value = this.values.get(key);
    return value ? structuredClone(value) : undefined;
  }
  async save(key: string, value: Conversation) {
    this.values.set(key, structuredClone(value));
  }
}
