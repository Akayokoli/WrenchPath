import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadEnvFile } from 'node:process';
import { readConfig } from '../src/config.js';
import { createChatService } from '../src/services/create-chat.js';
import { UNAVAILABLE_REPLY } from '../src/conversation/engine.js';

// Explicit opt-in: up to eight paid API requests (extraction plus reply) with synthetic worker messages only.
async function main() {
  if (existsSync('.env')) loadEnvFile('.env');
  const config = readConfig();
  if (config.provider === 'mock') throw new Error('Live check requires AI_PROVIDER=anthropic or openai in .env.');
  let failure = '';
  const onFailure = (diagnostic: string) => { failure = diagnostic; };
  const directory = await mkdtemp(join(tmpdir(), 'wrenchpath-live-'));
  try {
    let chat = createChatService({ ...config, memoryDir: directory }, onFailure);
    const turns = [
      { conversationId: 'live-a', senderId: 'synthetic-a', message: 'I have worked at a tire shop for two years doing tires and oil changes. I want to work on EVs. I have no electrical experience.' },
      { conversationId: 'live-a', senderId: 'synthetic-a', message: 'I can only study on weekends. What would be a useful first learning step?' },
      { conversationId: 'live-a', senderId: 'synthetic-a', message: 'Remind me what experience and study availability I told you about.' },
      { conversationId: 'live-b', senderId: 'synthetic-b', message: 'What experience and availability have I told you about?' },
    ];
    for (const [index, turn] of turns.entries()) {
      if (index === 2) chat = createChatService({ ...config, memoryDir: directory }, onFailure);
      const result = await chat(turn);
      if (result.reply === UNAVAILABLE_REPLY) throw new Error(`Live request failed. ${failure}`);
      console.log(`Worker ${turn.senderId}: ${turn.message}\nWrenchPath: ${result.reply}\n`);
    }
    console.log('Four live turns completed (up to eight model requests). Review: short replies, remembered tire/oil work and weekends, safe EV guidance, and no borrowed facts for worker B. This is not a Photon integration test.');
  } finally { await rm(directory, { recursive: true, force: true }); }
}
main().catch(error => {
  console.error(error instanceof Error ? error.message : 'Live check failed.');
  process.exitCode = 1;
});
