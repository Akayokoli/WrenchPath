import { expect, test } from 'vitest';
import { generateRoadmap, roadmapReadiness } from '../src/roadmaps/generate.js';
import type { WorkerProfile, SkillId } from '../src/profiles/schema.js';
import { conversationSchema } from '../src/conversation/types.js';
import { createConversationEngine, UNAVAILABLE_REPLY } from '../src/conversation/engine.js';
import { hashId, MemoryConversationStore } from '../src/storage/store.js';

function profile(goal = 'EV technician', skills: { id: SkillId; status: 'reported' | 'no_experience' | 'learning' | 'unknown' }[] = []): WorkerProfile {
  return { verification: 'user_reported_only', facts: [
    { field: 'targetCareer', value: goal, evidence: { messageIndex: 0, quote: goal } },
    { field: 'currentRole', value: 'tire worker', evidence: { messageIndex: 0, quote: 'tire worker' } },
  ], skills: skills.map(s => ({ ...s, evidence: { messageIndex: 0, quote: s.id } })) };
}

test('novice EV plan orders safety before electrical and diagnostics with actionable steps', () => {
  const roadmap = generateRoadmap(profile('EV technician', [{ id: 'tire_service', status: 'reported' }, { id: 'electrical', status: 'no_experience' }]))!;
  expect(roadmap.milestones.slice(0, 3).map(m => m.skill)).toEqual(['ev_safety', 'electrical', 'diagnostics']);
  expect(roadmap.milestones[1]?.mode).toBe('learn');
  expect(roadmap.milestones[0]?.mode).toBe('clarify');
  expect(roadmap.transferableSkills).toContain('tire_service');
  for (const [index, milestone] of roadmap.milestones.entries()) {
    expect(milestone.actions.length).toBeGreaterThan(0);
    expect(milestone.completionEvidence).toBeTruthy();
    expect(milestone.status).toBe('not_started');
    expect(milestone.dependsOn).toEqual(index ? [roadmap.milestones[index - 1]!.id] : []);
  }
});

test('experienced worker receives review steps but no automatic completion or qualification', () => {
  const novice = generateRoadmap(profile('EV technician', [{ id: 'electrical', status: 'no_experience' }]))!;
  const experienced = generateRoadmap(profile('EV technician', [{ id: 'electrical', status: 'reported' }, { id: 'diagnostics', status: 'reported' }, { id: 'ev_safety', status: 'reported' }]))!;
  expect(experienced.milestones[1]?.mode).toBe('review');
  expect(experienced.milestones[1]?.actions).not.toEqual(novice.milestones[1]?.actions);
  expect(experienced.milestones[0]?.skill).toBe('ev_safety');
  expect(experienced.milestones.every(m => m.status === 'not_started')).toBe(true);
  expect(experienced.qualificationStatus).toBe('not_verified');
});

test('budget, availability, and learning preference influence actions without invented prices or dates', () => {
  const worker = profile();
  for (const [field, value] of [['budget', '$0'], ['availability', 'weekends only'], ['learningPreference', 'videos']] as const) {
    worker.facts.push({ field, value, evidence: { messageIndex: 0, quote: value } });
  }
  const roadmap = generateRoadmap(worker)!;
  expect(roadmap.budgetApproach).toContain('$0');
  expect(roadmap.budgetApproach).toContain('before paying');
  expect(roadmap.studyApproach).toContain('weekends only');
  expect(roadmap.milestones[0]?.actions.join(' ')).toContain('videos');
  expect(roadmap.caveats.join(' ')).toContain('No completion timeline');
});

test('unknown constraints remain unknown, rather than assuming full-time study or unlimited budget', () => {
  const roadmap = generateRoadmap(profile())!;
  expect(roadmap.constraints).toEqual({ budget: null, availability: null, learningPreference: null });
  expect(roadmap.studyApproach).toContain('availability is not yet known');
  expect(roadmap.budgetApproach).toContain('Budget is not yet known');
});

test('learning does not become competence and unknowns do not become gaps', () => {
  const roadmap = generateRoadmap(profile('EV technician', [{ id: 'electrical', status: 'learning' }]))!;
  expect(roadmap.milestones[1]?.mode).toBe('continue_learning');
  expect(roadmap.skillGaps).toEqual([]);
  expect(roadmap.unknownSkills).toContain('diagnostics');
});

test.each(['vehicle inspector', 'reconditioning technician', 'automotive service technician'])('generates role-specific plan for %s', goal => {
  const roadmap = generateRoadmap(profile(goal))!;
  expect(roadmap.milestones[0]?.skill).toBe('inspection');
  expect(roadmap.credentialsToInvestigate).toEqual([]);
  expect(roadmap.milestones.some(m => m.skill === 'ev_safety')).toBe(false);
});

test('roadmap requires a supported target and some background', () => {
  expect(generateRoadmap({ verification: 'user_reported_only', facts: [], skills: [] })).toBeNull();
  const worker = profile(); worker.facts = worker.facts.filter(f => f.field === 'targetCareer');
  expect(roadmapReadiness(worker)).toEqual({ ready: false, missing: ['experience'] });
  expect(generateRoadmap(profile('airline pilot'))).toBeNull();
});

test('credentials are a fixed reference, never generated claims of eligibility or awards', () => {
  const roadmap = generateRoadmap(profile())!;
  expect(roadmap.credentialsToInvestigate).toHaveLength(1);
  expect(roadmap.credentialsToInvestigate[0]?.sourceUrl).toBe('https://ase.com/tests/x-ev/');
  expect(roadmap.credentialsToInvestigate[0]?.caution).toContain('does not award');
});

test('legacy conversation files load without a roadmap', () => {
  expect(conversationSchema.parse({ version: 1, ownerHash: hashId('a'), messages: [], lastIntent: null }).roadmap).toBeNull();
});

test('engine persists plan, replaces changed goal, and preserves prior state after a failed turn', async () => {
  const store = new MemoryConversationStore();
  let turn = 0;
  const chat = createConversationEngine({
    extractProfile: async () => ({ facts: [
      { field: 'targetCareer', value: turn === 0 ? 'EV technician' : 'vehicle inspector', evidence: { messageIndex: turn === 0 ? 0 : 2, quote: turn === 0 ? 'EV technician' : 'vehicle inspector' } },
      { field: 'currentRole', value: 'tire worker', evidence: { messageIndex: 0, quote: 'tire worker' } },
    ], skills: [] }),
    respond: async (_messages, context) => {
      if (turn === 2) throw new Error('provider failure');
      expect(context?.roadmap?.targetRole).toBe(turn === 0 ? 'ev_service_technician' : 'vehicle_inspector');
      return { intent: 'request_roadmap', reply: 'Here is your plan.' };
    },
  }, store);
  const request = { conversationId: 'plan', senderId: 'worker', message: 'I am a tire worker and want EV technician work.' };
  await chat(request);
  expect((await store.load(hashId('plan')))?.roadmap?.targetRole).toBe('ev_service_technician');
  turn = 1; await chat({ ...request, message: 'I want vehicle inspector work instead.' });
  const saved = await store.load(hashId('plan'));
  expect(saved?.roadmap?.targetRole).toBe('vehicle_inspector');
  turn = 2;
  expect(await chat({ ...request, message: 'Help' })).toEqual({ reply: UNAVAILABLE_REPLY });
  expect(await store.load(hashId('plan'))).toEqual(saved);
});
