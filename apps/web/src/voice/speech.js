/**
 * Milestone 9 — pure speech helpers (no DOM, no audio APIs).
 *
 * Everything here runs in node --test as well as the browser:
 *   splitSentences(text)   — sentence segmentation that respects
 *                            abbreviations, decimals and initials
 *   stripUnspeakable(text) — remove code blocks / inline code / URLs
 *                            (spec §4.7: never speak code; screen-only)
 *   SpeechQueue            — ordered sentence queue over an injected
 *                            speech-synthesis adapter (testable with a fake)
 */

// Private-use placeholder for "a period that must not split a sentence".
const PH = '';

const ABBREVIATIONS = [
  'Mr', 'Mrs', 'Ms', 'Dr', 'Prof', 'Sr', 'Jr', 'St',
  'e\\.g', 'i\\.e', 'etc', 'vs', 'U\\.S', 'U\\.K', 'Ph\\.D',
  'a\\.m', 'p\\.m',
  'Jan', 'Feb', 'Mar', 'Apr', 'Jun', 'Jul', 'Aug', 'Sep', 'Sept', 'Oct', 'Nov', 'Dec',
];

/**
 * Split text into sentences. Abbreviations (e.g., i.e., Dr.), decimals
 * (3.14), thousands (1,000) and single initials ("J. Smith") never split.
 * Returns [] for empty input. Code should be stripped first with
 * stripUnspeakable — a sentence splitter cannot parse code fences.
 */
export function splitSentences(text) {
  if (!text || !text.trim()) return [];
  let t = ` ${text.trim()} `;
  // Decimals and thousands separators: 3.14, 1,000.50
  t = t.replace(/(\d)\.(\d)/g, `$1${PH}$2`);
  // Known abbreviations: "e.g." "Dr." "U.S." (case-insensitive)
  for (const ab of ABBREVIATIONS) {
    t = t.replace(new RegExp(`\\b${ab}\\.`, 'gi'), (m) => m.replace(/\./g, PH));
  }
  // Single initials: "J. Smith", "O(n log n)" is unaffected (no period)
  t = t.replace(/\b([A-Za-z])\.(?=\s)/g, `$1${PH}`);
  // Ellipsis is not a sentence boundary
  t = t.replace(/\.{3,}/g, PH.repeat(3));

  const sentences = [];
  const re = /[^.!?]+[.!?]+["”')\]]*/g;
  let m;
  let last = 0;
  while ((m = re.exec(t)) !== null) {
    sentences.push(m[0]);
    last = m.index + m[0].length;
  }
  const tail = t.slice(last).trim();
  if (tail) sentences.push(tail);

  return sentences
    .map((s) => s.split(PH).join('.').trim())
    .filter((s) => s.length > 0);
}

/**
 * Remove things that must never be spoken (spec §4.7): fenced code blocks,
 * inline code, stray HTML, bare URLs. Returns plain speakable text.
 */
export function stripUnspeakable(text) {
  if (!text) return '';
  let t = String(text);
  t = t.replace(/```[\s\S]*?```/g, ' ');
  t = t.replace(/`[^`\n]+`/g, ' ');
  t = t.replace(/<[^>]{1,200}>/g, ' ');
  t = t.replace(/https?:\/\/\S+/g, ' ');
  t = t.replace(/[ \t\x0b\f\r]+/g, ' ');
  t = t.replace(/\n{3,}/g, '\n\n');
  return t.trim();
}

/**
 * Ordered sentence queue over an injected synthesis adapter.
 *
 * @param {object} args
 * @param {object|null} args.synth  { speak(u), cancel() } — window.speechSynthesis
 *   in the browser; null in tests or unsupported browsers (queue then drains
 *   synchronously through onUtterance so logic stays testable).
 * @param {function} [args.createUtterance]  (text) => utterance; browser default
 *   is left to the caller (needs `new SpeechSynthesisUtterance`).
 * @param {function} [args.pickVoice]  () => voice|null — natural English voice
 *   preference; never breaks when it returns null.
 *
 * The queue is deliberately dumb: ordering, stop()-clears-queue and
 * muted-skips are pure logic; only pump() touches the adapter.
 */
export class SpeechQueue {
  constructor({ synth = null, createUtterance = null, pickVoice = null } = {}) {
    this.synth = synth;
    this.createUtterance = createUtterance || ((text) => ({ text }));
    this.pickVoice = pickVoice || null;
    this.queue = [];
    this.current = null;
    this.muted = false;
    /** Test/ops introspection: utterances handed to the adapter, in order. */
    this.spoken = [];
    /** Test hook: called with each utterance as it starts. */
    this.onUtterance = null;
  }

  get speaking() {
    return this.current !== null || this.queue.length > 0;
  }

  get pending() {
    return this.queue.length + (this.current ? 1 : 0);
  }

  setMuted(muted) {
    this.muted = !!muted;
    if (this.muted) this.stop();
  }

  /** Queue one pre-split sentence. Returns true when accepted. */
  enqueueSentence(sentence) {
    const s = (sentence || '').trim();
    if (!s || this.muted) return false;
    this.queue.push(s);
    this.pump();
    return true;
  }

  /** Strip, split and queue full text. Returns the number of sentences queued. */
  enqueueText(text) {
    if (this.muted) return 0;
    const sentences = splitSentences(stripUnspeakable(text));
    for (const s of sentences) this.queue.push(s);
    this.pump();
    return sentences.length;
  }

  stop() {
    this.queue = [];
    this.current = null;
    try {
      this.synth?.cancel();
    } catch {
      /* adapter missing or broken — queue state is what matters */
    }
  }

  pump() {
    if (this.current || this.queue.length === 0 || this.muted) return;
    const sentence = this.queue.shift();
    let utterance;
    try {
      utterance = this.createUtterance(sentence);
    } catch {
      utterance = { text: sentence };
    }
    if (this.pickVoice && utterance && typeof utterance === 'object') {
      try {
        const voice = this.pickVoice();
        if (voice) utterance.voice = voice;
      } catch {
        /* voice selection must never break speaking */
      }
    }
    this.current = utterance;
    this.spoken.push(sentence);
    if (typeof this.onUtterance === 'function') {
      try {
        this.onUtterance(utterance, sentence);
      } catch {
        /* test hooks must not break the queue */
      }
    }
    if (this.synth && typeof this.synth.speak === 'function') {
      const done = () => {
        if (this.current === utterance) {
          this.current = null;
          this.pump();
        }
      };
      try {
        utterance.onend = done;
        utterance.onerror = done;
      } catch {
        /* plain-object utterances in tests */
      }
      try {
        this.synth.speak(utterance);
      } catch {
        this.current = null;
      }
    } else {
      // No adapter (tests / unsupported browser): finish synchronously so
      // queue logic — order, stop(), mute — stays fully testable.
      this.current = null;
      this.pump();
    }
  }
}
