import { expect, test } from 'vitest';
import { createToolRuntime } from '../src/tools/runtime.js';
import { generateRoadmap } from '../src/roadmaps/generate.js';
import { getNextMilestone, reconcileRoadmap } from '../src/roadmaps/progress.js';
import type { WorkerProfile } from '../src/profiles/schema.js';
import { createConversationEngine, UNAVAILABLE_REPLY } from '../src/conversation/engine.js';
import { MemoryConversationStore, hashId } from '../src/storage/store.js';
import { skillsPassportSnapshot } from '../src/tools/passport.js';

const profile: WorkerProfile = { verification: 'user_reported_only', facts: [
  { field: 'targetCareer', value: 'EV technician', evidence: { messageIndex: 0, quote: 'EV technician' } },
  { field: 'currentRole', value: 'tire worker', evidence: { messageIndex: 0, quote: 'tire worker' } },
], skills: [] };
function state() { return { profile: structuredClone(profile), roadmap: generateRoadmap(profile) }; }
const id = 'ev_service_technician:ev_safety';
const update = (quote: string, status = 'user_reported_complete', milestoneId = id) => ({ milestoneId, status, evidenceQuote: quote });

test('completion advances next milestone and remains unverified', () => {
  const value = state();
  const quote = 'I finished EV safety awareness.';
  const tools = createToolRuntime(value, quote, 2, false);
  expect(tools.execute('update_learning_progress', update(quote))).toMatchObject({ ok: true, qualificationStatus: 'not_verified' });
  expect(tools.execute('get_next_milestone', {})).toMatchObject({ milestone: { skill: 'electrical' } });
  expect(value.roadmap?.milestones[0]?.report).toEqual({ quote, messageIndex: 2 });
  expect(tools.progressReply()).toContain('user-reported');
  expect(value.roadmap?.qualificationStatus).toBe('not_verified');
});

test.each(['done', 'I will finish EV safety awareness.', 'I have not finished EV safety awareness.', 'If I finished EV safety awareness, what next?', 'My friend finished EV safety awareness.', 'I heard my friend finished EV safety awareness.'])('ambiguous, hypothetical, negative, or third-person report must not advance: %s', quote => {
  const value = state(); const tools = createToolRuntime(value, quote, 2, false);
  expect(tools.execute('update_learning_progress', update(quote))).toMatchObject({ ok: false });
  expect(getNextMilestone(value.roadmap).milestone?.skill).toBe('ev_safety');
});

test('rejects fabricated evidence, foreign milestone, changed-goal update, and cross-user arguments', () => {
  const quote = 'I finished EV safety awareness.';
  for (const [args, changed] of [[update('I completed EV safety awareness.'), false], [update(quote, 'user_reported_complete', 'another:ev_safety'), false], [update(quote), true], [{ ...update(quote), conversationId: 'other' }, false]] as const) {
    expect(createToolRuntime(state(), quote, 2, changed).execute('update_learning_progress', args)).toMatchObject({ ok: false });
  }
  expect(createToolRuntime(state(), quote, 2, false).execute('get_worker_profile', { conversationId: 'other' })).toMatchObject({ ok: false });
});

test('in-progress and reopening retain the correct next step', () => {
  const value = state();
  const begin = 'I started EV safety awareness.';
  expect(createToolRuntime(value, begin, 2, false).execute('update_learning_progress', update(begin, 'in_progress'))).toMatchObject({ ok: true });
  expect(value.roadmap?.status).toBe('in_progress');
  const finish = 'I finished EV safety awareness.';
  createToolRuntime(value, finish, 4, false).execute('update_learning_progress', update(finish));
  const reset = 'Please reopen my EV safety awareness milestone.';
  expect(createToolRuntime(value, reset, 6, false).execute('update_learning_progress', update(reset, 'not_started'))).toMatchObject({ ok: true });
  expect(getNextMilestone(value.roadmap).milestone?.skill).toBe('ev_safety');
});

test('out-of-order completion cannot skip an unfinished prerequisite', () => {
  const value = state(); const quote = 'I finished electrical fundamentals.';
  createToolRuntime(value, quote, 2, false).execute('update_learning_progress', update(quote, 'user_reported_complete', 'ev_service_technician:electrical'));
  expect(getNextMilestone(value.roadmap).milestone?.skill).toBe('ev_safety');
});

test('stable milestones retain progress after regeneration; changed goals start fresh', () => {
  const value = state(); const quote = 'I finished EV safety awareness.';
  const tools = createToolRuntime(value, quote, 2, false);
  tools.execute('update_learning_progress', update(quote));
  tools.execute('generate_roadmap', {});
  expect(value.roadmap?.milestones[0]?.status).toBe('user_reported_complete');
  const changed = structuredClone(profile); changed.facts[0]!.value = 'vehicle inspector';
  const plan = reconcileRoadmap(value.roadmap, generateRoadmap(changed));
  expect(plan?.milestones.every(m => m.status === 'not_started')).toBe(true);
  const revised = generateRoadmap(profile)!; revised.milestones[0]!.completionEvidence = 'New objective';
  expect(reconcileRoadmap(value.roadmap, revised)?.milestones[0]?.status).toBe('not_started');
});

test('one update per turn and completion of all steps still do not verify credentials', () => {
  const value = state(); const quote = 'I finished EV safety awareness.';
  const tools = createToolRuntime(value, quote, 2, false);
  tools.execute('update_learning_progress', update(quote));
  expect(tools.execute('update_learning_progress', update(quote))).toMatchObject({ ok: false });
  for (const milestone of value.roadmap!.milestones) milestone.status = 'user_reported_complete';
  tools.execute('generate_roadmap', {});
  expect(tools.execute('get_next_milestone', {})).toMatchObject({ milestone: null, reason: 'all_steps_user_reported_complete', qualificationStatus: 'not_verified' });
});

test('missing roadmap and unknown tools return controlled results', () => {
  const tools = createToolRuntime({ profile: null, roadmap: null }, 'hello', 0, false);
  expect(tools.execute('get_next_milestone', {})).toMatchObject({ reason: 'roadmap_missing' });
  expect(tools.execute('generate_roadmap', {})).toMatchObject({ readiness: { ready: false } });
  expect(tools.execute('delete_worker', {})).toMatchObject({ ok: false, error: 'unknown_tool' });
});

test('engine persists progress across instances and rolls back on provider failure', async () => {
  const store = new MemoryConversationStore();
  const key = hashId('a');
  await store.save(key, { version: 1, ownerHash: hashId('b'), messages: [], lastIntent: null, profile, assessment: null, roadmap: generateRoadmap(profile) });
  const request = { conversationId: 'a', senderId: 'b', message: 'I finished EV safety awareness.' };
  const chat = createConversationEngine({ respond: async (_messages, _context, tools) => {
    tools!.execute('update_learning_progress', update(request.message));
    return { intent: 'report_progress', reply: 'You are officially certified!' };
  } }, store);
  expect((await chat(request)).reply).not.toContain('officially certified');
  expect((await store.load(key))?.roadmap?.milestones[0]?.status).toBe('user_reported_complete');
  const returning = createConversationEngine({ respond: async (_messages, _context, tools) => {
    expect(tools!.execute('get_next_milestone', {})).toMatchObject({ milestone: { skill: 'electrical' } });
    return { intent: 'next_step', reply: 'Electrical fundamentals is next.' };
  } }, store);
  await returning({ ...request, message: 'What is next?' });
  const before = await store.load(key);
  const failing = createConversationEngine({ respond: async (_messages, _context, tools) => {
    tools!.execute('update_learning_progress', update('I finished electrical fundamentals.', 'user_reported_complete', 'ev_service_technician:electrical'));
    throw new Error('Provider failed after update');
  } }, store);
  expect(await failing({ ...request, message: 'I finished electrical fundamentals.' })).toEqual({ reply: UNAVAILABLE_REPLY });
  expect(await store.load(key)).toEqual(before);
});

test('Skills Passport snapshot is detached and explicitly user-reported', () => {
  const snapshot = skillsPassportSnapshot(profile, generateRoadmap(profile));
  snapshot.profile!.facts[0]!.value = 'changed';
  expect(profile.facts[0]?.value).toBe('EV technician');
  expect(snapshot.verification).toBe('user_reported_only');
});

test('background experience cannot complete a newly generated roadmap', async () => {
  const store = new MemoryConversationStore();
  const key = hashId('new-plan');
  await store.save(key, { version: 1, ownerHash: hashId('worker'), messages: [], lastIntent: null, profile, assessment: null, roadmap: null });
  const quote = 'I finished EV safety awareness.';
  const chat = createConversationEngine({ respond: async (_messages, _context, tools) => {
    expect(tools!.execute('update_learning_progress', update(quote))).toMatchObject({ ok: false });
    return { intent: 'report_progress', reply: 'Please confirm on your new roadmap.' };
  } }, store);
  await chat({ conversationId: 'new-plan', senderId: 'worker', message: quote });
  expect((await store.load(key))?.roadmap?.milestones.every(m => m.status === 'not_started')).toBe(true);
});


test('progress writes are exposed only for explicit reports in the latest message', () => {
  for (const message of ["What's my next step?", 'Done.', 'My friend finished EV safety awareness.']) {
    expect(createToolRuntime(state(), message, 4, false).canUpdateProgress).toBe(false);
  }
  expect(createToolRuntime(state(), 'I finished EV safety awareness.', 4, false).canUpdateProgress).toBe(true);
});
