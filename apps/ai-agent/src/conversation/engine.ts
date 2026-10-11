import { reconcileRoadmap } from '../roadmaps/progress.js';
import { createToolRuntime } from '../tools/runtime.js';
import { generateRoadmap, roadmapReadiness } from '../roadmaps/generate.js';
import { updateProfile } from '../profiles/extract.js';
import { assessSkills } from '../skills/assess.js';
import { describeFailure } from '../providers/diagnostics.js';
import type { ChatService } from '../schemas/chat.js';
import { hashId, type ConversationStore } from '../storage/store.js';
import { MAX_EXCHANGES, turnResultSchema, type ConversationProvider, type Message } from './types.js';

export const UNAVAILABLE_REPLY = "I'm having trouble responding right now. Your previous conversation is unchanged. Please try your message again shortly.";

export function createConversationEngine(provider: ConversationProvider, store: ConversationStore, onFailure?: (diagnostic: string) => void): ChatService {
  const pending = new Map<string, Promise<unknown>>();
  return async (request) => {
    const key = hashId(request.conversationId);
    const previous = pending.get(key) ?? Promise.resolve();
    const task = previous.catch(() => {}).then(async () => {
      const ownerHash = hashId(request.senderId);
      const conversation = await store.load(key) ?? {
        version: 1 as const, ownerHash, messages: [], lastIntent: null, profile: null, assessment: null, roadmap: null,
      };
      if (conversation.ownerHash !== ownerHash) {
        return { reply: 'This conversation is unavailable for this sender. Please ask the messaging service to start a new conversation.' };
      }
      if (conversation.messages.length >= MAX_EXCHANGES * 2) {
        return { reply: 'This conversation has reached its current memory limit. Please ask the messaging service to start a new conversation and share your current goal and experience.' };
      }
      const messages: Message[] = [...conversation.messages, { role: 'user', content: request.message }];
      const profile = provider.extractProfile
        ? updateProfile(conversation.profile, await provider.extractProfile(structuredClone(messages)), messages)
        : conversation.profile;
      const assessment = profile ? assessSkills(profile) : null;
      const roadmap = reconcileRoadmap(conversation.roadmap, profile ? generateRoadmap(profile) : null);
      const state = { profile, roadmap };
      const tools = createToolRuntime(state, request.message, messages.length - 1, !conversation.roadmap || conversation.roadmap.targetRole !== roadmap?.targetRole);
      const readiness = profile ? roadmapReadiness(profile) : undefined;
      const result = turnResultSchema.parse(await provider.respond(structuredClone(messages),
        profile && assessment ? { profile, assessment, roadmap, roadmapReadiness: readiness } : undefined, tools));
      const progressReply = tools.progressReply();
      if (progressReply) result.reply = progressReply;
      else if (result.intent === 'report_progress') result.reply = 'I have not changed your progress. Please name one learning milestone and say whether you started, finished, or want to reopen it.';
      turnResultSchema.parse(result);
      await store.save(key, {
        ...conversation,
        lastIntent: result.intent, profile, assessment, roadmap: state.roadmap,
        messages: [...messages, { role: 'assistant', content: result.reply }],
      });
      return { reply: result.reply };
    });
    pending.set(key, task);
    try { return await task; }
    catch (error) {
      try { onFailure?.(describeFailure(error)); } catch { /* Diagnostics cannot break a safe reply. */ }
      return { reply: UNAVAILABLE_REPLY };
    }
    finally { if (pending.get(key) === task) pending.delete(key); }
  };
}
