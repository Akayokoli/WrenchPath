import type { SkillId } from '../profiles/schema.js';
import type { SkillsAssessment } from '../skills/assess.js';
import { SOURCES } from '../skills/assess.js';

// Our pedagogical ordering, not an official credential sequence or hiring requirement.
export const ROLE_SEQUENCE: Record<NonNullable<SkillsAssessment['targetRole']>, SkillId[]> = {
  ev_service_technician: ['ev_safety', 'electrical', 'diagnostics', 'inspection', 'documentation'],
  vehicle_inspector: ['inspection', 'tire_service', 'brakes', 'documentation'],
  reconditioning_technician: ['inspection', 'oil_service', 'tire_service', 'brakes', 'detailing', 'documentation'],
  automotive_service_technician: ['inspection', 'oil_service', 'tire_service', 'brakes', 'electrical', 'diagnostics', 'documentation'],
};
export const LEARNING_AREAS: Record<SkillId, { title: string; action: string; evidence: string; source: string }> = {
  ev_safety: {
    title: 'EV safety awareness',
    action: 'Read the official ASE xEV awareness scope and list hazards and the limits of your training. Do not touch, test, disconnect, or repair high-voltage components.',
    evidence: 'Explain the boundary between awareness and technician training, including when to stop and seek a qualified supervisor.', source: SOURCES.ev,
  },
  electrical: {
    title: 'Electrical fundamentals',
    action: 'Study voltage, current, resistance, and circuit diagrams using written examples or a simulation. Ask an instructor to review your explanations before practical work.',
    evidence: 'Explain a simple example circuit and identify questions to take to an instructor.', source: SOURCES.ase,
  },
  diagnostics: {
    title: 'Diagnostic reasoning',
    action: 'Work through a written diagnostic case: distinguish the reported symptom, possible causes, and evidence needed. Arrange instructor-led practice rather than experimenting on live systems.',
    evidence: 'Write a short case analysis and request instructor feedback.', source: SOURCES.onet,
  },
  inspection: {
    title: 'Vehicle condition inspection',
    action: 'Study a sample inspection checklist and identify what should be observed, recorded, or referred to a qualified technician. Ask an employer or instructor about the scope of the role.',
    evidence: 'Prepare a sample condition report from a written or photo-based training case.', source: SOURCES.onet,
  },
  documentation: {
    title: 'Clear service documentation',
    action: 'Draft a sample work order separating observations, proposed work, and work actually performed; request feedback on clarity.',
    evidence: 'Keep a revised sample report without customer names or vehicle identifiers.', source: SOURCES.onet,
  },
  tire_service: {
    title: 'Tire-service foundations',
    action: 'Review tire-service learning objectives and manufacturer safety guidance with an instructor; identify which tasks you have actually performed and which need supervised training.',
    evidence: 'Record confirmed experience and an instructor-reviewed list of learning needs.', source: SOURCES.ase,
  },
  oil_service: {
    title: 'Routine maintenance foundations',
    action: 'Review a sample maintenance schedule and how to find manufacturer specifications. Arrange supervision for unfamiliar practical tasks.',
    evidence: 'Explain a sample maintenance schedule and document questions for an instructor.', source: SOURCES.onet,
  },
  brakes: {
    title: 'Brake-system foundations',
    action: 'Study brake-system concepts and warning signs using diagrams or written cases. Leave practical safety-critical work to qualified supervision.',
    evidence: 'Explain a written brake-system case and when to refer work to a qualified technician.', source: SOURCES.ase,
  },
  detailing: {
    title: 'Reconditioning appearance care',
    action: 'Ask the employer whether appearance care is included in the role. If so, review product safety instructions and a sample quality checklist with a supervisor.',
    evidence: 'Document the employer-confirmed scope and a sample quality checklist.', source: SOURCES.onet,
  },
};
export const EV_AWARENESS_CREDENTIAL = {
  name: 'ASE xEV Electrical Safety Awareness Certification (Level 1)', sourceUrl: SOURCES.ev,
  caution: 'Investigate the current scope, preparation, fees, and eligibility at the official source. Awareness is not authorization for high-voltage work; this plan does not award a credential.',
};
