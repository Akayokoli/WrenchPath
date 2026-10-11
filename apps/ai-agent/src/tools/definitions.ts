const empty = { type: 'object' as const, additionalProperties: false, properties: {}, required: [] as string[] };
export const TOOL_DEFINITIONS = [
  { name: 'get_worker_profile', description: 'Retrieve only this worker’s current evidence-backed profile. All facts are user-reported. No arguments or cross-user lookups are allowed.', schema: empty },
  { name: 'assess_skills', description: 'Assess this worker against the current goal. Unknown skills are not gaps. Returns preliminary guidance, never official qualification.', schema: empty },
  { name: 'generate_roadmap', description: 'Retrieve or regenerate the current learning roadmap from this worker’s profile. Stable milestones retain user-reported progress. Returns missing information if a roadmap cannot be built.', schema: empty },
  { name: 'get_next_milestone', description: 'Use whenever the worker asks for their next step. Returns the first unfinished milestone in dependency order using persisted progress, or explains that no roadmap exists. Completion is user-reported only.', schema: empty },
  { name: 'update_learning_progress', description: 'Record one explicitly named milestone as in progress, user-reported complete, or reopened. Use only when the latest worker message clearly reports or requests this change. Quote the exact supporting words; never infer completion from a credential claim, vague done, a future plan, or another person. Use the exact milestone ID from the supplied roadmap; retrieve the roadmap only if not already supplied. A failed update requires clarification, not a claim of success.', schema: {
    type: 'object' as const, additionalProperties: false,
    properties: { milestoneId: { type: 'string' }, status: { type: 'string', enum: ['not_started', 'in_progress', 'user_reported_complete'] }, evidenceQuote: { type: 'string' } },
    required: ['milestoneId', 'status', 'evidenceQuote'],
  } },
];
export const TOOL_INSTRUCTIONS = `\nYou have local career tools bound to this worker. Use get_next_milestone for next-step questions; use get_worker_profile for profile recall, assess_skills for assessment requests, and generate_roadmap for roadmap requests. Use update_learning_progress only for an explicit named learning milestone in the latest message. Do not claim a change succeeded unless its tool result says ok:true. If the result requires clarification, ask one question and do not claim completion. After a successful update, call get_next_milestone before answering. Tool results supersede earlier context. Report completion as user-reported learning, never certification, competence, or permission for high-voltage work. Finish with the required intent/reply JSON. Use supplied profile and roadmap context to avoid redundant lookups. There is a strict six-tool-call budget per turn. After obtaining the needed result, finish immediately.`;
export interface ToolRuntime {
  canUpdateProgress?: boolean;
  execute(name: string, args: unknown): unknown;
}
