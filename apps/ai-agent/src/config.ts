import { z } from 'zod';

const configSchema = z.object({
  PORT: z.string().regex(/^\d+$/).transform(Number).pipe(z.number().int().min(1).max(65535)).default(4000),
  HOST: z.string().trim().min(1).default('127.0.0.1'),
  AI_PROVIDER: z.enum(['mock', 'openai', 'anthropic']).default('mock'),
  AI_MODEL: z.string().trim().min(1).optional(),
  ANTHROPIC_API_KEY: z.string().trim().optional(),
  OPENAI_API_KEY: z.string().trim().optional(),
  AI_TIMEOUT_MS: z.string().regex(/^\d+$/).transform(Number).pipe(z.number().int().min(1000).max(120000)).default(20000),
  MEMORY_DIR: z.string().trim().min(1).default('data/conversations'),
}).superRefine((config, ctx) => {
  if (config.AI_PROVIDER === 'anthropic' && !config.ANTHROPIC_API_KEY) {
    ctx.addIssue({ code: 'custom', path: ['ANTHROPIC_API_KEY'], message: 'Required in Claude mode' });
  }
  if (config.AI_PROVIDER === 'anthropic' && config.AI_MODEL && !config.AI_MODEL.startsWith('claude-')) {
    ctx.addIssue({ code: 'custom', path: ['AI_MODEL'], message: 'Use a Claude model ID' });
  }
  if (config.AI_PROVIDER === 'openai' && config.AI_MODEL?.startsWith('claude-')) {
    ctx.addIssue({ code: 'custom', path: ['AI_MODEL'], message: 'Use an OpenAI model ID' });
  }
  if (config.AI_PROVIDER === 'openai' && !config.OPENAI_API_KEY) {
    ctx.addIssue({ code: 'custom', path: ['OPENAI_API_KEY'], message: 'Required in OpenAI mode' });
  }
});

export function readConfig(env: NodeJS.ProcessEnv = process.env) {
  const result = configSchema.safeParse(env);
  if (!result.success) {
    const fields = [...new Set(result.error.issues.map((issue) => issue.path.join('.')))];
    throw new Error(`Invalid environment configuration: ${fields.join(', ')}`);
  }
  return {
    port: result.data.PORT, host: result.data.HOST,
    provider: result.data.AI_PROVIDER,
    model: result.data.AI_MODEL ?? (result.data.AI_PROVIDER === 'anthropic' ? 'claude-sonnet-5-5' : 'gpt-5.6-terra'),
    apiKey: result.data.AI_PROVIDER === 'anthropic' ? result.data.ANTHROPIC_API_KEY : result.data.OPENAI_API_KEY, timeoutMs: result.data.AI_TIMEOUT_MS,
    memoryDir: result.data.MEMORY_DIR,
  };
}
