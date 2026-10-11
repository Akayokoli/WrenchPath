import type { FastifyInstance } from 'fastify';

export function registerErrorHandlers(app: FastifyInstance) {
  app.setErrorHandler((error, request, reply) => {
    // Do not log request bodies, identifiers, or exception messages containing user data.
    const known = error as { code?: string; statusCode?: number };
    if (known.statusCode === 413) {
      return reply.code(413).send({ error: { code: 'PAYLOAD_TOO_LARGE', message: 'Request body exceeds the 16 KiB limit.' } });
    }
    if (known.statusCode === 415) {
      return reply.code(415).send({ error: { code: 'UNSUPPORTED_MEDIA_TYPE', message: 'Use Content-Type: application/json.' } });
    }
    if (known.statusCode === 400) {
      return reply.code(400).send({ error: { code: 'BAD_REQUEST', message: 'Request body must contain valid JSON.' } });
    }
    request.log.error({ requestId: request.id }, 'Chat service request failed');
    return reply.code(500).send({ error: { code: 'INTERNAL_ERROR', message: 'Unable to process your request. Please try again.' } });
  });
  app.setNotFoundHandler((_request, reply) => reply.code(404).send({
    error: { code: 'NOT_FOUND', message: 'Endpoint not found.' },
  }));
}
