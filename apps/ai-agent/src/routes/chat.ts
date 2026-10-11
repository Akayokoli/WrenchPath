import type { FastifyInstance } from 'fastify';
import { chatRequestSchema, type ChatService } from '../schemas/chat.js';

export function registerChatRoute(app: FastifyInstance, chat: ChatService) {
  app.post('/api/chat', async (request, reply) => {
    const mediaType = request.headers['content-type']?.split(';')[0]?.trim().toLowerCase();
    if (mediaType !== 'application/json') {
      return reply.code(415).send({ error: { code: 'UNSUPPORTED_MEDIA_TYPE', message: 'Use Content-Type: application/json.' } });
    }
    const parsed = chatRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: {
        code: 'VALIDATION_ERROR',
        message: 'Provide conversationId and senderId (1–200 characters each), and message (1–4000 characters). No extra fields are accepted.',
        fields: [...new Set(parsed.error.issues.map((issue) => issue.path.join('.') || 'body'))],
      } });
    }
    const result = await chat(parsed.data);
    return { reply: result.reply };
  });
}
