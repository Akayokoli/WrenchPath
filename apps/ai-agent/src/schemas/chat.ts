import { z } from 'zod';

export const chatRequestSchema = z.strictObject({
  conversationId: z.string().trim().min(1).max(200),
  senderId: z.string().trim().min(1).max(200),
  message: z.string().trim().min(1).max(4000),
});

export type ChatRequest = z.infer<typeof chatRequestSchema>;
export type ChatResponse = { reply: string };
export type ChatService = (request: ChatRequest) => Promise<ChatResponse>;
