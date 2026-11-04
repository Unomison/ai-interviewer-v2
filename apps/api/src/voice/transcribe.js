/**
 * Milestone 9 — server-side speech-to-text via Groq Whisper (spec §4.7).
 *
 * The GROQ_API_KEY stays server-side (already a Render env var from M1).
 * It is never logged, never echoed in errors, and never required in tests —
 * fetchImpl/env are injectable. No audio is stored: the buffer is transcribed
 * and dropped.
 */

export const WHISPER_MODEL = 'whisper-large-v3-turbo';
export const WHISPER_URL = 'https://api.groq.com/openai/v1/audio/transcriptions';
/** ~2 minutes of opus audio, per the §4.7 contract (400 when exceeded). */
export const MAX_AUDIO_BYTES = 10 * 1024 * 1024;
export const TRANSCRIBE_TIMEOUT_MS = 60000;

/** Typed error so the route can map code → HTTP status honestly. */
export class TranscriptionError extends Error {
  constructor(code, message, status = 502) {
    super(message);
    this.name = 'TranscriptionError';
    this.code = code;
    this.status = status;
  }
}

/**
 * Transcribe an audio buffer with Groq Whisper.
 *
 * @param {object} args
 * @param {Buffer} args.buffer        raw audio bytes
 * @param {string} args.mimetype      e.g. "audio/webm;codecs=opus"
 * @param {string} [args.filename]
 * @param {string} [args.vocabularyHint]  spec §4.7: DP, memoization, O(n log n),
 *   BFS, mutex, plus the candidate's skills — passed as Whisper's `prompt`.
 * @param {object} [deps]  { env, fetchImpl, timeoutMs } — test seams
 * @returns {{ text, empty, provider, model }}
 * @throws {TranscriptionError}
 */
export async function transcribeAudio(
  { buffer, mimetype, filename = 'audio.webm', vocabularyHint = '' },
  deps = {},
) {
  const env = deps.env || process.env;
  const fetchImpl = deps.fetchImpl || fetch;
  const key = env.GROQ_API_KEY;

  if (!key) {
    throw new TranscriptionError(
      'transcription_unavailable',
      'Speech transcription is not configured on this server. The browser transcription fallback can be used instead.',
      503,
    );
  }
  if (!buffer || buffer.length === 0) {
    throw new TranscriptionError('invalid_request', 'No audio data received.', 400);
  }
  if (buffer.length > MAX_AUDIO_BYTES) {
    throw new TranscriptionError(
      'invalid_request',
      `Audio is too large (${(buffer.length / 1048576).toFixed(1)} MB). Keep recordings under about 2 minutes.`,
      400,
    );
  }

  const form = new FormData();
  form.append('file', new Blob([buffer], { type: mimetype || 'audio/webm' }), filename);
  form.append('model', WHISPER_MODEL);
  form.append('response_format', 'json');
  form.append('temperature', '0');
  if (vocabularyHint) form.append('prompt', String(vocabularyHint).slice(0, 224));

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), deps.timeoutMs || TRANSCRIBE_TIMEOUT_MS);
  let res;
  try {
    res = await fetchImpl(WHISPER_URL, {
      method: 'POST',
      // NOTE: the key travels only in this server-to-Groq request, never in logs.
      headers: { Authorization: `Bearer ${key}` },
      body: form,
      signal: ctrl.signal,
    });
  } catch (err) {
    throw new TranscriptionError(
      'transcription_unavailable',
      `Transcription service unreachable (${err.name === 'AbortError' ? 'timed out' : 'network error'}).`,
      503,
    );
  } finally {
    clearTimeout(timer);
  }

  if (res.status === 401 || res.status === 403) {
    throw new TranscriptionError(
      'transcription_unavailable',
      'The transcription key was rejected by the provider.',
      503,
    );
  }
  if (!res.ok) {
    throw new TranscriptionError(
      'transcription_failed',
      `Transcription failed (provider responded ${res.status}).`,
      502,
    );
  }
  const data = await res.json().catch(() => ({}));
  const text = (data.text || '').trim();
  return { text, empty: text.length === 0, provider: 'groq-whisper', model: WHISPER_MODEL };
}
