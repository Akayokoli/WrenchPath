import { expect, test } from 'vitest';
import { describeFailure } from '../src/providers/diagnostics.js';
import { createConversationEngine, UNAVAILABLE_REPLY } from '../src/conversation/engine.js';
import { MemoryConversationStore } from '../src/storage/store.js';

test.each([
  [{ status: 401 }, 'HTTP 401'], [{ status: 403 }, 'HTTP 403'], [{ status: 404 }, 'HTTP 404'],
  [{ status: 400, message: 'credit balance too low' }, 'BILLING'], [{ status: 400 }, 'HTTP 400'],
  [{ status: 429 }, 'HTTP 429'], [{ status: 500 }, 'PROVIDER_UNAVAILABLE'],
  [{ name: 'APIConnectionTimeoutError' }, 'TIMEOUT'], [{ name: 'APIConnectionError' }, 'CONNECTION'],
  [{ name: 'ZodError' }, 'INVALID_OUTPUT'], [{ code: 'ENOSPC' }, 'STORAGE'],
])('classifies failure %# without revealing raw details', (error, expected) => {
  const result = describeFailure({ ...error, message: `${'message' in error ? error.message : ''} private-secret` });
  expect(result).toContain(expected);
  expect(result).not.toContain('private-secret');
});

test('unknown errors never reveal raw messages', () => {
  expect(describeFailure(new Error('private-secret'))).not.toContain('private-secret');
  expect(describeFailure(null)).toContain('INCOMPLETE_RESPONSE');
});

test('diagnostic callback receives safe information and cannot break the reply', async () => {
  const chat = createConversationEngine({ respond: async () => { throw { status: 401, message: 'secret' }; } }, new MemoryConversationStore(), diagnostic => {
    expect(diagnostic).toContain('HTTP 401');
    expect(diagnostic).not.toContain('secret');
    throw new Error('observer failed');
  });
  expect(await chat({ conversationId: 'a', senderId: 'b', message: 'hello' })).toEqual({ reply: UNAVAILABLE_REPLY });
});


test('recognizes SDK subclasses whose name remains Error', () => {
  class APIConnectionError extends Error {}
  class APIConnectionTimeoutError extends Error {}
  expect(describeFailure(new APIConnectionError('private'))).toContain('CONNECTION');
  expect(describeFailure(new APIConnectionTimeoutError('private'))).toContain('TIMEOUT');
});
