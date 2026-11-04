/**
 * Milestone 8 — interview orchestrator (spec §§4.4–4.6).
 *
 * Coordinates planner → state machine → interviewer loop → approach judge →
 * DSA submissions. Every public function returns { ok: true, ... } or
 * { ok: false, error, message? } — this layer never throws on bad input.
 * Sessions are persisted on every transition (spec §4.4) so an interview
 * survives a server restart; GET /interview/state resumes it.
 *
 * Client-safety: reference solutions, oracles, wrong solutions and the full
 * precomputed hint ladder NEVER leave the server. The approach endpoint
 * serves at most one hint per call; the state endpoint strips hints.
 */
import { gateway } from '../llm/index.js';
import { getSession as getIntakeSession } from '../intake/store.js';
import { researchCompany } from '../research/index.js';
import { getFullProblem, toClientSafeDsaProblem } from '../problems/index.js';
import { planInterview } from './planner.js';
import { generateTurn } from './interviewer.js';
import { judgeApproach } from './judge.js';
import { nextRound, checkTransition, applyJudgeVerdict, scoreDsaProblem, MAX_HINTS } from './machine.js';
import * as store from './store.js';

function gwOf(deps) {
  return (deps && deps.gateway) || gateway;
}

/** Client-safe projection of one DSA problem (no hints array, no solutions). */
function clientDsaProblem(full) {
  if (!full) return null;
  const safe = toClientSafeDsaProblem(full);
  return safe;
}

function clientDsaState(session) {
  const out = {};
  for (const [slug, d] of Object.entries(session.dsa || {})) {
    out[slug] = {
      slug,
      title: d.title,
      state: d.state,
      hintsUsed: d.hintsUsed,
      unlocked: d.unlocked,
      unlockReason: d.unlockReason,
      submissions: (d.submissions || []).length,
      lastVerdict: (d.submissions || []).slice(-1)[0]?.results?.verdict || null,
      score: d.score,
    };
  }
  return out;
}

/** Everything the frontend needs; never includes solutions or hint ladders. */
export async function clientState(session) {
  const active = session.activeProblemSlug ? await getFullProblem(session.activeProblemSlug) : null;
  return {
    token: session.token,
    status: session.status,
    currentRound: session.currentRound,
    plan: (session.plan || []).map((r) => ({
      type: r.type,
      goals: r.goals || [],
      numQuestions: r.numQuestions,
      timeBudgetMin: r.timeBudgetMin,
      focusAreas: r.focusAreas || [],
      topics: r.topics || [],
      themes: r.themes || [],
      problems: (r.problems || []).map((p) => ({ slug: p.slug, title: p.title })),
    })),
    rounds: session.rounds,
    transcript: session.transcript,
    dsa: clientDsaState(session),
    activeProblem: clientDsaProblem(active),
    done: session.status === 'done',
    company: session.company,
    role: session.role,
    seniority: session.seniority,
  };
}

async function setRound(sessionToken, to) {
  const session = await store.getSession(sessionToken);
  const check = checkTransition(session.currentRound, to);
  if (!check.ok) return { ok: false, error: 'invalid_transition', message: check.reason };
  const rounds = { ...session.rounds };
  rounds[session.currentRound] = { ...rounds[session.currentRound], status: 'done', endedAt: new Date() };
  if (to !== 'done') {
    rounds[to] = { ...rounds[to], status: 'active', startedAt: new Date() };
  }
  const patch = { rounds, currentRound: to === 'done' ? session.currentRound : to };
  if (to === 'done') {
    patch.status = 'done';
    patch.endedAt = new Date();
  }
  // Entering DSA: activate the first problem.
  if (to === 'dsa') {
    const firstSlug = Object.keys(session.dsa || {})[0] || null;
    patch.activeProblemSlug = firstSlug;
    if (firstSlug) {
      const dsa = { ...session.dsa };
      dsa[firstSlug] = { ...dsa[firstSlug], state: 'approach', startedAt: new Date() };
      patch.dsa = dsa;
    }
  }
  const fresh = await store.updateSession(sessionToken, patch);
  return { ok: true, session: fresh };
}

/**
 * POST /api/interview/start — { intakeToken }.
 * Runs research (best-effort, never throws) → planner → creates the session
 * → produces the intro opening via the interviewer.
 */
export async function startInterview({ intakeToken }, deps = {}) {
  const gw = gwOf(deps);
  if (!intakeToken || typeof intakeToken !== 'string') {
    return { ok: false, error: 'invalid_request', message: 'intakeToken is required.' };
  }
  const intake = await getIntakeSession(intakeToken);
  if (!intake) return { ok: false, error: 'intake_not_found', message: 'No intake session for that token.' };

  // Research: best effort, never blocks or throws the start.
  let kb = null;
  let kbSource = 'none';
  if (intake.company) {
    try {
      const r = await researchCompany({ company: intake.company, role: intake.role || '' });
      if (r && r.kb) {
        kb = r.kb;
        kbSource = r.outcome || 'fresh';
      } else if (r) {
        kbSource = r.outcome || 'none';
      }
    } catch {
      kbSource = 'failed';
    }
  }

  let plan;
  try {
    plan = await planInterview(
      {
        resumeJson: intake.resumeJson,
        jdJson: intake.jdJson,
        kb,
        atsGaps: intake.atsReport?.missingKeywords,
        seniority: intake.seniority,
        company: intake.company,
        role: intake.role,
      },
      gw,
    );
  } catch (err) {
    return { ok: false, error: 'planner_failed', message: `Could not plan the interview: ${err.message}` };
  }

  let session = await store.createSession({
    intakeToken,
    plan,
    company: intake.company,
    role: intake.role,
    seniority: intake.seniority,
    kbSource,
  });

  let opening;
  try {
    opening = await generateTurn({ session, candidateText: null }, gw);
  } catch (err) {
    return { ok: false, error: 'interviewer_unavailable', message: `Interviewer failed to start: ${err.message}` };
  }
  await store.appendTurn(session.token, 'interviewer', opening.message, session.currentRound);
  session = await store.getSession(session.token);
  return { ok: true, sessionToken: session.token, message: opening.message, state: await clientState(session) };
}

/** Apply the interviewer's turn flags (endRound / advanceProblem) to the session. */
async function applyTurnFlags(sessionToken, turn) {
  let session = await store.getSession(sessionToken);
  let transitionedTo = null;
  if (turn.advanceProblem && session.currentRound === 'dsa') {
    const slugs = Object.keys(session.dsa || {});
    const idx = slugs.indexOf(session.activeProblemSlug);
    const nextSlug = slugs[idx + 1] || null;
    const dsa = { ...session.dsa };
    if (session.activeProblemSlug && dsa[session.activeProblemSlug]) {
      dsa[session.activeProblemSlug] = {
        ...dsa[session.activeProblemSlug],
        state: 'scored',
        scoredAt: new Date(),
        score: scoreDsaProblem(dsa[session.activeProblemSlug]),
      };
    }
    if (nextSlug) {
      dsa[nextSlug] = { ...dsa[nextSlug], state: 'approach', startedAt: new Date() };
    }
    session = await store.updateSession(sessionToken, { dsa, activeProblemSlug: nextSlug });
  }
  if (turn.endRound) {
    if (turn.roundAssessment) {
      const rounds = { ...session.rounds };
      rounds[session.currentRound] = { ...rounds[session.currentRound], assessment: turn.roundAssessment };
      session = await store.updateSession(sessionToken, { rounds });
    }
    const nxt = nextRound(session.currentRound);
    const res = await setRound(sessionToken, nxt);
    if (!res.ok) return { ok: false, error: res.error, message: res.message };
    session = res.session;
    transitionedTo = nxt;
  }
  return { ok: true, session, transitionedTo };
}

/**
 * POST /api/interview/turn — { sessionToken, text }.
 * One interviewer LLM call per turn (call-budget discipline, spec §4.5).
 */
export async function takeTurn({ sessionToken, text }, deps = {}) {
  const gw = gwOf(deps);
  if (!sessionToken || typeof text !== 'string' || text.trim().length === 0) {
    return { ok: false, error: 'invalid_request', message: 'sessionToken and non-empty text are required.' };
  }
  let session = await store.getSession(sessionToken);
  if (!session) return { ok: false, error: 'session_not_found' };
  if (session.status === 'done') return { ok: false, error: 'interview_complete', message: 'This interview is already complete.' };

  await store.appendTurn(sessionToken, 'candidate', text.trim(), session.currentRound);
  session = await store.getSession(sessionToken);

  let turn;
  try {
    turn = await generateTurn({ session, candidateText: text.trim() }, gw);
  } catch (err) {
    return { ok: false, error: 'interviewer_unavailable', message: `The interviewer is unavailable right now: ${err.message}` };
  }
  await store.appendTurn(sessionToken, 'interviewer', turn.message, session.currentRound);

  const applied = await applyTurnFlags(sessionToken, turn);
  if (!applied.ok) return applied;
  session = applied.session;

  // If we just transitioned, the interviewer opens the new round (one extra call).
  let openingMessage = null;
  if (applied.transitionedTo && applied.transitionedTo !== 'done') {
    try {
      const opening = await generateTurn({ session, candidateText: null }, gw);
      await store.appendTurn(sessionToken, 'interviewer', opening.message, session.currentRound);
      openingMessage = opening.message;
      session = await store.getSession(sessionToken);
    } catch {
      // Non-fatal: the round transition itself is persisted; the next turn opens it.
    }
  }

  return {
    ok: true,
    message: turn.message,
    openingMessage,
    currentRound: session.currentRound,
    transitionedTo: applied.transitionedTo,
    done: session.status === 'done',
    state: await clientState(session),
  };
}

/**
 * POST /api/interview/approach — { sessionToken, problemSlug, approachText }.
 * Real approach judge (spec §4.6) driving the editor lock.
 */
export async function submitApproach({ sessionToken, problemSlug, approachText }, deps = {}) {
  const gw = gwOf(deps);
  if (!sessionToken || !problemSlug || typeof approachText !== 'string' || approachText.trim().length === 0) {
    return { ok: false, error: 'invalid_request', message: 'sessionToken, problemSlug and non-empty approachText are required.' };
  }
  const session = await store.getSession(sessionToken);
  if (!session) return { ok: false, error: 'session_not_found' };
  if (session.currentRound !== 'dsa') return { ok: false, error: 'not_in_dsa_round', message: 'Approach explanations are only judged during the DSA round.' };
  const dsa = session.dsa?.[problemSlug];
  if (!dsa) return { ok: false, error: 'unknown_problem' };
  if (dsa.unlocked) {
    return { ok: true, accepted: true, alreadyUnlocked: true, unlocked: true, hintsUsed: dsa.hintsUsed, feedback: 'Editor is already unlocked.' };
  }
  const full = await getFullProblem(problemSlug);
  if (!full) return { ok: false, error: 'problem_not_found' };

  let judged;
  try {
    judged = await judgeApproach({ problem: full, approachText: approachText.trim(), hintsGiven: dsa.hintsGiven || [] }, gw);
  } catch {
    // Fallback (documented): never hard-lock the candidate on a judge failure.
    const patch = { unlocked: true, unlockReason: 'judge-error', state: 'coding', approachAttempts: (dsa.approachAttempts || 0) + 1 };
    const dsaMap = { ...session.dsa, [problemSlug]: { ...dsa, ...patch } };
    await store.updateSession(sessionToken, { dsa: dsaMap });
    await store.appendTurn(sessionToken, 'candidate', `[approach] ${approachText.trim()}`, 'dsa');
    await store.appendTurn(sessionToken, 'interviewer', 'Thanks — the editor is unlocked. Write your solution whenever you are ready.', 'dsa');
    return { ok: true, accepted: true, unlocked: true, judgeError: true, hintsUsed: dsa.hintsUsed, feedback: 'The approach judge was unavailable, so the editor has been unlocked. Good luck!' };
  }

  const nextHint = judged.verdict === 'hint' ? (full.hints || [])[dsa.hintsUsed] || null : null;
  const outcome = applyJudgeVerdict(dsa, judged.verdict, nextHint);
  const patch = {
    ...outcome.patch,
    approachAttempts: (dsa.approachAttempts || 0) + 1,
    judgeVerdicts: [...(dsa.judgeVerdicts || []), { verdict: judged.verdict, feedback: judged.feedback, at: new Date() }],
  };
  const dsaMap = { ...session.dsa, [problemSlug]: { ...dsa, ...patch } };
  await store.updateSession(sessionToken, { dsa: dsaMap });
  await store.appendTurn(sessionToken, 'candidate', `[approach] ${approachText.trim()}`, 'dsa');
  const interviewerLine = outcome.hintToServe
    ? `${judged.feedback}\n\nHint ${dsa.hintsUsed + 1}/${MAX_HINTS}: ${outcome.hintToServe}`
    : judged.feedback;
  await store.appendTurn(sessionToken, 'interviewer', interviewerLine, 'dsa');

  return {
    ok: true,
    accepted: outcome.unlocked,
    unlocked: outcome.unlocked,
    unlockReason: outcome.unlockReason,
    feedback: judged.feedback,
    hint: outcome.hintToServe,
    hintsUsed: patch.hintsUsed !== undefined ? patch.hintsUsed : dsa.hintsUsed,
    matchesOptimal: judged.matchesOptimal,
    bruteForceOnly: judged.bruteForceOnly,
  };
}

/**
 * POST /api/interview/dsa-result — { sessionToken, problemSlug, language, code, results }.
 * Records the in-browser test run; the interviewer reacts (follow-ups or move on).
 */
export async function submitDsaResult({ sessionToken, problemSlug, language, code, results }, deps = {}) {
  const gw = gwOf(deps);
  if (!sessionToken || !problemSlug || !language || !code || !results) {
    return { ok: false, error: 'invalid_request', message: 'sessionToken, problemSlug, language, code and results are required.' };
  }
  const session = await store.getSession(sessionToken);
  if (!session) return { ok: false, error: 'session_not_found' };
  const dsa = session.dsa?.[problemSlug];
  if (!dsa) return { ok: false, error: 'unknown_problem' };
  if (!dsa.unlocked) return { ok: false, error: 'editor_locked', message: 'Unlock the editor with an accepted approach first.' };

  const submission = { language, code, results, at: new Date() };
  const dsaMap = { ...session.dsa, [problemSlug]: { ...dsa, state: 'submitted', submissions: [...(dsa.submissions || []), submission] } };
  let fresh = await store.updateSession(sessionToken, { dsa: dsaMap });
  await store.appendTurn(
    sessionToken,
    'candidate',
    `[code submission: ${language}] ${results.passed}/${results.total} tests passed (${results.verdict})`,
    'dsa',
  );

  const extraContext =
    `The candidate just submitted ${language} code for "${dsa.title}": ` +
    `${results.passed}/${results.total} tests passed, verdict=${results.verdict}.` +
    (results.firstFailure ? ` First failing case: ${JSON.stringify(results.firstFailure).slice(0, 400)}.` : '') +
    ` React briefly: if all pass, ask 1-2 follow-ups (complexity, edge cases) then set advanceProblem=true when ready ` +
    `to move on (or endRound=true if the DSA round should end). If tests fail, point at the failing case without revealing the fix.`;

  let turn;
  try {
    fresh = await store.getSession(sessionToken);
    turn = await generateTurn({ session: fresh, candidateText: null, extraContext }, gw);
  } catch (err) {
    return { ok: true, recorded: true, reactionError: true, message: 'Submission recorded. The interviewer will react on your next message.' };
  }
  await store.appendTurn(sessionToken, 'interviewer', turn.message, 'dsa');
  const applied = await applyTurnFlags(sessionToken, turn);
  if (!applied.ok) return { ok: true, recorded: true, message: turn.message };
  fresh = applied.session;

  return {
    ok: true,
    recorded: true,
    message: turn.message,
    transitionedTo: applied.transitionedTo,
    state: await clientState(fresh),
  };
}

/** GET /api/interview/state — resume after refresh/crash (spec §4.4). */
export async function getState({ token }) {
  if (!token) return { ok: false, error: 'invalid_request', message: 'token is required.' };
  const session = await store.getSession(token);
  if (!session) return { ok: false, error: 'session_not_found' };
  return { ok: true, state: await clientState(session) };
}
