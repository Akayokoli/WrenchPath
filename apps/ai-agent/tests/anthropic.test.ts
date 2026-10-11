import { expect, test, vi } from 'vitest';
import { createAnthropicProvider } from '../src/providers/anthropic.js';
import { createConversationEngine, UNAVAILABLE_REPLY } from '../src/conversation/engine.js';
import { MemoryConversationStore, hashId } from '../src/storage/store.js';

const turn = { intent: 'career_question', reply: 'Have you worked with electrical diagnostics?' };
const messages = [{ role: 'user' as const, content: 'I want to work on EVs.' }];
function envelope(text: string, stop_reason = 'end_turn') {
  return { id: 'msg_test', type: 'message', role: 'assistant', model: 'claude-sonnet-5-5',
    content: [{ type: 'text', text }], stop_reason, stop_sequence: null,
    usage: { input_tokens: 10, output_tokens: 10 } };
}
function response(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}
function provider(fetchMock: typeof fetch, model = 'claude-sonnet-5-5') {
  return createAnthropicProvider({ apiKey: 'test-anthropic-key', model, timeoutMs: 1000, fetch: fetchMock });
}

test('sends Claude system instructions, history, JSON schema, and the correct credential', async () => {
  const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(response(envelope(JSON.stringify(turn))));
  expect(await provider(fetchMock).respond(messages)).toEqual(turn);
  const [url, init] = fetchMock.mock.calls[0]!;
  expect(String(url)).toBe('https://api.anthropic.com/v1/messages');
  const headers = new Headers(init?.headers);
  expect(headers.get('x-api-key') ?? headers.get('authorization')?.replace('Bearer ', '')).toBe('test-anthropic-key');
  const body = JSON.parse(String(init?.body));
  expect(body).toMatchObject({ model: 'claude-sonnet-5-5', max_tokens: 1600, messages, thinking: { type: 'between_tools' },
    output_config: { format: { type: 'json_schema', schema: { required: ['intent', 'reply'], additionalProperties: false } } } });
  expect(body.system).toContain('Never provide procedures for hazardous high-voltage EV work');
  expect(body).not.toHaveProperty('store');
  expect(body).not.toHaveProperty('tools');
});

test('model override does not receive Sonnet 5.5-specific thinking settings', async () => {
  const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(response(envelope(JSON.stringify(turn))));
  await provider(fetchMock, 'claude-sonnet-4-6').respond(messages);
  expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).not.toHaveProperty('thinking');
});

test.each([
  envelope('not JSON'), envelope(JSON.stringify(turn), 'max_tokens'),
  envelope(JSON.stringify(turn), 'refusal'), envelope(JSON.stringify(turn), 'tool_use'),
  envelope(JSON.stringify({ ...turn, reply: '' })),
  envelope(JSON.stringify({ ...turn, reply: 'x'.repeat(701) })),
  envelope(JSON.stringify({ ...turn, intent: 'unknown' })),
  { ...envelope(''), content: [] },
])('rejects invalid or incomplete Claude output %#', async body => {
  await expect(provider(vi.fn<typeof fetch>().mockResolvedValue(response(body))).respond(messages)).rejects.toThrow();
});

test.each([401, 429, 500])('Claude failure %s does not retry', async status => {
  const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(response({ type: 'error', error: { type: 'api_error', message: 'Failure' } }, status));
  await expect(provider(fetchMock).respond(messages)).rejects.toThrow();
  expect(fetchMock).toHaveBeenCalledTimes(1);
});

test('timeout aborts a stalled Claude request', async () => {
  const fetchMock = vi.fn<typeof fetch>().mockImplementation(async (_url, init) => new Promise((_resolve, reject) => {
    init?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
  }));
  const client = createAnthropicProvider({ apiKey: 'test-key', model: 'claude-sonnet-5-5', timeoutMs: 30, fetch: fetchMock });
  await expect(client.respond(messages)).rejects.toThrow();
  expect(fetchMock).toHaveBeenCalledTimes(1);
});

test('Claude adapter integrates with history and does not persist a failed turn', async () => {
  const fetchMock = vi.fn<typeof fetch>()
    .mockResolvedValueOnce(response(envelope(JSON.stringify({ facts: [], skills: [] }))))
    .mockResolvedValueOnce(response(envelope(JSON.stringify(turn))))
    .mockResolvedValueOnce(response(envelope(JSON.stringify({ facts: [], skills: [] }))))
    .mockResolvedValueOnce(response(envelope(JSON.stringify(turn))))
    .mockResolvedValueOnce(response({ type: 'error', error: { type: 'api_error', message: 'Failure' } }, 500));
  const store = new MemoryConversationStore();
  const chat = createConversationEngine(provider(fetchMock), store);
  const request = { conversationId: 'demo', senderId: 'worker', message: 'I do tires.' };
  await chat(request);
  await chat({ ...request, message: 'I study on weekends.' });
  expect(JSON.parse(String(fetchMock.mock.calls[3]?.[1]?.body)).messages).toEqual([
    { role: 'user', content: 'I do tires.' }, { role: 'assistant', content: turn.reply },
    { role: 'user', content: 'I study on weekends.' },
  ]);
  const before = await store.load(hashId('demo'));
  expect(await chat(request)).toEqual({ reply: UNAVAILABLE_REPLY });
  expect(await store.load(hashId('demo'))).toEqual(before);
});
