/**
 * Cook-timer PURE display logic (no I/O) — unit-tested in isolation.
 *
 * The server owns the minimal truth: which step, and when it started. The client
 * derives the on-screen state (running / warnzone / alarm / done) from that plus
 * the step's duration, every tick. Nothing auto-advances (spec decision 5): a
 * step ending only produces an alarm; a human tap advances it.
 */
import type { CookStep } from '@/types/cooktimer';

export type DisplayState = 'running' | 'warnzone' | 'alarm' | 'done';

/** Seconds left on the current step. Negative = overdue. */
export function stepRemainingSeconds(
  durationSeconds: number,
  stepStartedEpoch: number,
  nowMs: number,
): number {
  return durationSeconds - (nowMs - stepStartedEpoch) / 1000;
}

/**
 * Derive the display state of a running timer's CURRENT step.
 * - `action` (or zero-duration) steps are an immediate prompt => alarm.
 * - a cook step at/after 0s => `done` if it's the last step, else `alarm`.
 * - the final 15% of a cook step => `warnzone` (amber).
 * - otherwise `running` (green).
 */
export function deriveDisplayState(
  step: CookStep,
  stepStartedEpoch: number,
  isLastStep: boolean,
  nowMs: number,
): DisplayState {
  if (step.stepType === 'action' || step.durationSeconds <= 0) return 'alarm';
  const remaining = stepRemainingSeconds(step.durationSeconds, stepStartedEpoch, nowMs);
  if (remaining <= 0) return isLastStep ? 'done' : 'alarm';
  if (remaining <= step.durationSeconds * 0.15) return 'warnzone';
  return 'running';
}

/** True once the timer demands a human tap (whole card becomes the tap target). */
export function isAttentionState(s: DisplayState): boolean {
  return s === 'alarm' || s === 'done';
}

/**
 * The confirming action for the current step:
 *  - 'finish' : last cook step done, OR acknowledging the final (action) step.
 *  - 'advance': acknowledge a non-final alarm and start the next step.
 *  - null     : still running/warnzone, no confirming action yet (SKIP only).
 */
export function confirmActionFor(
  display: DisplayState,
  isLastStep: boolean,
): 'finish' | 'advance' | null {
  if (display === 'done') return 'finish';
  if (display === 'alarm') return isLastStep ? 'finish' : 'advance';
  return null;
}

/** Queue-card / group age tier from seconds waiting (spec decision 10). */
export function queueAgeTier(ageSeconds: number): '' | 'warn' | 'urgent' {
  if (ageSeconds > 120) return 'urgent';
  if (ageSeconds > 60) return 'warn';
  return '';
}

/** mm:ss for a countdown (rounds up, never negative). */
export function formatMMSS(seconds: number): string {
  const s = Math.max(0, Math.ceil(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
