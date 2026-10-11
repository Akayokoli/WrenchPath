import { z } from 'zod';

export const fieldSchema = z.enum(['currentRole', 'yearsExperience', 'education', 'certifications', 'targetCareer', 'location', 'budget', 'availability', 'learningPreference']);
export const skillIdSchema = z.enum(['tire_service', 'oil_service', 'brakes', 'inspection', 'documentation', 'electrical', 'diagnostics', 'ev_safety', 'detailing']);
export const evidenceSchema = z.strictObject({ messageIndex: z.number().int().min(0), quote: z.string().min(1).max(1000) });
export const factSchema = z.strictObject({ field: fieldSchema, value: z.string().min(1).max(500).nullable(), evidence: evidenceSchema });
export const skillSchema = z.strictObject({ id: skillIdSchema, status: z.enum(['reported', 'no_experience', 'learning', 'unknown']), evidence: evidenceSchema });
export const extractionSchema = z.strictObject({ facts: z.array(factSchema).max(40), skills: z.array(skillSchema).max(40) });
export const profileSchema = z.strictObject({
  verification: z.literal('user_reported_only'),
  facts: z.array(factSchema).max(9), skills: z.array(skillSchema).max(9),
});
export type WorkerProfile = z.infer<typeof profileSchema>;
export type ProfileExtraction = z.infer<typeof extractionSchema>;
export type SkillId = z.infer<typeof skillIdSchema>;

const evidenceJson = { type: 'object', additionalProperties: false, properties: { messageIndex: { type: 'integer' }, quote: { type: 'string' } }, required: ['messageIndex', 'quote'] };
export const EXTRACTION_JSON_SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: {
    facts: { type: 'array', items: { type: 'object', additionalProperties: false,
      properties: { field: { type: 'string', enum: fieldSchema.options }, value: { type: ['string', 'null'] }, evidence: evidenceJson }, required: ['field', 'value', 'evidence'] } },
    skills: { type: 'array', items: { type: 'object', additionalProperties: false,
      properties: { id: { type: 'string', enum: skillIdSchema.options }, status: { type: 'string', enum: skillSchema.shape.status.options }, evidence: evidenceJson }, required: ['id', 'status', 'evidence'] } },
  }, required: ['facts', 'skills'],
};
