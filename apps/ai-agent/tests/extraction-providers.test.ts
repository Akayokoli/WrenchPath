import { expect, test, vi } from 'vitest';
import { createAnthropicProvider } from '../src/providers/anthropic.js';
import { createOpenAIProvider } from '../src/providers/openai.js';

const extraction = { facts: [{ field: 'availability', value: 'weekends', evidence: { messageIndex: 2, quote: 'weekends' } }], skills: [] };
const messages = [{ role: 'user' as const, content: 'Hello' }, { role: 'assistant' as const, content: 'When can you study?' }, { role: 'user' as const, content: 'weekends' }];
for (const name of ['anthropic', 'openai'] as const) {
  test(`${name} extraction sends only indexed user evidence and parses the same schema`, async () => {
    const text = JSON.stringify(extraction);
    const output = name === 'anthropic' ? { stop_reason: 'end_turn', content: [{ type: 'text', text }] }
      : { id: 'resp_test', object: 'response', status: 'completed', output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text, annotations: [] }] }] };
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify(output), { headers: { 'content-type': 'application/json' } }));
    const create = name === 'anthropic' ? createAnthropicProvider : createOpenAIProvider;
    const provider = create({ apiKey: 'test', model: name === 'anthropic' ? 'claude-sonnet-5-5' : 'test', timeoutMs: 1000, fetch: fetchMock });
    expect(await provider.extractProfile!(messages)).toEqual(extraction);
    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    const input = (body.messages ?? body.input)[0].content;
    expect(JSON.parse(input)).toEqual([{ messageIndex: 0, text: 'Hello' }, { messageIndex: 2, text: 'weekends' }]);
    expect(JSON.stringify(body)).not.toContain('When can you study?');
  });
}
