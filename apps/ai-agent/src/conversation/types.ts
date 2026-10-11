import { z } from 'zod';
import type { ToolRuntime } from '../tools/definitions.js';
import { roadmapSchema, type Roadmap } from '../roadmaps/schema.js';
import type { RoadmapReadiness } from '../roadmaps/generate.js';
import { profileSchema, type ProfileExtraction, type WorkerProfile } from '../profiles/schema.js';
import { assessmentSchema, type SkillsAssessment } from '../skills/assess.js';

export const intentSchema = z.enum([
  'share_experience', 'career_question', 'change_goal', 'request_roadmap',
  'report_progress', 'next_step', 'other',
]);
export const turnResultSchema = z.strictObject({
  intent: intentSchema,
  reply: z.string().trim().min(1).max(700),
});
export type TurnResult = z.infer<typeof turnResultSchema>;
export const messageSchema = z.object({
  role: z.enum(['user', 'assistant']),
  content: z.string().min(1).max(4000),
});
export type Message = z.infer<typeof messageSchema>;
export const MAX_EXCHANGES = 50;
export const conversationSchema = z.object({
  version: z.literal(1),
  ownerHash: z.string().regex(/^[a-f0-9]{64}$/),
  messages: z.array(messageSchema).max(MAX_EXCHANGES * 2).refine(
    (messages) => messages.length % 2 === 0 && messages.every((m, i) => m.role === (i % 2 === 0 ? 'user' : 'assistant')),
    'Expected complete user/assistant exchanges',
  ),
  lastIntent: intentSchema.nullable(),
  profile: profileSchema.nullable().default(null),
  assessment: assessmentSchema.nullable().default(null),
  roadmap: roadmapSchema.nullable().default(null),
});
export type Conversation = z.infer<typeof conversationSchema>;
export interface ConversationProvider {
  extractProfile?(messages: Message[]): Promise<ProfileExtraction>;
  respond(messages: Message[], context?: { profile: WorkerProfile; assessment: SkillsAssessment; roadmap?: Roadmap | null; roadmapReadiness?: RoadmapReadiness }, tools?: ToolRuntime): Promise<TurnResult>;
}
