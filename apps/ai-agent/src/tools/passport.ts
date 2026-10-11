import type { WorkerProfile } from '../profiles/schema.js';
import type { Roadmap } from '../roadmaps/schema.js';

// Local handoff type only. No external Skills Passport API or teammate files are changed.
export interface SkillsPassportSnapshot {
  schemaVersion: 1;
  verification: 'user_reported_only';
  profile: WorkerProfile | null;
  roadmap: Roadmap | null;
}
export function skillsPassportSnapshot(profile: WorkerProfile | null, roadmap: Roadmap | null): SkillsPassportSnapshot {
  return structuredClone({ schemaVersion: 1, verification: 'user_reported_only', profile, roadmap });
}
