/**
 * Milestone 8 — interview engine routes (spec §§4.4–4.6).
 *
 *   POST /api/interview/start       { intakeToken } → session + intro message
 *   POST /api/interview/turn        { sessionToken, text } → next interviewer message
 *   GET  /api/interview/state?token=… → resumable state (refresh/crash)
 *   POST /api/interview/approach    { sessionToken, problemSlug, approachText } → judge → lock decision
 *   POST /api/interview/dsa-result  { sessionToken, problemSlug, language, code, results }
 *
 * Contract: 200 for valid input (even when the interview logic declines, e.g.
 * unknown session → 404 with a clear error body); 400 only for malformed
 * input; 503 when the interviewer LLM is unavailable. Never a bare 500 —
 * unexpected errors are caught and reported honestly.
 */
import { Router } from 'express';
import {
  startRequestSchema,
  turnRequestSchema,
  approachRequestSchema,
  dsaResultSchema,
  stateRequestSchema,
} from '../interview/schema.js';
import * as interview from '../interview/index.js';

const router = Router();

function badInput(res, issues) {
  return res.status(400).json({
    error: 'invalid_request',
    details: issues?.issues?.map((i) => i.message) || ['Invalid request body.'],
  });
}

function sendResult(res, result) {
  const statusByError = {
    intake_not_found: 404,
    session_not_found: 404,
    problem_not_found: 404,
    invalid_request: 400,
    invalid_transition: 409,
    not_in_dsa_round: 409,
    unknown_problem: 404,
    editor_locked: 409,
    interview_complete: 409,
    interviewer_unavailable: 503,
    planner_failed: 502,
  };
  if (!result.ok) {
    const status = statusByError[result.error] || 500;
    return res.status(status).json({ error: result.error, message: result.message || result.error });
  }
  return res.json(result);
}

router.post('/interview/start', async (req, res, next) => {
  try {
    const parsed = startRequestSchema.safeParse(req.body);
    if (!parsed.success) return badInput(res, parsed.error);
    sendResult(res, await interview.startInterview(parsed.data));
  } catch (err) {
    next(err);
  }
});

router.post('/interview/turn', async (req, res, next) => {
  try {
    const parsed = turnRequestSchema.safeParse(req.body);
    if (!parsed.success) return badInput(res, parsed.error);
    sendResult(res, await interview.takeTurn(parsed.data));
  } catch (err) {
    next(err);
  }
});

/**
 * Milestone 9 — POST /api/interview/turn/stream (Server-Sent Events).
 *
 * Same contract as /turn, but the interviewer reply streams as:
 *   event: chunk  data: {"text": "..."}        (speakable message deltas)
 *   event: done   data: {ok, message, openingMessage, currentRound,
 *                        transitionedTo, done, state}
 *   event: error  data: {ok:false, error, message}
 * A heartbeat comment every 15 s keeps free-tier proxies from idling the
 * connection. Post-processing is identical to /turn (see takeTurnStream).
 */
const STREAM_HEARTBEAT_MS = 15000;

router.post('/interview/turn/stream', async (req, res, next) => {
  try {
    const parsed = turnRequestSchema.safeParse(req.body);
    if (!parsed.success) return badInput(res, parsed.error);

    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no', // don't let proxies buffer the stream
    });
    if (typeof res.flushHeaders === 'function') res.flushHeaders();

    const send = (event, data) => {
      try {
        res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
      } catch {
        /* client went away */
      }
    };
    const heartbeat = setInterval(() => {
      try {
        res.write(': heartbeat\n\n');
      } catch {
        /* client went away */
      }
    }, STREAM_HEARTBEAT_MS);
    // Don't let the heartbeat hold the process open after the response ends.
    if (typeof heartbeat.unref === 'function') heartbeat.unref();
    req.on('close', () => clearInterval(heartbeat));

    try {
      for await (const ev of interview.takeTurnStream(parsed.data)) {
        if (ev.type === 'chunk') send('chunk', { text: ev.text });
        else if (ev.type === 'done') {
          send('done', {
            ok: true,
            message: ev.message,
            openingMessage: ev.openingMessage,
            currentRound: ev.currentRound,
            transitionedTo: ev.transitionedTo,
            done: ev.done,
            state: ev.state,
          });
        } else if (ev.type === 'error') {
          send('error', { ok: false, error: ev.error, message: ev.message });
        }
      }
    } catch (err) {
      send('error', {
        ok: false,
        error: 'interviewer_unavailable',
        message: `The interviewer is unavailable right now: ${err.message || err}`,
      });
    }
    clearInterval(heartbeat);
    res.end();
  } catch (err) {
    next(err);
  }
});

router.get('/interview/state', async (req, res, next) => {
  try {
    const parsed = stateRequestSchema.safeParse(req.query);
    if (!parsed.success) return badInput(res, parsed.error);
    sendResult(res, await interview.getState(parsed.data));
  } catch (err) {
    next(err);
  }
});

router.post('/interview/approach', async (req, res, next) => {
  try {
    const parsed = approachRequestSchema.safeParse(req.body);
    if (!parsed.success) return badInput(res, parsed.error);
    sendResult(res, await interview.submitApproach(parsed.data));
  } catch (err) {
    next(err);
  }
});

router.post('/interview/dsa-result', async (req, res, next) => {
  try {
    const parsed = dsaResultSchema.safeParse(req.body);
    if (!parsed.success) return badInput(res, parsed.error);
    sendResult(res, await interview.submitDsaResult(parsed.data));
  } catch (err) {
    next(err);
  }
});

export default router;
