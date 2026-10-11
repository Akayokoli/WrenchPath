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
  const directory = await mkdtemp(join(tmpdir(), 'wrenchpath-roadmap-live-'));
  let diagnostic = '';
  try {
    const turns = [
      { conversationId: 'novice', senderId: 'worker-a', message: 'I do tires and oil changes at a tire shop. I want to be an EV technician. I have no electrical experience. I can study on weekends only and my budget is $100. Please give me a roadmap.' },
      { conversationId: 'experienced', senderId: 'worker-b', message: 'I am an experienced mechanic. I have experience with electrical fundamentals, voltage, resistance, and reading circuit diagrams. I perform diagnostics with scan tools, inspect vehicles, and write work orders. I have completed EV safety training. I want EV technician work. Please give me a roadmap.' },
      { conversationId: 'novice', senderId: 'worker-a', message: 'Actually I want to be a vehicle inspector instead. Please update my roadmap.' },
    ];
    for (const [index, turn] of turns.entries()) {
      const chat = createChatService({ ...config, memoryDir: directory }, value => { diagnostic = value; });
      const result = await chat(turn);
      if (result.reply === UNAVAILABLE_REPLY) throw new Error(`Live roadmap failed: ${diagnostic}`);
      const saved = await new JsonConversationStore(directory).load(hashId(turn.conversationId));
      const plan = saved?.roadmap;
      assert(plan, 'Roadmap must persist');
      assert(plan.milestones.every(m => m.status === 'not_started'));
      assert.equal(plan.qualificationStatus, 'not_verified');
      if (index === 0) {
        assert.equal(plan.targetRole, 'ev_service_technician');
        assert.equal(plan.milestones[0]?.skill, 'ev_safety');
        assert.equal(plan.milestones.find(m => m.skill === 'electrical')?.mode, 'learn');
        assert(plan.constraints.budget?.includes('100'));
        assert(plan.constraints.availability?.includes('weekend'));
      } else if (index === 1) {
        assert.equal(plan.milestones.find(m => m.skill === 'electrical')?.mode, 'review');
        assert.equal(plan.constraints.budget, null);
      } else {
        assert.equal(plan.targetRole, 'vehicle_inspector');
        assert(plan.constraints.availability?.includes('weekend'));
        assert(plan.milestones.every(m => m.skill !== 'ev_safety'));
      }
      console.log(JSON.stringify({ scenario: index + 1, reply: result.reply, target: plan.targetRole, constraints: plan.constraints,
        milestones: plan.milestones.map(m => ({ title: m.title, mode: m.mode, status: m.status })) }, null, 2));
    }
    console.log('Three live roadmap scenarios passed. Replies still require human review; Photon integration is not tested.');
  } finally { await rm(directory, { recursive: true, force: true }); }
}
main().catch(error => { console.error(error instanceof Error ? error.message : 'Live roadmap check failed.'); process.exitCode = 1; });
