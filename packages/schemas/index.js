/**
 * Shared Zod schemas — single source of truth for API contracts.
 *
 * Spec Section 3: request/response contracts live in shared JSON schemas,
 * validated with Zod (Node) and Pydantic (Python tools). The Python mirror
 * arrives with the offline tooling; both must validate the same shapes.
 *
 * Milestone 1 ships only the smallest useful starting example:
 * guestSession (spec Section 5 — no users collection, guests only).
 */
import { z } from 'zod';

/**
 * A guest session: opaque, unguessable token + expiry.
 * TTL indexes on expiresAt auto-delete session data (spec Section 2/5).
 */
export const guestSessionSchema = z.object({
  /** Opaque session token — random and unguessable, never sequential. */
  token: z.string().min(32).max(128),
  /** When the session (and its TTL-managed data) expires. */
  expiresAt: z.coerce.date(),
  /** Client preferences, e.g. { audio: true, transcriptVisible: true }. */
  preferences: z
    .object({
      audio: z.boolean().default(true),
      transcriptVisible: z.boolean().default(true),
    })
    .default({}),
  createdAt: z.coerce.date().default(() => new Date()),
});

export const healthResponseSchema = z.object({
  status: z.literal('ok'),
  db: z.enum(['connected', 'not_configured', 'unreachable']),
  time: z.string().datetime(),
});

export const errorResponseSchema = z.object({
  error: z.string(),
  message: z.string().optional(),
});
