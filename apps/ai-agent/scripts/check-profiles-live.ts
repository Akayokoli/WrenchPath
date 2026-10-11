import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadEnvFile } from 'node:process';
import { readConfig } from '../src/config.js';
import { createChatService } from '../src/services/create-chat.js';
import { JsonConversationStore } from '../src/storage/json-store.js';
import { hashId } from '../src/storage/store.js';
import { UNAVAILABLE_REPLY } from '../src/conversation/engine.js';

async function main() {
  if (existsSync('.env')) loadEnvFile('.env');
  const config = readConfig();
  if (config.provider === 'mock') throw new Error('Select a live provider in .env.');
  const directory = await mkdtemp(join(tmpdir(), 'wrenchpath-profile-live-'));
  let diagnostic = '';
  try {
    const turns = [
      { conversationId: 'tire', senderId: 'worker-a', message: 'I have worked at a tire shop for two years doing tires and oil changes. I want EV technician work. I have no electrical experience and no certifications. I can study only on weekends and my training budget is $100.' },
      { conversationId: 'tire', senderId: 'worker-a', message: 'Actually, I want to become a vehicle inspector instead. I am studying electrical basics but have not done electrical work.' },
      { conversationId: 'mechanic', senderId: 'worker-b', message: 'I am a mechanic with eight years of experience. I inspect vehicles, repair brakes, use scan tools for diagnostics, and write work orders. I want a reconditioning technician role.' },
      { conversationId: 'empty', senderId: 'worker-c', message: 'Hello. What do you know about my experience?' },
    ];
    for (const [index, turn] of turns.entries()) {
      // Recreate service and store each turn to verify persistence, not just an in-memory cache.
      const chat = createChatService({ ...config, memoryDir: directory }, value => { diagnostic = value; });
      const result = await chat(turn);
      if (result.reply === UNAVAILABLE_REPLY) throw new Error(`Live profile request failed: ${diagnostic}`);
      const saved = await new JsonConversationStore(directory).load(hashId(turn.conversationId));
      assert(saved?.profile && saved.assessment, 'Profile and assessment must persist');
      assert.equal(saved.assessment.qualificationStatus, 'not_verified');
      if (index === 0) {
        assert.equal(saved.assessment.targetRole, 'ev_service_technician');
        assert(saved.assessment.transferableSkills.includes('tire_service'));
        assert(saved.assessment.transferableSkills.includes('oil_service'));
        assert(saved.assessment.skillGaps.includes('electrical'));
        assert(saved.profile.facts.some(f => f.field === 'certifications' && f.value?.includes('no')));
        assert(saved.profile.facts.some(f => f.field === 'availability' && f.value?.includes('weekend')));
        assert(saved.profile.facts.some(f => f.field === 'budget' && f.value?.includes('100')));
      } else if (index === 1) {
        assert.equal(saved.assessment.targetRole, 'vehicle_inspector');
        assert(!saved.assessment.existingSkills.includes('electrical'));
        assert(saved.profile.facts.some(f => f.field === 'availability' && f.value?.includes('weekend')));
      } else if (index === 2) {
        assert.equal(saved.assessment.targetRole, 'reconditioning_technician');
        assert(saved.assessment.transferableSkills.includes('brakes'));
        assert(saved.assessment.transferableSkills.includes('inspection'));
        assert(!saved.profile.facts.some(f => f.field === 'budget' || f.field === 'availability'));
      } else {
        assert.deepEqual(saved.profile.skills, []);
        assert.deepEqual(saved.profile.facts, []);
      }
      console.log(JSON.stringify({ scenario: index + 1, reply: result.reply, profile: saved.profile, assessment: saved.assessment }, null, 2));
    }
    console.log('Four live profile scenarios passed (eight model requests). Review replies for meaning and safety; this is not Photon integration.');
  } finally { await rm(directory, { recursive: true, force: true }); }
}
main().catch(error => {
  console.error(error instanceof Error ? error.message : 'Live profile check failed.');
  process.exitCode = 1;
});
