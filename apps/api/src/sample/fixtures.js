/**
 * Sample interview data (Milestone 3, spec Section 13).
 *
 * Precomputed fixtures — served with ZERO LLM calls so visitors can see a
 * full ATS report without uploading anything or spending quota. The sample
 * candidate is fictional.
 */

export const SAMPLE_RESUME = {
  education: [
    {
      institution: 'Pune Institute of Technology',
      degree: 'B.Tech',
      field: 'Computer Engineering',
      start: '2021',
      end: '2025',
    },
  ],
  experience: [
    {
      company: 'Nimbus Labs',
      title: 'Software Engineering Intern',
      start: '2024-06',
      end: '2024-12',
      bullets: [
        'Built a React dashboard that visualised API latency for 12 microservices',
        'Wrote Python scripts to backfill 2M rows into PostgreSQL, cutting manual work',
        'Added unit tests with Jest, raising coverage from 41% to 68%',
      ],
    },
  ],
  projects: [
    {
      name: 'CampusEats',
      tech: ['React', 'Node', 'MongoDB'],
      description: 'Food-ordering web app for campus canteens',
      metrics: ['400+ weekly orders during the pilot', 'p95 checkout latency 900ms'],
    },
    {
      name: 'AlgoVisualizer',
      tech: ['JavaScript'],
      description: 'Interactive sorting algorithm visualizer',
      metrics: ['1.2k GitHub stars'],
    },
  ],
  skills: ['JavaScript', 'Python', 'React', 'Node', 'SQL', 'Git', 'HTML', 'CSS'],
  certifications: [],
};

export const SAMPLE_JD = {
  roleTitle: 'Software Engineer',
  seniority: 'new-grad',
  company: { name: 'Nimbus Labs', ambiguous: false },
  requiredSkills: ['JavaScript', 'Python', 'Git', 'Data Structures and Algorithms'],
  preferredSkills: ['React', 'Node', 'SQL', 'Docker'],
  responsibilities: [
    'Design and implement backend services and APIs',
    'Write clean, tested, maintainable code',
    'Participate in code reviews',
  ],
  domainKeywords: ['web services', 'apis'],
};

export const SAMPLE_ATS_REPORT = {
  totalScore: 71.4,
  breakdown: { keyword: 78.5, semantic: 72.0, structure: 82.5, impact: 55.0 },
  weights: { keyword: 0.4, semantic: 0.25, structure: 0.15, impact: 0.2 },
  missingKeywords: {
    unstatedButPresent: ['SQL'],
    genuineGaps: ['Data Structures and Algorithms', 'Docker'],
  },
  suggestions: [
    {
      before: 'Wrote Python scripts to backfill 2M rows into PostgreSQL, cutting manual work',
      after:
        'Automated backfills with Python scripts loading 2M rows into PostgreSQL, eliminating ~6 hours of weekly manual work',
      reason: 'Quantifies the outcome (hours saved) instead of a vague "cutting manual work".',
    },
    {
      before: 'Built a React dashboard that visualised API latency for 12 microservices',
      after:
        'Built a React dashboard visualising p95 API latency across 12 microservices, used daily by the on-call rotation',
      reason: 'Names the metric (p95) and the audience, strengthening relevance.',
    },
  ],
  seniority: 'new-grad',
  role: 'Software Engineer',
  company: 'Nimbus Labs',
  jdSource: 'jd',
  estimated: true,
  disclaimer:
    'This score is an estimate produced by deterministic checks plus one AI rubric call. ' +
    'Real ATS products rarely expose their scores, so treat this as directional feedback, not a hiring decision.',
};
