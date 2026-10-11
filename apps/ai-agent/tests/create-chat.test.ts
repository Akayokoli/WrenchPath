import { expect, test, vi } from 'vitest';
import { readConfig } from '../src/config.js';
import { createChatService } from '../src/services/create-chat.js';
import { createAnthropicProvider } from '../src/providers/anthropic.js';
import { createOpenAIProvider } from '../src/providers/openai.js';
vi.mock('../src/providers/anthropic.js', () => ({ createAnthropicProvider: vi.fn(() => ({ respond: vi.fn() })) }));
vi.mock('../src/providers/openai.js', () => ({ createOpenAIProvider: vi.fn(() => ({ respond: vi.fn() })) }));

test.each(['anthropic', 'openai'] as const)('factory selects %s with only its own credential', provider => {
  vi.clearAllMocks();
  createChatService(readConfig({ AI_PROVIDER: provider, ANTHROPIC_API_KEY: 'claude-test', OPENAI_API_KEY: 'openai-test' }));
  const selected = provider === 'anthropic' ? createAnthropicProvider : createOpenAIProvider;
  const other = provider === 'anthropic' ? createOpenAIProvider : createAnthropicProvider;
  expect(selected).toHaveBeenCalledWith(expect.objectContaining({ apiKey: provider === 'anthropic' ? 'claude-test' : 'openai-test' }));
  expect(other).not.toHaveBeenCalled();
});

test('mock mode does not construct a paid provider', async () => {
  vi.clearAllMocks();
  const chat = createChatService(readConfig({}));
  expect((await chat({ conversationId: 'a', senderId: 'b', message: 'hello' })).reply).toContain('Welcome');
  expect(createAnthropicProvider).not.toHaveBeenCalled();
  expect(createOpenAIProvider).not.toHaveBeenCalled();
});
