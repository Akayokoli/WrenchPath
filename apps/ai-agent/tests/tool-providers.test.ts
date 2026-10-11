import { expect, test, vi } from 'vitest';
import { createAnthropicProvider } from '../src/providers/anthropic.js';
import { createOpenAIProvider } from '../src/providers/openai.js';
const messages = [{ role: 'user' as const, content: 'What is next?' }];
const turn = { intent: 'next_step', reply: 'Learn electrical fundamentals.' };
function body(provider: string, id?: string, name = 'get_next_milestone') {
  return provider === 'claude'
    ? { id: 'msg', type: 'message', role: 'assistant', stop_reason: id ? 'tool_use' : 'end_turn', content: id
      ? [{ type: 'thinking', thinking: 'Check saved progress', signature: 'signature' }, { type: 'tool_use', id, name, input: {} }]
      : [{ type: 'text', text: JSON.stringify(turn) }] }
    : { id: 'resp', object: 'response', status: 'completed', output: id
      ? [{ type: 'function_call', id: `fc_${id}`, call_id: id, name, arguments: '{}' }]
      : [{ type: 'message', id: 'msg', status: 'completed', role: 'assistant', content: [{ type: 'output_text', text: JSON.stringify(turn), annotations: [] }] }] };
}
function setup(kind: string, ids: (string | undefined)[], names: string[] = []) {
  let index = 0;
  const fetchMock = vi.fn<typeof fetch>().mockImplementation(async () => new Response(JSON.stringify(body(kind, ids[index], names[index++])), { headers: { 'content-type': 'application/json' } }));
  const provider = (kind === 'claude' ? createAnthropicProvider : createOpenAIProvider)({ apiKey: 'fake-key', model: 'test-model', timeoutMs: 1000, fetch: fetchMock });
  const execute = vi.fn().mockReturnValue({ ok: true, milestone: { title: 'Electrical fundamentals' } });
  return { provider, fetchMock, execute };
}
for (const kind of ['claude', 'openai']) {
  test(`${kind} sends native tools and returns their results before the final reply`, async () => {
    const { provider, fetchMock, execute } = setup(kind, ['one', undefined]);
    expect(await provider.respond(messages, undefined, { execute })).toEqual(turn);
    expect(execute).toHaveBeenCalledExactlyOnceWith('get_next_milestone', {});
    const first = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    const second = JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body));
    expect(first.tools).toHaveLength(5);
    expect(second.tools.some((tool: { name: string }) => tool.name === 'get_next_milestone')).toBe(false);
    expect(JSON.stringify(second)).toContain('Electrical fundamentals');
    if (kind === 'claude') expect(second.messages[1].content[0]).toMatchObject({ type: 'thinking', signature: 'signature' });
    else expect(second.input.at(-1)).toMatchObject({ type: 'function_call_output', call_id: 'one' });
  });
  test(`${kind} rejects repeated call ids without executing twice`, async () => {
    const { provider, execute } = setup(kind, ['one', 'one']);
    await expect(provider.respond(messages, undefined, { execute })).rejects.toThrow('Duplicate tool call');
    expect(execute).toHaveBeenCalledTimes(1);
  });
  test(`${kind} rejects repeated lookup calls with new ids`, async () => {
    const { provider, fetchMock } = setup(kind, ['one', 'two', 'three', 'four', 'five', 'six', 'seven']);
    await expect(provider.respond(messages, undefined, { execute: () => ({ ok: true }) })).rejects.toThrow('Duplicate tool call');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
}

for (const kind of ['claude', 'openai']) {
  test(`${kind} permits a refreshed next step after an update`, async () => {
    const { provider, execute } = setup(kind, ['one', 'two', 'three', undefined], ['get_next_milestone', 'update_learning_progress', 'get_next_milestone']);
    expect(await provider.respond(messages, undefined, { execute })).toEqual(turn);
    expect(execute).toHaveBeenCalledTimes(3);
  });
}

for (const kind of ['claude', 'openai']) {
  test(`${kind} hides progress updates while a new goal is being established`, async () => {
    const { provider, execute, fetchMock } = setup(kind, [undefined]);
    await provider.respond(messages, undefined, { execute, canUpdateProgress: false });
    const request = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    expect(request.tools.some((tool: { name: string }) => tool.name === 'update_learning_progress')).toBe(false);
  });
}
