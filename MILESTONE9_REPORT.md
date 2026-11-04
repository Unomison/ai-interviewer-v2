# Milestone 9 — Voice interview (spec §4.7): report

Date: 2026-11-04. Status: **DONE** (with the honest E2E caveat below).

## What was built

Voice is a transport layer over the M8 text engine — speech in → text → the
same turn loop → streamed text out → speech out. Every voice turn is recorded
in the server transcript as text, so M10 needs no voice-specific handling.

**Backend** (`apps/api/src/voice/`, `apps/api/src/routes/voice.js`)
- `POST /api/voice/transcribe` — multipart `audio` blob → Groq Whisper
  (`whisper-large-v3-turbo`, server-side `GROQ_API_KEY`, never logged).
  Vocabulary hint (role/company + spec terms) passed as Whisper's `prompt`.
  400 on missing/oversized (>10 MB)/wrong-type audio; 502/503 with honest
  JSON when Groq is unreachable or the key is absent; never a bare 500.
  Audio is transcribed and dropped — never stored.
- `GET /api/voice/status` — tells the frontend which STT path to expect
  (`groq-whisper` vs `browser-fallback`) so the UI labels it honestly.
- `POST /api/interview/turn/stream` (SSE) — the interviewer reply streams
  as `event: chunk` (speakable message-text deltas extracted from the
  partial JSON without ever parsing it), then `event: done` with the same
  payload as `/turn`, or `event: error`. 15 s heartbeat for free-tier
  proxies. Post-processing (transcript, round flags, transitions) is
  identical to `takeTurn` — streamed and typed turns leave the same session.

**Frontend** (`apps/web/src/voice/`)
- `speech.js` — pure helpers: `splitSentences()` (abbreviations, decimals,
  initials, ellipsis safe), `stripUnspeakable()` (never speak code blocks /
  inline code / URLs — spec §4.7), `SpeechQueue` (ordered queue over an
  injected synth adapter; mute/stop semantics).
- `micMachine.js` — pure reducer: `idle → requesting → recording →
  transcribing → sending → idle`, plus denied / error / cancel-discard /
  too-short / empty-transcript ("Didn't catch that, try again") paths.
  Recording starts ONLY on an explicit tap — no effect ever starts it.
- `useVoiceInterview.js` — MediaRecorder capture (webm/opus, Safari mp4
  fallback) → server Whisper; Web Speech API live-capture fallback when the
  server path is unavailable (labelled "using browser transcription");
  0.5 s min / 3 min max; timer + live level meter; cancel control;
  permission-denied guidance; TTS sentence queue with natural-English voice
  preference; tapping the mic stops in-flight TTS first.
- `VoiceControls.jsx` — mic button (tap-to-record / tap-to-send, pulsing
  recording indicator), header toggles: audio on/off, transcript show/hide,
  mic on/off, review-before-send (default off). All persisted; hiding the
  transcript is UI-only. Replay button on each interviewer message when
  audio is off.
- `Interview.jsx` — unified streaming sender: progressive reply display +
  sentence-by-sentence TTS as chunks arrive; falls back to `/turn` when the
  stream can't be established (mid-stream death does NOT auto-retry — the
  candidate turn is already stored). Voice works during DSA rounds for
  dialogue; code stays typed (no voice coding — documented scope decision).

## Verification (all green)

- `npm test`: **231 tests, 228 pass, 0 fail, 3 skipped** (pre-existing M5
  browsercc-gated). **55 new M9 tests**: transcribe (success / empty /
  401 / timeout / no-key / oversized), route validation (400/503 paths),
  splitter + strip + queue logic, mic reducer (all transitions incl. denied),
  partial-JSON extractor (escapes, unicode, cut-off sequences, key order),
  streamed `takeTurnStream` (chunks + done + transcript persistence +
  round transition + error events).
- `npm run build`: succeeds — 252 KB / 81 KB gzip (voice added ~20 KB).
- Live HTTP (scratch port, servers killed after): `/api/health` 200;
  `/api/voice/status` honestly reports `browser-fallback` with no key;
  transcribe-without-file → 400; empty stream body → 400; bad token →
  proper SSE `error` event; **full consent → start → streaming turn over
  real HTTP against the mock gateway** — chunks arrived, `done` fired, and
  the transcript persisted (3 turns).

## Honest mock-vs-real account

- No real Groq call was made here (no key on this machine) — the Whisper
  proxy is tested against injected fetch stubs; the real call happens on
  Render with the owner's key.
- No real microphone or real browser TTS exists on this VM. The true E2E
  per §4.7 is the owner's manual test below.

## Manual E2E script (owner, ~5 minutes, on the deployed link)

1. Open the deployed frontend, complete intake, start the interview. In the
   header you should see "🎙️ server transcription" (Render has your Groq key).
2. Tap the mic → allow microphone → speak a 5-second answer → tap again.
   Expect: timer + level meter while recording, "Transcribing…", then your
   words appear as your message and the interviewer replies **aloud**,
   starting before its text finishes appearing.
3. While it's speaking, tap the mic — its voice must stop immediately.
4. Toggle 🔊 off mid-interview → no more voice; each interviewer message
   shows a 🔊 replay button. Toggle the transcript hidden → messages hide
   but the interview continues.
5. In Render, temporarily blank `GROQ_API_KEY` and redeploy (or just trust
   the code path): the UI should show "using browser transcription" and the
   mic should still work via the browser engine. Remember to restore the key.

## Not done / deferred (documented)

- "Optional HD voice" (Kokoro) — out of scope for v1 (ADR 010 §9); the
  queue takes an injected utterance factory so it can be swapped later.
- No voice coding in DSA rounds (ADR 010 §8).
- In-browser Whisper via Transformers.js (spec's "optional later") — not built.

## After pushing

Nothing special — Render/Vercel auto-deploy. Optional: run the 5-step script
above on the deployed link; it exercises the one path no test here can
(a real mic + real `speechSynthesis` + your real Groq key).
