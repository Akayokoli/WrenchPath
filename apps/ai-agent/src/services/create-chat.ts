import type { readConfig } from '../config.js';
import { createConversationEngine } from '../conversation/engine.js';
import { createOpenAIProvider } from '../providers/openai.js';
import { JsonConversationStore } from '../storage/json-store.js';
import { createAnthropicProvider } from '../providers/anthropic.js';
import { mockChat } from './mock-chat.js';

export function createChatService(config: ReturnType<typeof readConfig>, onFailure?: (diagnostic: string) => void) {
  if (config.provider === 'mock') return mockChat;
  if (!config.apiKey) {
    throw new Error(`Invalid environment configuration: ${config.provider === 'anthropic' ? 'ANTHROPIC_API_KEY' : 'OPENAI_API_KEY'}`);
  }
  const createProvider = config.provider === 'anthropic' ? createAnthropicProvider : createOpenAIProvider;
  return createConversationEngine(
    createProvider({ apiKey: config.apiKey, model: config.model, timeoutMs: config.timeoutMs }),
    new JsonConversationStore(config.memoryDir),
    onFailure,
  );
}
