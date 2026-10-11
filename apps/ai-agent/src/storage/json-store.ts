import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { conversationSchema, type Conversation } from '../conversation/types.js';
import type { ConversationStore } from './store.js';

// Single-process MVP. The engine serializes each conversation's load/generate/save transaction.
export class JsonConversationStore implements ConversationStore {
  private readonly directory: string;
  constructor(directory: string) { this.directory = resolve(directory); }
  private path(key: string) {
    if (!/^[a-f0-9]{64}$/.test(key)) throw new Error('Invalid storage key');
    return join(this.directory, `${key}.json`);
  }
  async load(key: string): Promise<Conversation | undefined> {
    try {
      return conversationSchema.parse(JSON.parse(await readFile(this.path(key), 'utf8')));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
      // Never replace corrupt or unreadable memory with an empty conversation.
      throw error;
    }
  }
  async save(key: string, value: Conversation): Promise<void> {
    const path = this.path(key);
    const data = JSON.stringify(conversationSchema.parse(value));
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    const temporary = `${path}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporary, data, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
      await rename(temporary, path);
    } finally {
      await unlink(temporary).catch((error: NodeJS.ErrnoException) => {
        if (error.code !== 'ENOENT') throw error;
      });
    }
  }
}
