/**
 * AI Interviewer API — Milestone 1 skeleton.
 *
 * Single Node/Express service (spec Section 3: one deployed backend fits free
 * hosting better than several). Later milestones add sessions, the interview
 * state machine, the LLM gateway, parsing, ATS, and the STT proxy.
 *
 * Hard rule: the server NEVER crashes because the database is missing or
 * unreachable. It starts, serves traffic, and reports the DB state in
 * /api/health so operators and the frontend can see it.
 */
import dotenv from 'dotenv';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';

import { connectDb } from './db.js';
import healthRouter from './routes/health.js';
import intakeRouter, { intakeErrorHandler } from './routes/intake.js';
import sampleRouter from './routes/sample.js';
import problemsRouter from './routes/problems.js';
import researchRouter from './routes/research.js';
import interviewRouter from './routes/interview.js';
import voiceRouter from './routes/voice.js';

dotenv.config();

const PORT = parseInt(process.env.PORT || '5000', 10);
// Comma-separated allow-list, e.g. "https://app.vercel.app,https://www.example.com".
// Locked to the frontend origin per spec Section 10 (never "*" in production).
const CORS_ORIGIN = (process.env.CORS_ORIGIN || 'http://localhost:5173')
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean);

// --- Structured JSON logs (spec Section 11; kept intentionally simple) ---
function log(level, msg, extra = {}) {
  console.log(JSON.stringify({ level, msg, time: new Date().toISOString(), ...extra }));
}
const logger = {
  info: (msg, extra) => log('info', msg, extra),
  warn: (msg, extra) => log('warn', msg, extra),
  error: (msg, extra) => log('error', msg, extra),
};

const app = express();

app.use(helmet());
// reflect() mirrors the request origin only if it is on the allow-list,
// so preflights from unknown origins are rejected.
app.use(cors({ origin: CORS_ORIGIN, credentials: true }));
app.use(express.json({ limit: '1mb' }));

app.use('/api', healthRouter);
app.use('/api', intakeRouter);
app.use('/api', sampleRouter);
app.use('/api', problemsRouter);
app.use('/api', researchRouter);
app.use('/api', interviewRouter);
app.use('/api', voiceRouter);

// IntakeError (friendly 4xx) → JSON before the generic 404.
app.use('/api', intakeErrorHandler);

// 404 for unknown API routes (JSON, not an HTML stack trace).
app.use('/api', (_req, res) => res.status(404).json({ error: 'not_found' }));

// Fire-and-forget: boot continues even if Mongo is down or absent.
// connectDb resolves to the current db status; it never throws.
connectDb(process.env.MONGODB_URI, logger).then((dbStatus) => {
  logger.info('database check finished', { db: dbStatus });
});

const server = app.listen(PORT, () => {
  logger.info('api listening', { port: PORT });
});

// Exported for the test suite (tests/ in the repo root).
export { app, server, logger };
