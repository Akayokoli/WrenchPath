import { assessSkills } from '../skills/assess.js';
import type { WorkerProfile } from '../profiles/schema.js';
import { EV_AWARENESS_CREDENTIAL, LEARNING_AREAS, ROLE_SEQUENCE } from './catalog.js';
import { roadmapSchema, type Roadmap } from './schema.js';

export type RoadmapReadiness = { ready: boolean; missing: ('targetCareer' | 'experience')[] };
export function roadmapReadiness(profile: WorkerProfile): RoadmapReadiness {
  const missing: RoadmapReadiness['missing'] = [];
  if (!assessSkills(profile).targetRole) missing.push('targetCareer');
  if (!profile.skills.length && !profile.facts.some(f => ['currentRole', 'yearsExperience'].includes(f.field) && f.value)) missing.push('experience');
  return { ready: missing.length === 0, missing };
}

export function generateRoadmap(profile: WorkerProfile): Roadmap | null {
  if (!roadmapReadiness(profile).ready) return null;
  const assessment = assessSkills(profile);
  const targetRole = assessment.targetRole!;
  const fact = (field: string) => profile.facts.find(f => f.field === field)?.value ?? null;
  const constraints = { budget: fact('budget'), availability: fact('availability'), learningPreference: fact('learningPreference') };
  const studyApproach = constraints.availability
    ? `Use study sessions within your stated availability (${constraints.availability}); choose a manageable session length and review before moving on. No completion date is assumed.`
    : 'Choose a manageable study window before committing to classes; availability is not yet known.';
  const budgetApproach = constraints.budget
    ? `Your stated budget is ${constraints.budget}. Begin with official reading material or written exercises; verify all training, tool, travel, and assessment costs against that budget before paying. Ask about funding or employer support if costs exceed it.`
    : 'Budget is not yet known. Start with official reading material or written exercises and confirm your budget and all costs before paid enrollment.';
  const milestones: Roadmap['milestones'] = [];
  for (const skill of ROLE_SEQUENCE[targetRole]) {
    const area = LEARNING_AREAS[skill];
    const status = profile.skills.find(s => s.id === skill)?.status;
    const mode = status === 'reported' ? 'review' : status === 'no_experience' ? 'learn' : status === 'learning' ? 'continue_learning' : 'clarify';
    const introduction = mode === 'review'
      ? 'Use your reported experience to review this area with an instructor; it is not independently verified.'
      : mode === 'clarify'
        ? 'First clarify your experience with this area. If it is new, use the learning action below; if experienced, ask an instructor to review your work.'
        : mode === 'continue_learning' ? 'Build on the study you reported; do not treat study as practical competence.' : 'Start with introductory learning because you reported no experience in this area.';
    milestones.push({
      id: `${targetRole}:${skill}`, title: `${mode === 'review' ? 'Review' : mode === 'clarify' ? 'Clarify and plan' : mode === 'continue_learning' ? 'Continue' : 'Learn'}: ${area.title}`,
      skill, mode,
      why: assessment.explanations.find(e => e.skill === skill)?.why ?? 'This is a suggested learning area for your target role.',
      actions: [introduction, area.action, studyApproach, ...(constraints.learningPreference ? [`When comparing learning formats, consider your stated preference: ${constraints.learningPreference}.`] : [])],
      completionEvidence: area.evidence, dependsOn: milestones.length ? [milestones[milestones.length - 1]!.id] : [],
      status: 'not_started', report: null, sourceUrls: [area.source],
    });
  }
  const credentialsToInvestigate = targetRole === 'ev_service_technician' ? [EV_AWARENESS_CREDENTIAL] : [];
  milestones.push({
    id: `${targetRole}:training_options`, title: 'Compare supervised training and role requirements', skill: null, mode: 'investigate',
    why: 'A learning plan needs a practical route to supervised instruction that fits your circumstances.',
    actions: [
      targetRole === 'ev_service_technician'
        ? 'Ask a qualified instructor about supervised EV training prerequisites and employer authorization. Do not perform hazardous high-voltage work independently.'
        : 'Ask an employer or instructor which supervised training, practical assessments, and credentials apply to the role.',
      budgetApproach, studyApproach,
      ...(credentialsToInvestigate.map(c => `Investigate ${c.name} using ${c.sourceUrl}. ${c.caution}`)),
      'Compare confirmed course scope, prerequisites, total costs, and schedule before choosing. No local provider or opening has been verified by this plan.',
    ],
    completionEvidence: 'Record verified options and open questions; selecting training does not establish a qualification.',
    dependsOn: [milestones[milestones.length - 1]!.id], status: 'not_started', report: null, sourceUrls: assessment.sources,
  });
  return roadmapSchema.parse({
    version: 1, targetRole, transferableSkills: assessment.transferableSkills, skillGaps: assessment.skillGaps,
    unknownSkills: assessment.unknownSkills, constraints, studyApproach, budgetApproach, milestones, credentialsToInvestigate,
    nextStep: milestones[0]!.actions[0] + ' ' + milestones[0]!.actions[1],
    status: 'not_started', qualificationStatus: 'not_verified',
    caveats: ['This is a suggested learning sequence, not a qualification or employment guarantee.',
      'All worker experience is user-reported. Unknown skills require clarification; reported skills are not automatically complete.',
      'Dates, program availability, costs, and eligibility need verification. No completion timeline is promised.',
      'Progress is user-reported learning only, not verified competence or authorization.'],
  });
}
