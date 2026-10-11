import Fastify, { LogController } from 'fastify';
import { registerErrorHandlers } from './errors.js';
import { registerChatRoute } from './routes/chat.js';
import { registerHealthRoute } from './routes/health.js';
import { mockChat } from './services/mock-chat.js';
import type { ChatService } from './schemas/chat.js';

export function buildApp(options: { chat?: ChatService; logger?: boolean } = {}) {
  const app = Fastify({
    logger: options.logger ?? false,
    logController: new LogController({ disableRequestLogging: true }),
    bodyLimit: 16 * 1024,
  });
  registerErrorHandlers(app);
  registerHealthRoute(app);
  registerChatRoute(app, options.chat ?? mockChat);
  return app;
}
