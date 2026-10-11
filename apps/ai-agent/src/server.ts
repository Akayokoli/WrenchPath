import { existsSync } from 'node:fs';
import { loadEnvFile } from 'node:process';
import { buildApp } from './app.js';
import { readConfig } from './config.js';
import { createChatService } from './services/create-chat.js';

async function main() {
  if (existsSync('.env')) loadEnvFile('.env');
  const config = readConfig();
  const app = buildApp({ logger: true, chat: createChatService(config) });
  app.log.info({ provider: config.provider }, 'AI service mode');
  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.once(signal, () => {
      void app.close().catch(() => {
        console.error('Unable to shut down the AI service cleanly.');
        process.exitCode = 1;
      });
    });
  }
  await app.listen({ port: config.port, host: config.host });
}

main().catch((error: unknown) => {
  const message = error instanceof Error && error.message.startsWith('Invalid environment configuration:')
    ? error.message
    : 'Unable to start the AI service. Check the environment file, host, and port availability.';
  console.error(message);
  process.exitCode = 1;
});
