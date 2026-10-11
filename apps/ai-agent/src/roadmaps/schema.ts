import { z } from 'zod';
import { roleSchema } from '../skills/assess.js';
import { skillIdSchema } from '../profiles/schema.js';

export const milestoneSchema = z.strictObject({
  id: z.string(), title: z.string(), skill: skillIdSchema.nullable(),
  mode: z.enum(['learn', 'continue_learning', 'review', 'clarify', 'investigate']),
  why: z.string(), actions: z.array(z.string()).min(1),
  completionEvidence: z.string(), dependsOn: z.array(z.string()),
  status: z.enum(['not_started', 'in_progress', 'user_reported_complete']),
  report: z.object({ quote: z.string(), messageIndex: z.number().int().min(0) }).nullable().default(null),
  sourceUrls: z.array(z.string().url()),
});
export const roadmapSchema = z.strictObject({
  version: z.literal(1), targetRole: roleSchema,
  transferableSkills: z.array(skillIdSchema), skillGaps: z.array(skillIdSchema),
  unknownSkills: z.array(skillIdSchema),
  constraints: z.strictObject({ budget: z.string().nullable(), availability: z.string().nullable(), learningPreference: z.string().nullable() }),
  studyApproach: z.string(), budgetApproach: z.string(),
  milestones: z.array(milestoneSchema).min(1),
  credentialsToInvestigate: z.array(z.strictObject({ name: z.string(), sourceUrl: z.string().url(), caution: z.string() })),
  nextStep: z.string(), status: z.enum(['not_started', 'in_progress', 'user_reported_complete']),
  qualificationStatus: z.literal('not_verified'), caveats: z.array(z.string()),
});
export type Roadmap = z.infer<typeof roadmapSchema>;
