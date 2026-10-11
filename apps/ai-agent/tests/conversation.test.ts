import { expect, test, vi } from 'vitest';
import { createConversationEngine, UNAVAILABLE_REPLY } from '../src/conversation/engine.js';
import { MemoryConversationStore, hashId } from '../src/storage/store.js';
import type { Message, TurnResult } from '../src/conversation/types.js';
import { buildApp } from '../src/app.js';

const request = { conversationId: 'a', senderId: 'worker-a', message: 'I have two years at a tire shop.' };
const answer: TurnResult = { intent: 'share_experience', reply: 'What career would you like to explore?' };

test('second turn receives the first exchange, including a changed goal', async () => {
  const respond = vi.fn(async (_messages: Message[]) => answer);
  const store = new MemoryConversationStore();
  const chat = createConversationEngine({ respond }, store);
  await chat(request);
  await chat({ ...request, message: 'Actually, I want to explore reconditioning instead of EVs.' });
  expect(respond.mock.calls[1]?.[0]).toEqual([
    { role: 'user', content: request.message }, { role: 'assistant', content: answer.reply },
    { role: 'user', content: 'Actually, I want to explore reconditioning instead of EVs.' },
  ]);
  expect((await store.load(hashId('a')))?.messages).toHaveLength(4);
});

test('different conversations and senders do not share context', async () => {
  const respond = vi.fn(async (_messages: Message[]) => answer);
  const chat = createConversationEngine({ respond }, new MemoryConversationStore());
  await chat(request);
  await chat({ conversationId: 'b', senderId: 'worker-b', message: 'I am a mechanic.' });
  expect(respond.mock.calls[1]?.[0]).toEqual([{ role: 'user', content: 'I am a mechanic.' }]);
  const mismatch = await chat({ ...request, senderId: 'worker-b' });
  expect(mismatch.reply).toContain('unavailable for this sender');
  expect(respond).toHaveBeenCalledTimes(2);
});

test('same-conversation concurrent messages are processed in arrival order', async () => {
  let release!: () => void;
  const barrier = new Promise<void>(resolve => { release = resolve; });
  const respond = vi.fn(async (_messages: Message[]) => { await barrier; return answer; });
  const store = new MemoryConversationStore();
  const chat = createConversationEngine({ respond }, store);
  const first = chat(request);
  const second = chat({ ...request, message: 'I study on weekends.' });
  await vi.waitFor(() => expect(respond).toHaveBeenCalledTimes(1));
  release();
  await Promise.all([first, second]);
  expect(respond.mock.calls[1]?.[0]).toHaveLength(3);
  expect((await store.load(hashId('a')))?.messages).toHaveLength(4);
});

test('a slow conversation does not block a different one', async () => {
  let release!: () => void;
  const barrier = new Promise<void>(resolve => { release = resolve; });
  const chat = createConversationEngine({ respond: async messages => {
    if (messages[0]?.content === request.message) await barrier;
    return answer;
  } }, new MemoryConversationStore());
  const slow = chat(request);
  try {
    expect(await chat({ ...request, conversationId: 'b', message: 'Hello' })).toEqual({ reply: answer.reply });
  } finally { release(); await slow; }
});

test('provider failure preserves history and the next request can succeed', async () => {
  const store = new MemoryConversationStore();
  const respond = vi.fn().mockResolvedValueOnce(answer).mockRejectedValueOnce(new Error('secret')).mockResolvedValueOnce(answer);
  const chat = createConversationEngine({ respond }, store);
  await chat(request);
  const before = await store.load(hashId('a'));
  expect(await chat({ ...request, message: 'Help' })).toEqual({ reply: UNAVAILABLE_REPLY });
  expect(await store.load(hashId('a'))).toEqual(before);
  await chat({ ...request, message: 'Try again' });
  expect((await store.load(hashId('a')))?.messages).toHaveLength(4);
});

test.each([{ intent: 'other', reply: '' }, { intent: 'other', reply: 'x'.repeat(701) }, { intent: 'unknown', reply: 'Hello' }])('invalid provider output is never persisted', async result => {
  const store = new MemoryConversationStore();
  const chat = createConversationEngine({ respond: vi.fn().mockResolvedValue(result) }, store);
  expect(await chat(request)).toEqual({ reply: UNAVAILABLE_REPLY });
  expect(await store.load(hashId('a'))).toBeUndefined();
});

test('storage failures return a safe reply', async () => {
  const chat = createConversationEngine({ respond: async () => answer }, {
    load: async () => undefined, save: async () => { throw new Error('disk full'); },
  });
  expect(await chat(request)).toEqual({ reply: UNAVAILABLE_REPLY });
});

test('memory limit retains existing facts instead of dropping old exchanges', async () => {
  const store = new MemoryConversationStore();
  const respond = vi.fn(async () => answer);
  const chat = createConversationEngine({ respond }, store);
  for (let i = 0; i < 50; i++) await chat(request);
  expect((await chat(request)).reply).toContain('memory limit');
  expect(respond).toHaveBeenCalledTimes(50);
  expect((await store.load(hashId('a')))?.messages).toHaveLength(100);
});

test('conversation engine keeps HTTP success and failure responses within the reply contract', async () => {
  const respond = vi.fn().mockResolvedValueOnce(answer).mockRejectedValueOnce(new Error('provider down'));
  const app = buildApp({ chat: createConversationEngine({ respond }, new MemoryConversationStore()) });
  try {
    for (const reply of [answer.reply, UNAVAILABLE_REPLY]) {
      const response = await app.inject({ method: 'POST', url: '/api/chat', payload: request });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ reply });
    }
  } finally { await app.close(); }
});
