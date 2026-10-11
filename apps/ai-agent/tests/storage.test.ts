import { mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, test } from 'vitest';
import { JsonConversationStore } from '../src/storage/json-store.js';
import { hashId } from '../src/storage/store.js';
import { createConversationEngine, UNAVAILABLE_REPLY } from '../src/conversation/engine.js';

const directories: string[] = [];
async function temporaryDirectory() {
  const directory = await mkdtemp(join(tmpdir(), 'wrenchpath-test-'));
  directories.push(directory);
  return directory;
}
afterEach(async () => { await Promise.all(directories.splice(0).map(p => rm(p, { recursive: true, force: true }))); });
const request = { conversationId: '../../escape', senderId: 'worker', message: 'I do tires.' };

test('history survives a new store and engine instance; filenames cannot traverse directories', async () => {
  const directory = await temporaryDirectory();
  const chat = createConversationEngine({ respond: async () => ({ intent: 'share_experience', reply: 'What is your goal?' }) }, new JsonConversationStore(directory));
  await chat(request);
  const files = await readdir(directory);
  expect(files).toEqual([`${hashId(request.conversationId)}.json`]);
  const saved = await new JsonConversationStore(directory).load(hashId(request.conversationId));
  expect(saved?.messages).toHaveLength(2);
  expect((await stat(join(directory, files[0]!))).mode & 0o777).toBe(0o600);
  const returning = createConversationEngine({ respond: async messages => {
    expect(messages[0]?.content).toBe('I do tires.');
    expect(messages).toHaveLength(3);
    return { intent: 'next_step', reply: 'Tell me your career goal.' };
  } }, new JsonConversationStore(directory));
  await returning({ ...request, message: 'What next?' });
  expect((await new JsonConversationStore(directory).load(hashId(request.conversationId)))?.messages).toHaveLength(4);
});

test('corrupt storage is preserved and does not reach the provider', async () => {
  const directory = await temporaryDirectory();
  const path = join(directory, `${hashId(request.conversationId)}.json`);
  await writeFile(path, '{broken');
  const chat = createConversationEngine({ respond: async () => { throw new Error('must not run'); } }, new JsonConversationStore(directory));
  expect(await chat(request)).toEqual({ reply: UNAVAILABLE_REPLY });
  expect(await readFile(path, 'utf8')).toBe('{broken');
});

test('store rejects nonhashed keys and invalid stored structures', async () => {
  const directory = await temporaryDirectory();
  const store = new JsonConversationStore(directory);
  await expect(store.load('../escape')).rejects.toThrow('Invalid storage key');
  await writeFile(join(directory, `${hashId('a')}.json`), '{}');
  await expect(store.load(hashId('a'))).rejects.toThrow();
});
