import { useState } from 'react';
import Editor from '@monaco-editor/react';
import { getEditorLockState } from '../harness.js';

/**
 * Milestone 4 — Monaco editor with the spec §4.6 locked mode.
 *
 * Locked: readOnly + a clear overlay ("Explain your approach to unlock").
 * The real unlock (approach explanation judged by LLM) arrives in M8; for M4
 * the parent controls `locked` and gets `onUnlockRequest`. The demo toggle
 * simulates an accepted approach so the flow is exercisable today.
 *
 * Monaco itself is loaded from CDN at runtime by @monaco-editor/react —
 * it is never part of the app bundle (see ADR 005).
 */
const MONACO_LANGUAGE = { javascript: 'javascript', python: 'python', cpp: 'cpp' };

export default function LockedEditor({
  language = 'javascript',
  value,
  onChange,
  locked = true,
  onUnlockRequest,
  height = '320px',
  /** M8: the interview view drives unlocking via the real approach judge and
   *  hides this demo shortcut. The playground keeps it (default true). */
  demoToggle = true,
}) {
  const [demoUnlocked, setDemoUnlocked] = useState(false);
  const effectiveLocked = locked && !demoUnlocked;
  const state = getEditorLockState({ locked: effectiveLocked });

  return (
    <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
      <div className="relative">
        <Editor
          height={height}
          language={MONACO_LANGUAGE[language] || 'javascript'}
          value={value}
          onChange={(v) => onChange?.(v ?? '')}
          options={{
            readOnly: state.readOnly,
            minimap: { enabled: false },
            fontSize: 14,
            scrollBeyondLastLine: false,
            padding: { top: 12 },
            renderLineHighlight: state.readOnly ? 'none' : 'all',
          }}
          loading={
            <div className="flex h-full items-center justify-center text-sm text-slate-500">
              Loading the code editor…
            </div>
          }
        />
        {state.overlay && (
          <div
            className="absolute inset-0 z-10 flex flex-col items-center justify-center bg-slate-900/45 p-6 text-center backdrop-blur-[1px]"
            role="note"
            aria-label="Editor locked"
          >
            <p className="text-lg font-semibold text-white">🔒 {state.overlayText}</p>
            <p className="mt-2 max-w-sm text-sm text-slate-200">{state.overlaySubtext}</p>
          </div>
        )}
      </div>
      <div className="flex items-center justify-between border-t border-slate-100 bg-slate-50 px-4 py-2">
        <p className="text-xs text-slate-500">
          {effectiveLocked ? 'Editor is locked — explain your approach to unlock.' : 'Editor unlocked — write your solution.'}
        </p>
        {effectiveLocked && demoToggle && (
          <button
            type="button"
            onClick={() => {
              setDemoUnlocked(true);
              onUnlockRequest?.();
            }}
            className="rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-1 text-xs font-semibold text-indigo-700 hover:bg-indigo-100"
          >
            Demo: simulate approach accepted
          </button>
        )}
      </div>
    </div>
  );
}
