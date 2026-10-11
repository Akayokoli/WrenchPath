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
import { generateRoadmap } from '../src/roadmaps/generate.js';
import type { WorkerProfile } from '../src/profiles/schema.js';

async function main() {
  if (existsSync('.env')) loadEnvFile('.env');
  const config = readConfig();
  if (config.provider === 'mock') throw new Error('Select a live provider in .env.');
  const directory = await mkdtemp(join(tmpdir(), 'wrenchpath-progress-live-'));
  let diagnostic = '';
  try {
    const store = new JsonConversationStore(directory);
    const key = hashId('synthetic-progress');
    const profile: WorkerProfile = { verification: 'user_reported_only', facts: [
      { field: 'targetCareer', value: 'EV technician', evidence: { messageIndex: 0, quote: 'EV technician' } },
      { field: 'currentRole', value: 'tire worker', evidence: { messageIndex: 0, quote: 'tire worker' } },
    ], skills: [] };
    await store.save(key, { version: 1, ownerHash: hashId('synthetic-worker'), profile, assessment: null, roadmap: generateRoadmap(profile), lastIntent: 'request_roadmap', messages: [
      { role: 'user', content: 'I am a tire worker. I want to be an EV technician.' },
      { role: 'assistant', content: 'Start with EV safety awareness, then electrical fundamentals.' },
    ] });
    for (const [index, message] of ['I finished EV safety awareness.', "What's my next step?", 'Done.', 'Actually I want to be a vehicle inspector instead.'].entries()) {
      // Recreate the service each turn to verify disk-backed progress survives a restart.
      const chat = createChatService({ ...config, memoryDir: directory }, value => { diagnostic = value; });
      const result = await chat({ conversationId: 'synthetic-progress', senderId: 'synthetic-worker', message });
      if (result.reply === UNAVAILABLE_REPLY) throw new Error(`Live progress failed: ${diagnostic}`);
      const plan = (await store.load(key))?.roadmap;
      assert(plan, 'Roadmap must persist');
      assert.equal(plan.qualificationStatus, 'not_verified');
      if (index < 3) {
        assert.equal(plan.milestones[0]?.status, 'user_reported_complete');
        assert.equal(plan.milestones[1]?.status, 'not_started');
        if (index === 1) assert.match(result.reply, /electrical/i);
      } else {
        assert.equal(plan.targetRole, 'vehicle_inspector');
        assert.match(result.reply, /inspect/i, 'Goal-change reply should acknowledge the new inspection path');
        assert(plan.milestones.every(m => m.status === 'not_started'));
      }
      console.log(JSON.stringify({ scenario: index + 1, message, reply: result.reply, progress: plan.milestones.map(m => ({ skill: m.skill, status: m.status })) }, null, 2));
    }
    console.log('Four live progress scenarios passed. Synthetic data removed afterward. Photon/iMessage integration is not tested.');
  } finally { await rm(directory, { recursive: true, force: true }); }
}
main().catch(error => { console.error(error instanceof Error ? error.message : 'Live progress check failed.'); process.exitCode = 1; });
