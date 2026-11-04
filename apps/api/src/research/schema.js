/**
 * Milestone 7 — knowledge-base JSON schema (spec Section 4.3).
 *
 * The KB document is what the M8 interview planner consumes: company facts
 * plus *interview-relevant angles* (company-specific topics an interviewer
 * could probe, e.g. "optical networking" for Nokia). Every angle and fact
 * keeps its source URL; nothing is presented as insider fact.
 */
import { z } from 'zod';

export const kbSourceSchema = z.object({
  url: z.string().url(),
  title: z.string().max(200).default(''),
});

export const interviewAngleSchema = z.object({
  /** Company-specific topic the interviewer could probe. */
  topic: z.string().min(2).max(160),
  /** Why this topic matters for interviews at this company/role. */
  why: z.string().min(2).max(500),
  /** Public pages backing this angle. */
  sourceUrls: z.array(z.string().url()).default([]),
});

export const kbJsonSchema = z.object({
  company: z.string().min(1).max(160),
  role: z.string().max(160).nullable().default(null),
  /** 2–4 sentence overview, from public pages. */
  overview: z.string().min(10).max(2000),
  /** Tech-stack signals seen on public pages (languages, platforms, infra). */
  techStack: z.array(z.string().min(1).max(80)).max(30).default([]),
  /** Engineering practices / ways of working mentioned publicly. */
  engineeringPractices: z.array(z.string().min(2).max(200)).max(20).default([]),
  /** Values / culture signals from public pages. */
  culture: z.array(z.string().min(2).max(200)).max(20).default([]),
  /** Recent public developments (launches, news) with recency implied. */
  recentDevelopments: z.array(z.string().min(2).max(300)).max(10).default([]),
  /** Planner-oriented: topics worth probing in the interview. */
  interviewAngles: z.array(interviewAngleSchema).max(12).default([]),
  /** Every source the KB was built from. */
  sources: z.array(kbSourceSchema).max(20).default([]),
  researchedAt: z.string().datetime(),
  /** Honesty label: how this KB was produced. */
  provenance: z.enum(['fresh', 'cache', 'partial']).default('fresh'),
});

export const researchRequestSchema = z.object({
  company: z.string().trim().min(1).max(120),
  role: z.string().trim().max(120).optional().default(''),
});
