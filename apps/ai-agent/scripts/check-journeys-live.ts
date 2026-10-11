import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadEnvFile } from 'node:process';
import { buildApp } from '../src/app.js';
import { readConfig } from '../src/config.js';
import { createChatService } from '../src/services/create-chat.js';
import { JsonConversationStore } from '../src/storage/json-store.js';
import { hashId } from '../src/storage/store.js';
import { UNAVAILABLE_REPLY } from '../src/conversation/engine.js';

async function main() {
  if (existsSync('.env')) loadEnvFile('.env');
  const config = readConfig();
  if (config.provider === 'mock') throw new Error('Select a live provider in .env.');
  const directory = await mkdtemp(join(tmpdir(), 'wrenchpath-journeys-live-'));
  let diagnostic = '';
  const create = () => buildApp({ chat: createChatService({ ...config, memoryDir: directory }, value => { diagnostic = value; }) });
  let app = create();
  const store = new JsonConversationStore(directory);
  async function send(conversationId: string, message: string) {
    const response = await app.inject({ method: 'POST', url: '/api/chat', payload: { conversationId, senderId: conversationId, message } });
    assert.equal(response.statusCode, 200);
    const result = response.json();
    assert.deepEqual(Object.keys(result), ['reply']);
    assert(result.reply.length > 0 && result.reply.length <= 700);
    if (result.reply === UNAVAILABLE_REPLY) throw new Error(`Live journey failed: ${diagnostic}`);
    console.log(JSON.stringify({ worker: conversationId, message, reply: result.reply }));
    return result.reply as string;
  }
  const saved = (id: string) => store.load(hashId(id));
  try {
    // Concurrent requests use the same application and different owners.
    const concurrent = await Promise.allSettled([
      send('synthetic-tire', 'I do tires and oil changes at a tire shop. I want EV technician work. I have no electrical experience and no certifications. I can study only on weekends and my budget is $100. Please give me a roadmap.'),
      send('synthetic-mechanic', 'I am a mechanic with eight years of experience. I inspect vehicles, repair brakes, use scan tools for diagnostics, and write work orders. I want reconditioning technician work. Please give me a roadmap.'),
    ]);
    for (const result of concurrent) if (result.status === 'rejected') throw result.reason;
    const tire = await saved('synthetic-tire');
    const mechanic = await saved('synthetic-mechanic');
    assert.equal(tire?.roadmap?.targetRole, 'ev_service_technician');
    assert.equal(tire.roadmap.milestones[0]?.skill, 'ev_safety');
    assert.equal(tire.roadmap.milestones.find(m => m.skill === 'electrical')?.mode, 'learn');
    assert.match(tire.roadmap.constraints.availability ?? '', /weekend/i);
    assert.match(tire.roadmap.constraints.budget ?? '', /100/);
    assert.match(tire.profile?.facts.find(f => f.field === 'certifications')?.value ?? '', /no|none/i);
    assert.equal(mechanic?.roadmap?.targetRole, 'reconditioning_technician');
    assert.equal(mechanic.roadmap.milestones.find(m => m.skill === 'brakes')?.mode, 'review');
    assert.equal(mechanic.roadmap.constraints.availability, null);
    assert.equal(mechanic.roadmap.constraints.budget, null);
    await send('synthetic-tire', 'I finished EV safety awareness.');
    assert.equal((await saved('synthetic-tire'))?.roadmap?.milestones[0]?.status, 'user_reported_complete');
    await app.close(); app = create();
    assert.match(await send('synthetic-tire', "What's my next step?"), /electrical/i);
    await send('synthetic-tire', 'Actually I want vehicle inspector work instead. Please change my roadmap.');
    const changed = await saved('synthetic-tire');
    assert.equal(changed?.roadmap?.targetRole, 'vehicle_inspector');
    assert(changed.roadmap.milestones.every(m => m.status === 'not_started'));
    assert.match(changed.roadmap.constraints.availability ?? '', /weekend/i);
    await send('synthetic-empty', 'Hello. What do you know about my experience?');
    const empty = await saved('synthetic-empty');
    assert.deepEqual(empty?.profile?.facts, []);
    assert.deepEqual(empty?.profile?.skills, []);
    assert.equal(empty?.roadmap, null);
    for (const id of ['synthetic-tire', 'synthetic-mechanic']) assert.equal((await saved(id))?.roadmap?.qualificationStatus, 'not_verified');
    console.log('Six live HTTP-route turns passed, covering eight non-failure journey scenarios. API failures are tested deterministically in journeys.test.ts. This is not a Photon/iMessage or network-listener test.');
  } finally { await app.close(); await rm(directory, { recursive: true, force: true }); }
}
main().catch(error => { console.error(error instanceof Error ? error.message : 'Live journey check failed.'); process.exitCode = 1; });
