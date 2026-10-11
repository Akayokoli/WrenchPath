import { expect, test } from 'vitest';
import { readConfig } from '../src/config.js';

test('defaults to local port 4000', () => {
  expect(readConfig({})).toMatchObject({ host: '127.0.0.1', port: 4000 });
});

test('accepts environment overrides', () => {
  expect(readConfig({ PORT: '4100', HOST: 'localhost' })).toMatchObject({ host: 'localhost', port: 4100 });
});

test.each(['', '0', '-1', '65536', '4000abc', '1.5'])('rejects invalid port %j', (PORT) => {
  expect(() => readConfig({ PORT })).toThrow('Invalid environment configuration: PORT');
});

test('rejects blank host', () => {
  expect(() => readConfig({ HOST: ' ' })).toThrow('Invalid environment configuration: HOST');
});

test('mock mode works without credentials', () => {
  expect(readConfig({}).provider).toBe('mock');
});

test('OpenAI mode requires a key without leaking values', () => {
  expect(() => readConfig({ AI_PROVIDER: 'openai' })).toThrow('OPENAI_API_KEY');
  expect(readConfig({ AI_PROVIDER: 'openai', OPENAI_API_KEY: 'test-key' }).provider).toBe('openai');
  expect(() => readConfig({ AI_PROVIDER: 'unknown' })).toThrow('AI_PROVIDER');
});

test.each(['0', '999', '120001', 'abc'])('rejects invalid provider timeout %s', (AI_TIMEOUT_MS) => {
  expect(() => readConfig({ AI_TIMEOUT_MS })).toThrow('AI_TIMEOUT_MS');
});

test('Claude uses its own key and provider-specific default model', () => {
  const config = readConfig({ AI_PROVIDER: 'anthropic', ANTHROPIC_API_KEY: 'claude-test', OPENAI_API_KEY: 'openai-test' });
  expect(config).toMatchObject({ provider: 'anthropic', model: 'claude-sonnet-5-5', apiKey: 'claude-test' });
  expect(readConfig({ AI_PROVIDER: 'openai', OPENAI_API_KEY: 'openai-test', ANTHROPIC_API_KEY: 'claude-test' }))
    .toMatchObject({ model: 'gpt-5.6-terra', apiKey: 'openai-test' });
});

test('Claude requires an Anthropic key, not an OpenAI key', () => {
  expect(() => readConfig({ AI_PROVIDER: 'anthropic', OPENAI_API_KEY: 'wrong-provider' })).toThrow('ANTHROPIC_API_KEY');
  expect(() => readConfig({ AI_PROVIDER: 'anthropic', ANTHROPIC_API_KEY: ' ' })).toThrow('ANTHROPIC_API_KEY');
});

test('rejects model/provider mismatches and accepts a Claude override', () => {
  expect(() => readConfig({ AI_PROVIDER: 'anthropic', ANTHROPIC_API_KEY: 'test', AI_MODEL: 'gpt-5.6-terra' })).toThrow('AI_MODEL');
  expect(() => readConfig({ AI_PROVIDER: 'openai', OPENAI_API_KEY: 'test', AI_MODEL: 'claude-sonnet-5-5' })).toThrow('AI_MODEL');
  expect(readConfig({ AI_PROVIDER: 'anthropic', ANTHROPIC_API_KEY: 'test', AI_MODEL: 'claude-sonnet-4-6' }).model).toBe('claude-sonnet-4-6');
});
