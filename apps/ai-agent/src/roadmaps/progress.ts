import type { Roadmap } from './schema.js';

export function refreshProgress(plan: Roadmap): Roadmap {
  const next = plan.milestones.find(m => m.status !== 'user_reported_complete');
  plan.status = !next ? 'user_reported_complete' : plan.milestones.some(m => m.status !== 'not_started') ? 'in_progress' : 'not_started';
  plan.nextStep = next ? next.actions.slice(0, 2).join(' ') : 'Review your learning evidence with a qualified instructor or employer. This does not verify qualifications or authorize hazardous work.';
  return plan;
}
export function reconcileRoadmap(previous: Roadmap | null, generated: Roadmap | null): Roadmap | null {
  if (!generated) return null;
  const plan = structuredClone(generated);
  if (previous?.targetRole === plan.targetRole) {
    for (const milestone of plan.milestones) {
      const prior = previous.milestones.find(m => m.id === milestone.id && m.completionEvidence === milestone.completionEvidence);
      if (prior) { milestone.status = prior.status; milestone.report = prior.report; }
    }
  }
  return refreshProgress(plan);
}
export function getNextMilestone(plan: Roadmap | null) {
  if (!plan) return { milestone: null, reason: 'roadmap_missing', qualificationStatus: 'not_verified' };
  const milestone = plan.milestones.find(m => m.status !== 'user_reported_complete') ?? null;
  return { milestone, reason: milestone ? 'next_learning_step' : 'all_steps_user_reported_complete', qualificationStatus: 'not_verified', guidance: plan.nextStep };
}
