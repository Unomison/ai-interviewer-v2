# ADR 010 — Voice interview (Milestone 9) design

Date: 2026-11-04
Status: Accepted
Context: Spec §4.7 (full voice contract — non-negotiable interaction rules) + §13 M9 acceptance ("Done when the contract in Section 4.7 holds in E2E tests"); M8 interview engine (text loop, session store); M2 gateway (`generate({stream:true})` already supported; Groq key env `GROQ_API_KEY` already on Render from M1).

## Decisions

### 1. Voice is a transport layer over the M8 text engine — not a second engine
Speech in → text → the *existing* `takeTurn` logic → streamed text out → speech out. Every voice turn lands in the server transcript as text, so M10's report needs no voice-specific handling. The interviewer's brain is untouched; only the I/O edges changed.

### 2. STT primary = Groq Whisper via a server-side proxy (`POST /api/voice/transcribe`)
The browser uploads the MediaRecorder blob (multipart `audio`, 10 MB cap ≈ 2 min); the server forwards it to `https://api.groq.com/openai/v1/audio/transcriptions` (`whisper-large-v3-turbo`, `temperature: 0`) with the key in the `Authorization` header. The key never leaves the server, is never logged, and 401s map to honest 503s. The spec's vocabulary hint (DP, memoization, O(n log n), BFS, mutex + candidate role/company) is passed as Whisper's `prompt` field. Contract: 400 on missing/oversized/wrong-type audio; 502/503 with JSON when Groq is unreachable or the key is absent; never a bare 500. No audio is stored — transcribe and drop.

### 3. STT fallback = Web Speech API live capture, then plain typing
`webkitSpeechRecognition` cannot transcribe a blob — it captures from the mic itself — so the fallback is a *different capture path*, not a different decoder: tap → `recognition.start()` → tap → stop → final transcript. The frontend learns the expected path from `GET /api/voice/status` (`stt: 'groq-whisper' | 'browser-fallback'`) and labels it honestly in the UI ("using browser transcription"). A 503/502 from the server path auto-switches the client to the browser path with an explanatory note. Text input always exists regardless.

### 4. TTS = browser `speechSynthesis`, sentence-by-sentence over a real stream
New endpoint `POST /api/interview/turn/stream` (SSE): the interviewer streams via the M2 gateway's existing `stream:true` support. The model emits JSON; the server extracts *message-text deltas* from the partial JSON with `extractMessageDelta()` (tolerant walker — handles `\"` `\\` `\n` `\uXXXX`, never `JSON.parse`s partial text) and emits `event: chunk`. The client splits accumulated text into sentences and queues them as each completes — speech starts on the first full sentence, not after the full reply. Post-processing (transcript append, round flags, transition + opening message) is byte-identical to `takeTurn`, so streamed and typed turns leave the same session behind. `event: done` carries the same payload as `/turn`; `event: error` carries the coded error. A 15 s heartbeat comment keeps free-tier proxies from idling the connection. If the stream can't be established at all, the client falls back to `/turn` and speaks the full reply; if it dies *mid-stream*, no auto-retry (the candidate turn is already stored — retrying would duplicate it).

### 5. Never speak code (spec §4.7)
`stripUnspeakable()` removes fenced code blocks, inline code, stray HTML and bare URLs before anything reaches the TTS queue. The sentence splitter (`splitSentences()`) respects abbreviations (Dr., e.g., i.e.), decimals (3.14) and initials so speech doesn't stutter on false boundaries. Voice selection prefers a natural English voice when the browser offers one, and silently falls back when it doesn't.

### 6. Mic state machine: recording starts ONLY on an explicit tap
`micReducer` (pure, unit-tested): `idle → requesting → recording → transcribing → sending → idle`, plus `denied` (with re-allow instructions), `error`, and the spec's edge paths — cancel discards without sending, <0.5 s recordings are discarded ("too short"), empty STT shows "Didn't catch that, try again" and never sends, 3 min auto-stops and sends. Tapping the mic while the interviewer speaks stops TTS first. Timer + live level meter (AnalyserNode; best-effort) during recording.

### 7. Toggles: audio on/off, transcript show/hide, mic on/off, review-before-send
Each independently switchable mid-interview, persisted to `localStorage`. Hiding the transcript is UI-only — the transcript is always generated and stored. Muting stops in-flight speech; when audio is off, each interviewer message gets a replay button (which bypasses the mute for that one utterance). "Review transcript before sending" (default off, per spec) routes the transcription into the text box instead of auto-sending.

### 8. DSA rounds: voice for dialogue, code stays typed
The mic lives in the persistent footer, so it's available during DSA rounds for talking to the interviewer — but there is deliberately no voice coding (dictating code is error-prone and untestable here). Documented scope decision, not an oversight.

### 9. "Optional HD voice" is out of scope
Spec §4.7 lists Kokoro HD voice as optional. Skipped: tens of MB download + WebGPU/WASM complexity for a v1 whose core promise is the interview loop. The `SpeechQueue` takes an injected utterance factory, so a future HD engine can replace `speechSynthesis` without touching the queue logic. Documented, not forgotten.

### 10. What "E2E" means for M9 acceptance
The §4.7 contract is verified at every layer *except* a real microphone and real browser TTS, which cannot exist on this build machine: 55 new unit/route tests (transcribe success/401/timeout/oversize/no-key; splitter/strip/queue logic; mic reducer; partial-JSON extractor; streamed takeTurn incl. round transition and error events), plus a live HTTP check of the SSE stream against the mock gateway. The true end-to-end — tap mic on the deployed link with the owner's Groq key on Render — is a 5-step manual script in `MILESTONE9_REPORT.md`, owned by the one person with a microphone and a browser.
