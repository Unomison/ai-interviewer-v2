/**
 * ATS configuration (Milestone 3, spec Section 4.2).
 *
 * Weights are configurable here — the single tuning surface for the hybrid
 * score. The skill alias map normalises common variants before matching;
 * ROLE_TEMPLATES power the pseudo-JD path when the visitor skips the JD
 * (research-driven pseudo-JDs arrive in M7; these are clearly labelled
 * estimates).
 */

export const WEIGHTS = {
  keyword: 0.4,
  semantic: 0.25,
  structure: 0.15,
  impact: 0.2,
};

/** Required skills weigh more than preferred ones. */
export const SKILL_IMPORTANCE = { required: 2, preferred: 1 };

/** Normalised-name → canonical skill. Keys are lowercase, no dots/dashes/spaces. */
export const SKILL_ALIASES = {
  js: 'javascript',
  ts: 'typescript',
  py: 'python',
  reactjs: 'react',
  reactnative: 'react native',
  nodejs: 'node',
  node: 'node',
  'c++': 'c++',
  cpp: 'c++',
  golang: 'go',
  k8s: 'kubernetes',
  kube: 'kubernetes',
  postgres: 'postgresql',
  pg: 'postgresql',
  mongo: 'mongodb',
  tf: 'terraform',
  aws: 'amazon web services',
  gcp: 'google cloud',
  cicd: 'ci/cd',
  'ci/cd': 'ci/cd',
  restful: 'rest',
  restapi: 'rest',
  graphql: 'graphql',
  ml: 'machine learning',
  ai: 'artificial intelligence',
  nlp: 'natural language processing',
  llm: 'large language models',
  dsa: 'data structures and algorithms',
  oop: 'object oriented programming',
  vite: 'vite',
  nextjs: 'next.js',
  expressjs: 'express',
  scikitlearn: 'scikit-learn',
  jupyter: 'jupyter',
  seaborn: 'seaborn',
};

/** Generic role templates for the no-JD pseudo-JD path (labelled estimated). */
export const ROLE_TEMPLATES = {
  'software engineer': {
    roleTitle: 'Software Engineer',
    requiredSkills: ['data structures and algorithms', 'javascript', 'python', 'git', 'rest'],
    preferredSkills: ['react', 'node', 'sql', 'docker', 'system design'],
    responsibilities: [
      'Design and implement backend services and APIs',
      'Write clean, tested, maintainable code',
      'Debug production issues and participate in code reviews',
    ],
    domainKeywords: ['web services', 'apis', 'databases'],
  },
  'frontend engineer': {
    roleTitle: 'Frontend Engineer',
    requiredSkills: ['javascript', 'react', 'html', 'css', 'git'],
    preferredSkills: ['typescript', 'next.js', 'vite', 'testing'],
    responsibilities: [
      'Build responsive user interfaces',
      'Optimise client-side performance',
      'Collaborate with designers on component libraries',
    ],
    domainKeywords: ['web', 'ui', 'accessibility'],
  },
  'backend engineer': {
    roleTitle: 'Backend Engineer',
    requiredSkills: ['python', 'rest', 'sql', 'git', 'data structures and algorithms'],
    preferredSkills: ['node', 'docker', 'postgresql', 'redis', 'system design'],
    responsibilities: [
      'Design scalable backend services and data models',
      'Own services in production',
    ],
    domainKeywords: ['distributed systems', 'databases'],
  },
  'data analyst': {
    roleTitle: 'Data Analyst',
    requiredSkills: ['sql', 'python', 'excel', 'data visualisation'],
    preferredSkills: ['pandas', 'tableau', 'statistics'],
    responsibilities: [
      'Analyse datasets and build dashboards',
      'Communicate insights to stakeholders',
    ],
    domainKeywords: ['analytics', 'reporting'],
  },
};

export const GENERIC_TEMPLATE_KEY = 'software engineer';

/** Thresholds for the deterministic parts. */
export const THRESHOLDS = {
  /** Fuse.js score at or below this counts as a fuzzy skill match (0 = exact). */
  fuzzyMatch: 0.35,
  /** Looser threshold used to detect "stated nowhere but evidenced" skills. */
  evidenceMatch: 0.55,
  /** Minimum non-space chars before we believe a PDF has real text. */
  minTextChars: 200,
};

export const ATS_DISCLAIMER =
  'This score is an estimate produced by deterministic checks plus one AI rubric call. ' +
  'Real ATS products rarely expose their scores, so treat this as directional feedback, not a hiring decision.';
