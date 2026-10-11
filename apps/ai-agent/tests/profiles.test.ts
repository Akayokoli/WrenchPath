import { expect, test } from 'vitest';
import { updateProfile, extractionInput } from '../src/profiles/extract.js';
import { assessSkills } from '../src/skills/assess.js';
import { conversationSchema, type Message } from '../src/conversation/types.js';
import { createConversationEngine, UNAVAILABLE_REPLY } from '../src/conversation/engine.js';
import { hashId, MemoryConversationStore } from '../src/storage/store.js';
import type { ProfileExtraction } from '../src/profiles/schema.js';

const statement = 'I do tires and oil changes. I have no electrical experience. I want to work on EVs. I study on weekends. I have no certifications.';
const messages: Message[] = [{ role: 'user', content: statement }];
const evidence = (quote: string, messageIndex = 0) => ({ quote, messageIndex });
const extraction: ProfileExtraction = {
  facts: [
    { field: 'targetCareer', value: 'work on EVs', evidence: evidence('I want to work on EVs') },
    { field: 'availability', value: 'weekends', evidence: evidence('I study on weekends') },
    { field: 'certifications', value: 'no certifications', evidence: evidence('I have no certifications') },
  ],
  skills: [
    { id: 'tire_service', status: 'reported', evidence: evidence('I do tires and oil changes') },
    { id: 'oil_service', status: 'reported', evidence: evidence('I do tires and oil changes') },
    { id: 'electrical', status: 'no_experience', evidence: evidence('I have no electrical experience') },
  ],
};

test('entry-level worker has transferable skills, explicit gaps, unknowns, and unverified credentials', () => {
  const profile = updateProfile(null, extraction, messages);
  const assessment = assessSkills(profile);
  expect(profile.verification).toBe('user_reported_only');
  expect(profile.facts.find(f => f.field === 'certifications')?.value).toBe('no certifications');
  expect(assessment.targetRole).toBe('ev_service_technician');
  expect(assessment.transferableSkills).toEqual(['tire_service', 'oil_service']);
  expect(assessment.skillGaps).toEqual(['electrical']);
  expect(assessment.unknownSkills).toContain('ev_safety');
  expect(assessment.unknownSkills).toContain('diagnostics');
  expect(assessment.qualificationStatus).toBe('not_verified');
  expect(assessment.prerequisites.join(' ')).toContain('supervised');
});

test('job title and years alone establish no technical skills', () => {
  const history: Message[] = [{ role: 'user', content: 'I am a mechanic with ten years of experience.' }];
  const profile = updateProfile(null, { facts: [
    { field: 'currentRole', value: 'mechanic', evidence: evidence(history[0]!.content) },
    { field: 'yearsExperience', value: 'ten years', evidence: evidence(history[0]!.content) },
  ], skills: [] }, history);
  expect(assessSkills(profile).existingSkills).toEqual([]);
  expect(() => updateProfile(null, { facts: [], skills: [{ id: 'electrical', status: 'reported', evidence: evidence(history[0]!.content) }] }, history)).toThrow();
});

test('experienced mechanic seeking reconditioning gets a different assessment', () => {
  const history: Message[] = [{ role: 'user', content: 'I want reconditioning work. I inspect cars, write reports, and repair brakes.' }];
  const profile = updateProfile(null, { facts: [{ field: 'targetCareer', value: 'reconditioning', evidence: evidence(history[0]!.content) }], skills: [
    { id: 'inspection', status: 'reported', evidence: evidence('I inspect cars') },
    { id: 'documentation', status: 'reported', evidence: evidence('write reports') },
    { id: 'brakes', status: 'reported', evidence: evidence('repair brakes') },
  ] }, history);
  const assessment = assessSkills(profile);
  expect(assessment.transferableSkills).toEqual(['inspection', 'documentation', 'brakes']);
  expect(assessment.unknownSkills).toContain('detailing');
  expect(assessment.skillGaps).toEqual([]);
});

test('corrections replace the target and skill claim while retaining unrelated availability', () => {
  const previous = updateProfile(null, extraction, messages);
  const history: Message[] = [...messages, { role: 'assistant', content: 'Thanks.' }, { role: 'user', content: 'Actually I want vehicle inspector work. I am learning electrical basics.' }];
  const next = updateProfile(previous, { facts: [{ field: 'targetCareer', value: 'vehicle inspector', evidence: evidence('Actually I want vehicle inspector work', 2) }], skills: [{ id: 'electrical', status: 'learning', evidence: evidence('I am learning electrical basics', 2) }] }, history);
  expect(assessSkills(next).targetRole).toBe('vehicle_inspector');
  expect(next.facts.find(f => f.field === 'availability')?.value).toBe('weekends');
  expect(next.skills.find(s => s.id === 'electrical')?.status).toBe('learning');
  const old = updateProfile(next, extraction, history);
  expect(assessSkills(old).targetRole).toBe('vehicle_inspector');
});

test('explicit fact retraction clears its value', () => {
  const history: Message[] = [{ role: 'user', content: 'Forget my budget.' }];
  const profile = updateProfile(null, { facts: [{ field: 'budget', value: null, evidence: evidence('Forget my budget.') }], skills: [] }, history);
  expect(profile.facts[0]?.value).toBeNull();
});

test.each([
  { field: 'education', value: 'college', evidence: evidence('I finished college') },
  { field: 'yearsExperience', value: '10', evidence: evidence('I do tires') },
  { field: 'education', value: 'college', evidence: evidence('college', 1) },
])('rejects fabricated values and assistant-sourced evidence %#', fact => {
  expect(() => updateProfile(null, { facts: [fact], skills: [] }, [...messages, { role: 'assistant', content: 'college' }])).toThrow();
});

test('extraction input excludes assistant messages but retains original indices', () => {
  expect(JSON.parse(extractionInput([...messages, { role: 'assistant', content: 'Invented certification' }, { role: 'user', content: 'Hello' }])))
    .toEqual([{ messageIndex: 0, text: statement }, { messageIndex: 2, text: 'Hello' }]);
});

test('old conversation files get empty additive profile fields', () => {
  expect(conversationSchema.parse({ version: 1, ownerHash: hashId('owner'), messages: [], lastIntent: null }))
    .toMatchObject({ profile: null, assessment: null });
});

test('engine computes assessment before reply and atomically preserves state on extraction failure', async () => {
  const store = new MemoryConversationStore();
  let fail = false;
  const chat = createConversationEngine({
    extractProfile: async () => { if (fail) throw new Error('bad extraction'); return extraction; },
    respond: async (_messages, context) => {
      expect(context?.assessment.skillGaps).toEqual(['electrical']);
      return { intent: 'share_experience', reply: 'Your tire work is a starting point. Electrical fundamentals are a learning gap you reported.' };
    },
  }, store);
  const request = { conversationId: 'a', senderId: 'b', message: statement };
  await chat(request);
  const before = await store.load(hashId('a'));
  expect(before?.profile?.facts).toHaveLength(3);
  fail = true;
  expect(await chat(request)).toEqual({ reply: UNAVAILABLE_REPLY });
  expect(await store.load(hashId('a'))).toEqual(before);
});

test.each(['I have no electrical experience', 'I want to learn electrical work', 'I am studying electrical basics'])('negation or aspiration is not reported competence: %s', quote => {
  expect(() => updateProfile(null, { facts: [], skills: [{ id: 'electrical', status: 'reported', evidence: evidence(quote) }] }, [{ role: 'user', content: quote }])).toThrow();
});
