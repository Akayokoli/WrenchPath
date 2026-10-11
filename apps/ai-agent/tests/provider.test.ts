import { expect, test, vi } from 'vitest';
import { createOpenAIProvider } from '../src/providers/openai.js';

function envelope(text: string, status = 'completed') {
  return { id: 'resp_test', object: 'response', status, output: [{
    type: 'message', id: 'msg_test', status: 'completed', role: 'assistant',
    content: [{ type: 'output_text', text, annotations: [] }],
  }] };
}
const turn = { intent: 'career_question', reply: 'Have you worked with electrical diagnostics?' };
const messages = [{ role: 'user' as const, content: 'I want to work on EVs.' }];

test('adapter sends bounded history and instructions, disables response storage, and parses output', async () => {
  const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify(envelope(JSON.stringify(turn))), { headers: { 'content-type': 'application/json' } }));
  const provider = createOpenAIProvider({ apiKey: 'test-key', model: 'test-model', timeoutMs: 1000, fetch: fetchMock });
  expect(await provider.respond(messages)).toEqual(turn);
  const [url, init] = fetchMock.mock.calls[0]!;
  expect(String(url)).toBe('https://api.openai.com/v1/responses');
  const body = JSON.parse(String(init?.body));
  expect(body).toMatchObject({ model: 'test-model', store: false, input: messages, max_output_tokens: 1600 });
  expect(body.instructions).toContain('Never provide procedures for hazardous high-voltage EV work');
  expect(body.text.format.strict).toBe(true);
  expect(body).not.toHaveProperty('previous_response_id');
});

test.each([
  envelope('not json'), envelope(JSON.stringify(turn), 'incomplete'),
  envelope(JSON.stringify({ ...turn, reply: 'x'.repeat(701) })),
  { status: 'completed', output: [{ type: 'message', role: 'assistant', content: [{ type: 'refusal', refusal: 'No' }] }] },
])('rejects malformed, incomplete, overlong, or refused responses %#', async response => {
  const provider = createOpenAIProvider({ apiKey: 'test-key', model: 'test-model', timeoutMs: 1000,
    fetch: vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify(response), { headers: { 'content-type': 'application/json' } })),
  });
  await expect(provider.respond(messages)).rejects.toThrow();
});

test.each([401, 429, 500])('provider HTTP failure %s does not retry automatically', async status => {
  const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ error: { message: 'Provider failure' } }), { status, headers: { 'content-type': 'application/json' } }));
  const provider = createOpenAIProvider({ apiKey: 'test-key', model: 'test-model', timeoutMs: 1000, fetch: fetchMock });
  await expect(provider.respond(messages)).rejects.toThrow();
  expect(fetchMock).toHaveBeenCalledTimes(1);
});

test('timeout aborts a stalled provider request', async () => {
  const fetchMock = vi.fn<typeof fetch>().mockImplementation(async (_url, init) => new Promise((_resolve, reject) => {
    init?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
  }));
  const provider = createOpenAIProvider({ apiKey: 'test-key', model: 'test-model', timeoutMs: 30, fetch: fetchMock });
  await expect(provider.respond(messages)).rejects.toThrow();
  expect(fetchMock).toHaveBeenCalledTimes(1);
});
