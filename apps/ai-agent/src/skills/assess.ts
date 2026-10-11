import { z } from 'zod';
import { skillIdSchema, type WorkerProfile, type SkillId } from '../profiles/schema.js';

export const roleSchema = z.enum(['vehicle_inspector', 'reconditioning_technician', 'automotive_service_technician', 'ev_service_technician']);
export const assessmentSchema = z.object({
  targetRole: roleSchema.nullable(),
  existingSkills: z.array(skillIdSchema), transferableSkills: z.array(skillIdSchema),
  skillGaps: z.array(skillIdSchema), learningSkills: z.array(skillIdSchema), unknownSkills: z.array(skillIdSchema),
  explanations: z.array(z.object({ skill: skillIdSchema, why: z.string() })),
  prerequisites: z.array(z.string()), clarification: z.string().nullable(),
  qualificationStatus: z.literal('not_verified'), sources: z.array(z.string()),
});
export type SkillsAssessment = z.infer<typeof assessmentSchema>;
export const SOURCES = {
  ase: 'https://ase.com/tests/ase-certification-test-series/',
  ev: 'https://ase.com/tests/x-ev/',
  onet: 'https://www.onetonline.org/link/summary/49-3023.00',
};
// MVP learning-area mappings, not an employer's hiring rubric or licensing rules.
const areas: Record<z.infer<typeof roleSchema>, SkillId[]> = {
  vehicle_inspector: ['inspection', 'documentation', 'brakes', 'tire_service'],
  reconditioning_technician: ['inspection', 'documentation', 'oil_service', 'tire_service', 'brakes', 'detailing'],
  automotive_service_technician: ['oil_service', 'tire_service', 'brakes', 'electrical', 'diagnostics', 'inspection', 'documentation'],
  ev_service_technician: ['electrical', 'ev_safety', 'diagnostics', 'inspection', 'documentation', 'tire_service', 'oil_service'],
};
const why: Record<SkillId, string> = {
  tire_service: 'Tire-service experience can transfer to vehicle maintenance tasks.',
  oil_service: 'Oil-service experience can transfer maintenance habits; it does not establish EV electrical skill or imply battery EVs need engine oil changes.',
  brakes: 'Brake knowledge supports understanding vehicle condition and mechanical service.',
  inspection: 'Inspection helps identify and communicate vehicle condition.',
  documentation: 'Clear records help communicate findings and work performed.',
  electrical: 'Electrical fundamentals support learning about vehicle circuits.',
  diagnostics: 'Diagnostic reasoning helps distinguish symptoms from causes.',
  ev_safety: 'EV safety education addresses hazards around electrified vehicles; awareness alone does not authorize high-voltage work.',
  detailing: 'Appearance care can be relevant to reconditioning assignments, depending on the employer.',
};
export function targetRole(profile: WorkerProfile): z.infer<typeof roleSchema> | null {
  const target = profile.facts.find(f => f.field === 'targetCareer')?.value?.toLowerCase() ?? '';
  if (/\bev\b|\bevs\b|electric vehicle/.test(target)) return 'ev_service_technician';
  if (/recondition/.test(target)) return 'reconditioning_technician';
  if (/inspect/.test(target)) return 'vehicle_inspector';
  if (/mechanic|automotive service|auto technician|automotive technician/.test(target)) return 'automotive_service_technician';
  return null;
}
export function assessSkills(profile: WorkerProfile): SkillsAssessment {
  const role = targetRole(profile);
  const relevant = role ? areas[role] : [];
  const status = new Map(profile.skills.map(s => [s.id, s.status]));
  const existingSkills = profile.skills.filter(s => s.status === 'reported').map(s => s.id);
  const unknownSkills = relevant.filter(id => !status.has(id) || status.get(id) === 'unknown');
  const prerequisites = role ? ['Employer and program requirements vary; this is a preliminary learning assessment, not an official qualification.'] : [];
  if (role === 'ev_service_technician') prerequisites.push('Appropriate supervised high-voltage safety training and employer authorization must precede hazardous EV work. Self-reported experience or safety awareness is not verification.');
  const firstUnknown = unknownSkills[0];
  return {
    targetRole: role, existingSkills,
    transferableSkills: relevant.filter(id => status.get(id) === 'reported'),
    skillGaps: relevant.filter(id => status.get(id) === 'no_experience'),
    learningSkills: relevant.filter(id => status.get(id) === 'learning'), unknownSkills,
    explanations: relevant.map(skill => ({ skill, why: why[skill] })), prerequisites,
    clarification: !role ? 'Which automotive role would you like to explore?' : firstUnknown ? `What experience or training, if any, do you have with ${firstUnknown.replaceAll('_', ' ')}?` : null,
    qualificationStatus: 'not_verified', sources: role ? [SOURCES.ase, SOURCES.onet, ...(role === 'ev_service_technician' ? [SOURCES.ev] : [])] : [],
  };
}
