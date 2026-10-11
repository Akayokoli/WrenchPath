import { afterEach, expect, test } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { buildApp } from '../src/app.js';
import { createAnthropicProvider } from '../src/providers/anthropic.js';
import { createConversationEngine, UNAVAILABLE_REPLY } from '../src/conversation/engine.js';
import { JsonConversationStore } from '../src/storage/json-store.js';
import { hashId } from '../src/storage/store.js';
import type { ProfileExtraction } from '../src/profiles/schema.js';

const cleanups: (() => Promise<unknown>)[] = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });
const novice = 'I do tires and oil changes. I want EV technician work. I have no electrical experience. I have no certifications. I study on weekends only.';
const mechanic = 'I repair brakes and inspect vehicles. I want reconditioning work.';
const changed = 'Actually I want vehicle inspector work.';
function extraction(message: string, messageIndex: number): ProfileExtraction {
  const evidence = (quote: string) => ({ quote, messageIndex });
  if (message === novice) return { facts: [
    { field: 'targetCareer', value: 'EV technician', evidence: evidence('I want EV technician work') },
    { field: 'certifications', value: 'no certifications', evidence: evidence('I have no certifications') },
    { field: 'availability', value: 'weekends only', evidence: evidence('I study on weekends only') },
  ], skills: [
    { id: 'tire_service', status: 'reported', evidence: evidence('I do tires and oil changes') },
    { id: 'oil_service', status: 'reported', evidence: evidence('I do tires and oil changes') },
    { id: 'electrical', status: 'no_experience', evidence: evidence('I have no electrical experience') },
  ] };
  if (message === mechanic) return { facts: [{ field: 'targetCareer', value: 'reconditioning', evidence: evidence('I want reconditioning work') }], skills: [
    { id: 'brakes', status: 'reported', evidence: evidence('I repair brakes') },
    { id: 'inspection', status: 'reported', evidence: evidence('inspect vehicles') },
  ] };
  if (message === changed) return { facts: [{ field: 'targetCareer', value: 'vehicle inspector', evidence: evidence(message) }], skills: [] };
  return { facts: [], skills: [] };
}
function envelope(content: unknown[], stop_reason = 'end_turn') {
  return new Response(JSON.stringify({ id: 'synthetic', type: 'message', role: 'assistant', content, stop_reason }), { headers: { 'content-type': 'application/json' } });
}
function json(value: unknown) { return envelope([{ type: 'text', text: JSON.stringify(value) }]); }
async function harness() {
  const directory = await mkdtemp(join(tmpdir(), 'wrenchpath-journeys-'));
  cleanups.push(() => rm(directory, { recursive: true, force: true }));
  const store = new JsonConversationStore(directory);
  let failure: 'extract' | 'after_update' | null = null;
  let arrivals = 0;
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  let concurrent = false;
  const histories: string[] = [];
  const fetchMock: typeof fetch = async (_url, init) => {
    const body = JSON.parse(String(init?.body));
    const history = body.messages;
    if (body.output_config.format.schema.properties.facts) {
      if (failure === 'extract') return new Response(JSON.stringify({ error: { type: 'api_error', message: 'private diagnostic' } }), { status: 503 });
      const input = JSON.parse(history[0].content);
      histories.push(JSON.stringify(input));
      if (concurrent && ++arrivals <= 2) { if (arrivals === 2) release(); await gate; }
      const latest = input.at(-1);
      return json(extraction(latest.text, latest.messageIndex));
    }
    const last = history.at(-1);
    if (Array.isArray(last.content)) {
      const result = JSON.parse(last.content[0].content);
      if (failure === 'after_update') return new Response('{}', { status: 503 });
      return json({ intent: 'next_step', reply: result.milestone?.title ?? 'Tell me your target role and experience.' });
    }
    if (last.content === 'I finished EV safety awareness.') return envelope([{ type: 'tool_use', id: 'update', name: 'update_learning_progress', input: {
      milestoneId: 'ev_service_technician:ev_safety', status: 'user_reported_complete', evidenceQuote: last.content,
    } }], 'tool_use');
    if (last.content === "What's my next step?") expect(body.tools.some((tool: { name: string }) => tool.name === 'update_learning_progress')).toBe(false);
    if (last.content === "What's my next step?") return envelope([{ type: 'tool_use', id: 'next', name: 'get_next_milestone', input: {} }], 'tool_use');
    return json({ intent: last.content === changed ? 'change_goal' : 'share_experience', reply: 'Let us review your experience and learning goals.' });
  };
  const create = () => {
    const provider = createAnthropicProvider({ apiKey: 'synthetic-key', model: 'test-model', timeoutMs: 1000, fetch: fetchMock });
    const app = buildApp({ chat: createConversationEngine(provider, new JsonConversationStore(directory)) });
    cleanups.push(() => app.close());
    return app;
  };
  let app = create();
  return {
    store, histories,
    setFailure(value: typeof failure) { failure = value; },
    enableConcurrency() { concurrent = true; },
    async restart() { await app.close(); app = create(); },
    async send(message: string, conversationId = 'worker-a', senderId = conversationId) {
      const response = await app.inject({ method: 'POST', url: '/api/chat', payload: { conversationId, senderId, message } });
      expect(response.statusCode).toBe(200);
      expect(Object.keys(response.json())).toEqual(['reply']);
      expect(response.json().reply.length).toBeLessThanOrEqual(700);
      return response.json().reply as string;
    },
    saved(id = 'worker-a') { return store.load(hashId(id)); },
  };
}

test('journey 1: entry-level tire worker receives ordered EV learning steps', async () => {
  const h = await harness(); await h.send(novice);
  const saved = (await h.saved())!;
  expect(saved.assessment?.transferableSkills).toEqual(['tire_service', 'oil_service']);
  expect(saved.roadmap?.milestones[0]?.skill).toBe('ev_safety');
  expect(saved.roadmap?.milestones[1]).toMatchObject({ skill: 'electrical', mode: 'learn' });
});
test('journey 2: experienced mechanic receives reconditioning review steps', async () => {
  const h = await harness(); await h.send(mechanic);
  const plan = (await h.saved())?.roadmap;
  expect(plan?.targetRole).toBe('reconditioning_technician');
  expect(plan?.milestones.find(m => m.skill === 'brakes')?.mode).toBe('review');
  expect(plan?.unknownSkills).toContain('detailing');
  expect(plan?.milestones.some(m => m.skill === 'ev_safety')).toBe(false);
});
test('journey 3: no certifications does not prevent a plan or award a qualification', async () => {
  const h = await harness(); await h.send(novice);
  const saved = await h.saved();
  expect(saved?.profile?.facts.find(f => f.field === 'certifications')?.value).toBe('no certifications');
  expect(saved?.roadmap?.qualificationStatus).toBe('not_verified');
  expect(saved?.roadmap?.milestones.every(m => m.status === 'not_started')).toBe(true);
});
test('journey 4: limited study time remains in the saved roadmap after a later turn', async () => {
  const h = await harness(); await h.send(novice); await h.send("What's my next step?");
  expect((await h.saved())?.roadmap?.constraints.availability).toBe('weekends only');
  expect((await h.saved())?.roadmap?.studyApproach).toContain('weekends only');
});
test('journey 5: changed goal replaces the plan while preserving unrelated facts', async () => {
  const h = await harness(); await h.send(novice); await h.send('I finished EV safety awareness.'); await h.send(changed);
  const saved = await h.saved();
  expect(saved?.roadmap?.targetRole).toBe('vehicle_inspector');
  expect(saved?.roadmap?.milestones.every(m => m.status === 'not_started')).toBe(true);
  expect(saved?.roadmap?.constraints.availability).toBe('weekends only');
});
test('journey 6: returning worker gets the next unfinished step after a disk-backed restart', async () => {
  const h = await harness(); await h.send(novice);
  expect(await h.send('I finished EV safety awareness.')).toContain('user-reported');
  await h.restart();
  expect(await h.send("What's my next step?")).toContain('Electrical fundamentals');
  expect((await h.saved())?.messages).toHaveLength(6);
  expect((await h.saved())?.roadmap?.milestones[0]?.report?.messageIndex).toBe(2);
});
test('journey 7: missing information produces no invented profile or roadmap', async () => {
  const h = await harness(); await h.send('Hello');
  expect(await h.send("What's my next step?")).toContain('target role and experience');
  expect((await h.saved())?.profile).toMatchObject({ facts: [], skills: [] });
  expect((await h.saved())?.roadmap).toBeNull();
});
test('journey 8: API failures before extraction and after a tool write preserve the last saved turn', async () => {
  const h = await harness(); await h.send(novice); const before = await h.saved();
  h.setFailure('extract'); expect(await h.send('Hello')).toBe(UNAVAILABLE_REPLY);
  expect(await h.saved()).toEqual(before);
  h.setFailure('after_update'); expect(await h.send('I finished EV safety awareness.')).toBe(UNAVAILABLE_REPLY);
  expect(await h.saved()).toEqual(before);
  h.setFailure(null); expect(await h.send("What's my next step?")).toContain('EV safety');
});
test('journey 9: overlapping workers remain isolated and sender mismatch cannot access memory', async () => {
  const h = await harness(); h.enableConcurrency();
  await Promise.all([h.send(novice, 'a'), h.send(mechanic, 'b')]);
  expect(h.histories).toHaveLength(2);
  expect(h.histories.every(history => !(history.includes(novice) && history.includes(mechanic)))).toBe(true);
  expect((await h.saved('a'))?.roadmap?.targetRole).toBe('ev_service_technician');
  expect((await h.saved('b'))?.roadmap?.targetRole).toBe('reconditioning_technician');
  expect((await h.saved('b'))?.roadmap?.constraints.availability).toBeNull();
  const before = await h.saved('a');
  expect(await h.send('What do you know about me?', 'a', 'b')).toContain('unavailable for this sender');
  expect(await h.saved('a')).toEqual(before);
});
