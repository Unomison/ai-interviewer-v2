/**
 * Intake + ATS Zod schemas (Milestone 3, spec Sections 4.1–4.2).
 *
 * These are the contracts for resume.json / jd.json / the ATS report.
 * Every LLM-produced payload is validated against them; the gateway's
 * mock mode also generates from them, so the whole pipeline runs with
 * zero keys (ADR 002).
 */
import { z } from 'zod';

export const resumeJsonSchema = z.object({
  education: z
    .array(
      z.object({
        institution: z.string(),
        degree: z.string(),
        field: z.string().optional(),
        start: z.string().optional(),
        end: z.string().optional(),
      }),
    )
    .default([]),
  experience: z
    .array(
      z.object({
        company: z.string(),
        title: z.string(),
        start: z.string().optional(),
        end: z.string().optional(),
        bullets: z.array(z.string()).default([]),
      }),
    )
    .default([]),
  projects: z
    .array(
      z.object({
        name: z.string(),
        tech: z.array(z.string()).default([]),
        description: z.string().optional(),
        metrics: z.array(z.string()).default([]),
      }),
    )
    .default([]),
  skills: z.array(z.string()).default([]),
  certifications: z.array(z.string()).default([]),
});

export const jdCompanySchema = z.object({
  /** Company name when the JD states exactly one company. */
  name: z.string().nullable(),
  /** True when the JD mentions several companies or the name is unclear. */
  ambiguous: z.boolean().default(false),
});

export const jdJsonSchema = z.object({
  roleTitle: z.string(),
  seniority: z.enum(['intern', 'new-grad', 'mid', 'senior', 'unknown']).default('unknown'),
  company: jdCompanySchema.default({ name: null, ambiguous: false }),
  requiredSkills: z.array(z.string()).default([]),
  preferredSkills: z.array(z.string()).default([]),
  responsibilities: z.array(z.string()).default([]),
  domainKeywords: z.array(z.string()).default([]),
});

/** Single LLM rubric call behind the impact-quality ATS part (spec 4.2). */
export const atsRubricSchema = z.object({
  score: z.number().min(0).max(100),
  quantifiedResults: z.number().min(0).max(100),
  actionVerbs: z.number().min(0).max(100),
  projectRelevance: z.number().min(0).max(100),
  suggestions: z
    .array(
      z.object({
        before: z.string(),
        after: z.string(),
        reason: z.string(),
      }),
    )
    .max(8)
    .default([]),
});

export const atsReportSchema = z.object({
  totalScore: z.number().min(0).max(100),
  breakdown: z.object({
    keyword: z.number().min(0).max(100),
    semantic: z.number().min(0).max(100),
    structure: z.number().min(0).max(100),
    impact: z.number().min(0).max(100),
  }),
  weights: z.object({
    keyword: z.number(),
    semantic: z.number(),
    structure: z.number(),
    impact: z.number(),
  }),
  missingKeywords: z.object({
    /** Skills the resume evidences but never states outright. */
    unstatedButPresent: z.array(z.string()),
    /** Skills with no evidence in the resume. Never suggested as claims. */
    genuineGaps: z.array(z.string()),
  }),
  suggestions: z.array(
    z.object({
      before: z.string(),
      after: z.string(),
      reason: z.string(),
    }),
  ),
  seniority: z.string(),
  role: z.string(),
  company: z.string().nullable(),
  jdSource: z.enum(['jd', 'role-template']),
  /** Always true in v1: real ATS products rarely expose scores. */
  estimated: z.boolean(),
  disclaimer: z.string(),
});

export const consentSchema = z.object({
  consent: z.literal(true, {
    errorMap: () => ({ message: 'Consent is required to process your resume.' }),
  }),
  /** Version of the consent notice the visitor saw. */
  noticeVersion: z.string().default('v1'),
});

/** What the API returns after the intake steps (never the raw file). */
export const intakeSummarySchema = z.object({
  token: z.string(),
  hasResume: z.boolean(),
  hasJd: z.boolean(),
  company: z.string().nullable(),
  companySource: z.enum(['jd', 'resume', 'user']).nullable(),
  role: z.string().nullable(),
  seniority: z.string().nullable(),
  needsInput: z.array(z.string()),
});
