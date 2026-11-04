/**
 * Intake routes (Milestone 3, spec Sections 4.1–4.2 + privacy Section 10).
 *
 *  POST /api/intake/consent  — record consent, mint a guest session token
 *  POST /api/intake/resume   — multipart PDF/DOCX upload → redact → 1 LLM parse call
 *  POST /api/intake/jd       — pasted text or file → 1 LLM parse call
 *  POST /api/ats/report      — hybrid ATS score (deterministic + 1 rubric call)
 *  DELETE /api/intake/session — "delete my data" (spec Section 10)
 *
 * Privacy: consent is required before any upload; PII is redacted BEFORE any
 * model call; the raw file buffer is discarded right after parsing and is
 * never stored; sessions auto-delete via the TTL index in store.js.
 */
import { Router } from 'express';
import multer from 'multer';
import crypto from 'node:crypto';
import { guestSessionSchema } from '@ai-interviewer/schemas';

import { gateway } from '../llm/index.js';
import { extractText, IntakeError } from '../intake/extract.js';
import { redactPII } from '../intake/redact.js';
import { parseResume, parseJd } from '../intake/parse.js';
import { resolveCompany } from '../intake/company.js';
import { resolveRoleSeniority } from '../intake/role.js';
import { buildAtsReport } from '../intake/ats.js';
import { ROLE_TEMPLATES, GENERIC_TEMPLATE_KEY } from '../intake/atsConfig.js';
import {
  createSession,
  getSession,
  updateSession,
  deleteSession,
} from '../intake/store.js';
import { consentSchema } from '../intake/schemas.js';

const router = Router();

const MAX_FILE_BYTES = 2 * 1024 * 1024; // spec 4.1: max about 2 MB

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FILE_BYTES, files: 1 },
  fileFilter: (_req, file, cb) => {
    const ext = (file.originalname.split('.').pop() || '').toLowerCase();
    const okMime =
      file.mimetype === 'application/pdf' ||
      file.mimetype === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
      file.mimetype === 'application/octet-stream'; // some browsers send this for .docx
    if ((ext === 'pdf' || ext === 'docx') && okMime) return cb(null, true);
    cb(
      new IntakeError(
        'unsupported_type',
        `“${file.originalname}” is not a PDF or DOCX file. Please upload one of those.`,
      ),
    );
  },
});

function log(level, msg, extra = {}) {
  console.log(JSON.stringify({ level, msg, time: new Date().toISOString(), ...extra }));
}

function sessionToken(req) {
  return req.get('x-session-token') || req.body?.sessionToken || null;
}

async function requireSession(req, res, next) {
  try {
    const session = await getSession(sessionToken(req));
    if (!session) {
      return res.status(401).json({
        error: 'no_session',
        message: 'Your session expired or is missing. Please start again from the beginning.',
      });
    }
    req.intakeSession = session;
    next();
  } catch (err) {
    next(err);
  }
}

/** Build a pseudo-JD from a role template when the visitor skips the JD. */
export function pseudoJd(role) {
  const key = (role || '').toLowerCase().trim();
  const tpl = ROLE_TEMPLATES[key] || ROLE_TEMPLATES[GENERIC_TEMPLATE_KEY];
  return {
    ...tpl,
    company: { name: null, ambiguous: false },
    seniority: 'unknown',
  };
}

// --- Consent ---------------------------------------------------------------

router.post('/intake/consent', async (req, res, next) => {
  try {
    const parsed = consentSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        error: 'consent_required',
        message:
          'Please accept the consent notice so we can process your resume. ' +
          'Your redacted resume text is processed by third-party AI services; ' +
          'nothing is stored beyond the auto-deleting session.',
      });
    }
    const token = crypto.randomBytes(32).toString('hex'); // 64 chars, unguessable
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    // Validate the session shape against the shared contract.
    guestSessionSchema.parse({ token, expiresAt, preferences: {} });
    await createSession({ token, consent: true, noticeVersion: parsed.data.noticeVersion });
    log('info', 'intake consent recorded', { token: token.slice(0, 8) });
    res.status(201).json({ token, expiresAt: expiresAt.toISOString() });
  } catch (err) {
    next(err);
  }
});

// --- Resume upload + parse -------------------------------------------------

router.post('/intake/resume', requireSession, (req, res, next) => {
  upload.single('resume')(req, res, async (multerErr) => {
    try {
      if (multerErr) {
        if (multerErr.code === 'LIMIT_FILE_SIZE') {
          return res.status(400).json({
            error: 'file_too_large',
            message: 'That file is over 2 MB. Please upload a smaller resume.',
          });
        }
        throw multerErr;
      }
      if (!req.file) {
        return res.status(400).json({ error: 'no_file', message: 'Attach your resume as a PDF or DOCX file.' });
      }
      const { buffer, mimetype, originalname } = req.file;

      // 1. Extract text (enforces page count + scanned-PDF rejection).
      const { text: rawText, pages, kind } = await extractText(buffer, {
        mimetype,
        filename: originalname,
      });

      // 2. Redact PII BEFORE any model call (spec Section 10 — hard rule).
      const { redacted, hadContact } = redactPII(rawText);

      // 3. Exactly one LLM call → resume.json (spec 4.1).
      const resumeJson = await parseResume(redacted, gateway);

      // 4. Discard the raw file buffer immediately; never store it.
      req.file.buffer = null;

      await updateSession(req.intakeSession.token, {
        resumeJson,
        redactedText: redacted,
        rawText,
        hadContact,
      });
      log('info', 'resume parsed', { token: req.intakeSession.token.slice(0, 8), kind, pages });
      res.json({ resume: resumeJson, pages, kind });
    } catch (err) {
      next(err);
    }
  });
});

// --- JD (pasted text or file) + parse ---------------------------------------

router.post('/intake/jd', requireSession, (req, res, next) => {
  upload.single('jd')(req, res, async (multerErr) => {
    try {
      if (multerErr) {
        if (multerErr.code === 'LIMIT_FILE_SIZE') {
          return res.status(400).json({
            error: 'file_too_large',
            message: 'That file is over 2 MB. Please paste the job description as text instead.',
          });
        }
        throw multerErr;
      }
      let jdText = typeof req.body?.text === 'string' ? req.body.text.trim() : '';
      if (!jdText && req.file) {
        const extracted = await extractText(req.file.buffer, {
          mimetype: req.file.mimetype,
          filename: req.file.originalname,
        });
        jdText = extracted.text;
        req.file.buffer = null;
      }
      if (!jdText || jdText.replace(/\s/g, '').length < 50) {
        return res.status(400).json({
          error: 'jd_too_short',
          message: 'Please paste the full job description text (at least a few sentences).',
        });
      }

      // Exactly one LLM call → jd.json (spec 4.1).
      const jdJson = await parseJd(jdText, gateway);

      const session = await getSession(req.intakeSession.token);
      const company = resolveCompany(jdJson, session.resumeJson);
      const { role, seniority, senioritySource, needsInput } = resolveRoleSeniority(
        jdJson,
        session.resumeJson,
      );
      const allNeedsInput = [
        ...(company.needsInput ? ['company'] : []),
        ...needsInput,
      ];

      await updateSession(req.intakeSession.token, {
        jdJson,
        company: company.company,
        companySource: company.source,
        role,
        seniority,
      });
      log('info', 'jd parsed', { token: req.intakeSession.token.slice(0, 8) });
      res.json({
        jd: jdJson,
        company: company.company,
        companySource: company.source,
        role,
        seniority,
        senioritySource,
        needsInput: allNeedsInput,
      });
    } catch (err) {
      next(err);
    }
  });
});

// --- ATS report ---------------------------------------------------------------

router.post('/ats/report', requireSession, async (req, res, next) => {
  try {
    const session = await getSession(req.intakeSession.token);
    if (!session?.resumeJson) {
      return res.status(400).json({
        error: 'no_resume',
        message: 'Upload your resume first — the ATS report needs it.',
      });
    }
    // The review step may override the resolved company/role/seniority.
    const company =
      typeof req.body?.company === 'string' ? req.body.company.trim() || null : session.company;
    const role = typeof req.body?.role === 'string' && req.body.role.trim()
      ? req.body.role.trim()
      : session.role || 'Software Engineer';
    const seniority = typeof req.body?.seniority === 'string' && req.body.seniority
      ? req.body.seniority
      : session.seniority || 'mid';

    let jd = session.jdJson;
    let jdSource = 'jd';
    if (!jd) {
      jd = pseudoJd(role);
      jdSource = 'role-template';
    }

    const report = await buildAtsReport({
      resumeJson: session.resumeJson,
      jd,
      jdSource,
      rawText: session.rawText || '',
      redactedText: session.redactedText || '',
      hadContact: !!session.hadContact,
      role,
      seniority,
      company,
      gw: gateway,
    });

    await updateSession(req.intakeSession.token, {
      atsReport: report,
      company,
      companySource: req.body?.company ? 'user' : session.companySource,
      role,
      seniority,
    });
    log('info', 'ats report built', {
      token: req.intakeSession.token.slice(0, 8),
      totalScore: report.totalScore,
      jdSource,
    });
    res.json({ report });
  } catch (err) {
    next(err);
  }
});

// --- Delete my data (spec Section 10) -----------------------------------------

router.delete('/intake/session', requireSession, async (req, res, next) => {
  try {
    await deleteSession(req.intakeSession.token);
    log('info', 'intake session deleted by visitor', {
      token: req.intakeSession.token.slice(0, 8),
    });
    res.json({ deleted: true });
  } catch (err) {
    next(err);
  }
});

// --- Error mapping ------------------------------------------------------------

/** IntakeError → 400 with the friendly message; multer leftovers → 400. */
export function intakeErrorHandler(err, _req, res, next) {
  if (err instanceof IntakeError) {
    return res.status(err.status).json({ error: err.code, message: err.message });
  }
  if (err && err.code === 'LIMIT_FILE_SIZE') {
    return res.status(400).json({ error: 'file_too_large', message: 'That file is over 2 MB.' });
  }
  next(err);
}

export default router;
