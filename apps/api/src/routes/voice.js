/**
 * Milestone 9 — voice routes (spec §4.7).
 *
 *   POST /api/voice/transcribe  multipart "audio" → { ok, text, empty, provider }
 *   GET  /api/voice/status      → which STT path the frontend should expect
 *
 * Contract: 400 on missing/oversized/wrong-type audio; 502/503 with honest
 * JSON when Groq is unreachable or the key is absent (the frontend then
 * offers the browser fallback). Never a bare 500.
 */
import { Router } from 'express';
import multer from 'multer';
import {
  transcribeAudio,
  TranscriptionError,
  WHISPER_MODEL,
  MAX_AUDIO_BYTES,
} from '../voice/index.js';

const router = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_AUDIO_BYTES, files: 1 },
  fileFilter: (_req, file, cb) => {
    const mt = (file.mimetype || '').toLowerCase();
    // MediaRecorder emits audio/webm (Chrome), audio/mp4 (Safari); accept the
    // common audio containers and nothing else.
    const ok =
      mt.startsWith('audio/') ||
      mt === 'video/webm' || // some browsers label webm blobs this way
      mt === 'application/octet-stream'; // Safari has been known to do this
    if (ok) return cb(null, true);
    cb(new TranscriptionError('invalid_request', `“${file.originalname}” is not an audio file.`, 400));
  },
});

router.post('/voice/transcribe', (req, res) => {
  upload.single('audio')(req, res, async (multerErr) => {
    try {
      if (multerErr) {
        if (multerErr.code === 'LIMIT_FILE_SIZE') {
          return res.status(400).json({
            ok: false,
            error: 'audio_too_large',
            message: 'Audio is too large. Keep recordings under about 2 minutes.',
          });
        }
        const status = multerErr instanceof TranscriptionError ? multerErr.status : 400;
        return res.status(status).json({
          ok: false,
          error: multerErr instanceof TranscriptionError ? multerErr.code : 'invalid_request',
          message: multerErr.message || 'Invalid audio upload.',
        });
      }
      if (!req.file || !req.file.buffer || req.file.buffer.length === 0) {
        return res.status(400).json({
          ok: false,
          error: 'invalid_request',
          message: 'No audio received. Attach the recording as the "audio" field.',
        });
      }
      const hint = typeof req.body?.vocabularyHint === 'string' ? req.body.vocabularyHint : '';
      const result = await transcribeAudio(
        {
          buffer: req.file.buffer,
          mimetype: req.file.mimetype,
          filename: req.file.originalname || 'audio.webm',
          vocabularyHint: hint,
        },
      );
      return res.json({ ok: true, ...result });
    } catch (err) {
      if (err instanceof TranscriptionError) {
        return res.status(err.status).json({ ok: false, error: err.code, message: err.message });
      }
      return res.status(502).json({
        ok: false,
        error: 'transcription_failed',
        message: 'Transcription failed unexpectedly.',
      });
    }
  });
});

router.get('/voice/status', (_req, res) => {
  const serverStt = !!process.env.GROQ_API_KEY;
  res.json({
    ok: true,
    // The frontend uses this to label the transcription path honestly
    // ("Using browser transcription" when the server path is unavailable).
    stt: serverStt ? 'groq-whisper' : 'browser-fallback',
    whisperModel: WHISPER_MODEL,
    maxAudioBytes: MAX_AUDIO_BYTES,
    maxMinutes: 3,
    tts: 'browser-speech-synthesis',
  });
});

export default router;
