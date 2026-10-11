import { z } from 'zod';
import type { WorkerProfile } from '../profiles/schema.js';
import { assessSkills } from '../skills/assess.js';
import { generateRoadmap, roadmapReadiness } from '../roadmaps/generate.js';
import { getNextMilestone, reconcileRoadmap, refreshProgress } from '../roadmaps/progress.js';
import type { Roadmap } from '../roadmaps/schema.js';
import type { ToolRuntime } from './definitions.js';

const updateSchema = z.strictObject({ milestoneId: z.string().min(1), status: z.enum(['not_started', 'in_progress', 'user_reported_complete']), evidenceQuote: z.string().min(1).max(4000) });
function isSelfReport(text: string): boolean {
  return /\bI(?: have| am|['’]ve|['’]m)? (?:completed|finished|started|studying|working on|done with|have not completed|haven['’]t completed|didn['’]t finish)\b/i.test(text) || /^(?:please )?(?:mark|reset|reopen)\b/i.test(text.trim());
}
const noArgs = z.strictObject({});
const references: Record<string, RegExp> = {
  ev_safety: /\bev safety\b|\bsafety awareness\b|\bxev\b/i,
  electrical: /electrical|circuit|voltage/i, diagnostics: /diagnostic/i,
  inspection: /inspection|condition report/i, documentation: /documentation|work order|service report/i,
  tire_service: /tire|tyre/i, oil_service: /oil|routine maintenance/i,
  brakes: /brake/i, detailing: /detailing|appearance care/i,
  training_options: /training options|supervised training|role requirements/i,
};
export interface ToolState { profile: WorkerProfile | null; roadmap: Roadmap | null }

export function createToolRuntime(state: ToolState, latestMessage: string, messageIndex: number, roadmapChanged: boolean): ToolRuntime & { progressReply(): string | null } {
  let writes = 0;
  let changedTitle: string | null = null;
  let changedStatus: string | null = null;
  let attempted = false;
  return {
    canUpdateProgress: !roadmapChanged && isSelfReport(latestMessage),
    progressReply() {
      if (changedTitle) {
        const next = getNextMilestone(state.roadmap).milestone;
        return `Recorded ${changedTitle} as ${changedStatus === 'user_reported_complete' ? 'completed (user-reported)' : changedStatus === 'in_progress' ? 'in progress' : 'not started'}. This does not verify a qualification or authorize hazardous work. ${next ? `Next: ${next.title}.` : 'Review your learning with a qualified instructor or employer.'}`;
      }
      return attempted ? 'I have not changed your progress. Please name one milestone and say whether you started, finished, or want to reopen it.' : null;
    },
    execute(name, args) {
      if (name !== 'update_learning_progress') {
        if (!noArgs.safeParse(args).success) return { ok: false, error: 'invalid_arguments' };
        if (name === 'get_worker_profile') return { ok: true, profile: state.profile };
        if (name === 'assess_skills') return { ok: true, assessment: state.profile ? assessSkills(state.profile) : null };
        if (name === 'generate_roadmap') {
          state.roadmap = state.profile ? reconcileRoadmap(state.roadmap, generateRoadmap(state.profile)) : null;
          return { ok: true, roadmap: state.roadmap, readiness: state.profile ? roadmapReadiness(state.profile) : { ready: false, missing: ['targetCareer', 'experience'] } };
        }
        if (name === 'get_next_milestone') return { ok: true, ...getNextMilestone(state.roadmap) };
        return { ok: false, error: 'unknown_tool' };
      }
      attempted = true;
      const parsed = updateSchema.safeParse(args);
      if (!parsed.success) return { ok: false, error: 'invalid_arguments' };
      const { milestoneId, status, evidenceQuote } = parsed.data;
      const milestone = state.roadmap?.milestones.find(m => m.id === milestoneId);
      if (!milestone || roadmapChanged || writes >= 1) return { ok: false, error: 'clarification_required', guidance: 'Confirm one named milestone on the current roadmap in a separate message.' };
      const reference = references[milestone.skill ?? 'training_options'];
      const hasEvidence = latestMessage.includes(evidenceQuote) && reference?.test(evidenceQuote);
      const uncertain = /\b(if|would|will|might|could|plan|want|hope|when)\b/i.test(latestMessage);
      const negated = /\b(not|never)\b|haven['’]t|didn['’]t|don['’]t/i.test(latestMessage);
      const stated = status === 'user_reported_complete' ? /\b(completed|finished)\b|\bdone with\b/i.test(evidenceQuote)
        : status === 'in_progress' ? /\b(started|studying)\b|working on/i.test(evidenceQuote)
          : /\b(reset|reopen)\b|not completed|haven['’]t completed|didn['’]t finish/i.test(evidenceQuote);
      const selfReport = isSelfReport(evidenceQuote);
      // Conservative English evidence checks. Ambiguous reports are clarified, never guessed.
      if (!hasEvidence || !stated || uncertain || (status !== 'not_started' && negated) || !selfReport) {
        return { ok: false, error: 'clarification_required', guidance: 'Ask the worker to name the milestone and explicitly say whether they started, finished, or want to reopen it.' };
      }
      milestone.status = status;
      milestone.report = { quote: evidenceQuote, messageIndex };
      writes++;
      changedTitle = milestone.title;
      changedStatus = status;
      refreshProgress(state.roadmap!);
      return { ok: true, milestone, qualificationStatus: 'not_verified', warning: 'User-reported learning only; no credential or work authorization is verified.' };
    },
  };
}
