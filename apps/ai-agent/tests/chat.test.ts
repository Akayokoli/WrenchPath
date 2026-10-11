import { afterEach, expect, test, vi } from 'vitest';
import { buildApp } from '../src/app.js';

const valid = { conversationId: 'conversation-123', senderId: 'worker-123', message: 'I want to work on EVs.' };
const apps: ReturnType<typeof buildApp>[] = [];
function createApp(options: Parameters<typeof buildApp>[0] = {}) {
  const app = buildApp(options);
  apps.push(app);
  return app;
}
afterEach(async () => { await Promise.all(apps.splice(0).map((app) => app.close())); });

test('valid request returns only the agreed reply field', async () => {
  const response = await createApp().inject({ method: 'POST', url: '/api/chat', payload: valid });
  expect(response.statusCode).toBe(200);
  expect(response.json()).toEqual({ reply: expect.any(String) });
  expect(response.json().reply.length).toBeGreaterThan(0);
});

test.each([
  {}, { ...valid, conversationId: undefined }, { ...valid, senderId: 12 },
  { ...valid, message: '   ' }, { ...valid, message: null },
  { ...valid, message: 'a'.repeat(4001) }, { ...valid, conversationId: 'a'.repeat(201) },
  { ...valid, senderId: 'a'.repeat(201) }, { ...valid, unexpected: true }, [], null,
])('rejects invalid body %# before calling the service', async (payload) => {
  const chat = vi.fn(async () => ({ reply: 'should not run' }));
  const response = await createApp({ chat }).inject({
    method: 'POST', url: '/api/chat', headers: { 'content-type': 'application/json' }, payload: JSON.stringify(payload),
  });
  expect(response.statusCode).toBe(400);
  expect(response.json().error.code).toBe('VALIDATION_ERROR');
  expect(chat).not.toHaveBeenCalled();
});

test('passes validated, trimmed data to the service', async () => {
  const chat = vi.fn(async () => ({ reply: 'A useful next step.' }));
  const response = await createApp({ chat }).inject({ method: 'POST', url: '/api/chat', payload: { ...valid, message: ' hello ' } });
  expect(chat).toHaveBeenCalledWith({ ...valid, message: 'hello' });
  expect(response.json()).toEqual({ reply: 'A useful next step.' });
});

test('accepts field length boundaries', async () => {
  const response = await createApp().inject({ method: 'POST', url: '/api/chat', payload: {
    conversationId: 'c'.repeat(200), senderId: 's'.repeat(200), message: 'a'.repeat(4000),
  } });
  expect(response.statusCode).toBe(200);
});

test.each(['{broken', ''])('handles malformed or empty JSON', async (payload) => {
  const response = await createApp().inject({ method: 'POST', url: '/api/chat', headers: { 'content-type': 'application/json' }, payload });
  expect(response.statusCode).toBe(400);
  expect(response.json().error.code).toBe('BAD_REQUEST');
});

test.each(['text/plain', 'application/xml'])('rejects unsupported content type %s', async (contentType) => {
  const response = await createApp().inject({ method: 'POST', url: '/api/chat', headers: { 'content-type': contentType }, payload: 'hello' });
  expect(response.statusCode).toBe(415);
});

test('limits request body size', async () => {
  const response = await createApp().inject({ method: 'POST', url: '/api/chat', payload: { ...valid, message: 'x'.repeat(17000) } });
  expect(response.statusCode).toBe(413);
  expect(response.json().error.code).toBe('PAYLOAD_TOO_LARGE');
});

test('handles service failure without exposing exception details', async () => {
  const response = await createApp({ chat: async () => { throw new Error('private worker data'); } })
    .inject({ method: 'POST', url: '/api/chat', payload: valid });
  expect(response.statusCode).toBe(500);
  expect(response.json().error.code).toBe('INTERNAL_ERROR');
  expect(response.body).not.toContain('private worker data');
});

test('unknown endpoints return a consistent error', async () => {
  const response = await createApp().inject({ method: 'GET', url: '/missing' });
  expect(response.statusCode).toBe(404);
  expect(response.json().error.code).toBe('NOT_FOUND');
});
