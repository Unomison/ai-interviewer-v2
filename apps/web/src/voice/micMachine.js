/**
 * Milestone 9 — microphone state machine (pure reducer, node-testable).
 *
 * Spec §4.7 contract: idle -> recording -> transcribing -> sending -> idle.
 * Recording NEVER starts by itself: the only entry into `recording` is an
 * explicit user tap (START_RECORDING dispatched from the tap handler).
 * Cancel discards without sending; permission denial and too-short
 * recordings return to idle with an explanatory note.
 */

export const MIC_IDLE = 'idle';
export const MIC_REQUESTING = 'requesting'; // permission prompt is up
export const MIC_RECORDING = 'recording';
export const MIC_TRANSCRIBING = 'transcribing';
export const MIC_SENDING = 'sending';
export const MIC_DENIED = 'denied';
export const MIC_ERROR = 'error';

export const initialMicState = {
  status: MIC_IDLE,
  note: '',
  startedAt: 0,
};

export function micReducer(state, action) {
  switch (action.type) {
    case 'START_REQUEST':
      // Tap: permission prompt (MediaRecorder path) or straight in (Web Speech).
      return state.status === MIC_IDLE
        ? { ...state, status: MIC_REQUESTING, note: '' }
        : state;

    case 'START_RECORDING':
      // Only a user tap may start recording — never an effect, never a timer.
      return state.status === MIC_REQUESTING || state.status === MIC_IDLE
        ? { ...state, status: MIC_RECORDING, startedAt: action.at || Date.now(), note: '' }
        : state;

    case 'PERMISSION_DENIED':
      return {
        ...state,
        status: MIC_DENIED,
        note: 'Microphone access was denied. Click the lock/tune icon in the address bar, allow the microphone, then try again.',
      };

    case 'NO_MIC_SUPPORT':
      return {
        ...state,
        status: MIC_ERROR,
        note: 'This browser cannot record audio. Please type your answer instead.',
      };

    case 'STOP_TRANSCRIBE':
      return state.status === MIC_RECORDING
        ? { ...state, status: MIC_TRANSCRIBING, note: '' }
        : state;

    case 'CANCEL':
      // Discard without sending — always allowed while capturing.
      return { ...state, status: MIC_IDLE, note: '', startedAt: 0 };

    case 'TOO_SHORT':
      return {
        ...state,
        status: MIC_IDLE,
        note: 'That was too short to transcribe — hold the mic a moment longer.',
        startedAt: 0,
      };

    case 'EMPTY_TRANSCRIPT':
      // Spec §4.7: do not send; show "Didn't catch that, try again".
      return { ...state, status: MIC_IDLE, note: "Didn't catch that, try again.", startedAt: 0 };

    case 'TRANSCRIBED':
      return state.status === MIC_TRANSCRIBING
        ? { ...state, status: 'sending', note: '' }
        : state;

    case 'SENT':
      return { ...state, status: MIC_IDLE, note: '', startedAt: 0 };

    case 'FAIL':
      return { ...state, status: MIC_ERROR, note: action.note || 'Voice input failed. Please type your answer instead.' };

    case 'DISMISS':
      return state.status === MIC_ERROR || state.status === MIC_DENIED
        ? { ...state, status: MIC_IDLE, note: '' }
        : state;

    default:
      return state;
  }
}
