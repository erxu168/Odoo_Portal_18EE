// Shared helpers for the Cooking Timer manager setup screen.
import type { CookStepType } from '@/types/cooktimer';

/** Seconds → "m:ss". */
export function fmtDuration(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** Total cook time — action steps (instant prompts) contribute nothing. */
export function totalCookSeconds(steps: { stepType: CookStepType; durationSeconds: number }[]): number {
  return steps.reduce((a, s) => a + (s.stepType === 'action' ? 0 : s.durationSeconds), 0);
}

export const STEP_TYPE_OPTIONS = [
  { value: 'cook' as CookStepType, label: 'Cook' },
  { value: 'rest' as CookStepType, label: 'Rest' },
  { value: 'action' as CookStepType, label: 'Action' },
];

/** Light-theme chip styling per step type. */
export function stepChipClass(type: CookStepType): string {
  if (type === 'action') return 'bg-sky-50 text-sky-700 border-sky-200';
  if (type === 'rest') return 'bg-gray-50 text-gray-500 border-gray-200 border-dashed';
  return 'bg-green-50 text-green-700 border-green-200';
}

// Heat-ordered kitchen palette: the first three land on the real WAJ stations
// (Grill orange, Deep Fry & Smoker amber, Oven red). Later stations continue in
// the same family — no violet/pink, which read as arbitrary next to the others.
const DOTS = ['bg-orange-500', 'bg-amber-400', 'bg-red-500', 'bg-teal-500', 'bg-sky-500', 'bg-emerald-500', 'bg-rose-400', 'bg-slate-500'];
/** Deterministic accent dot per station (stations have no stored color). */
export function stationDot(index: number): string {
  return DOTS[((index % DOTS.length) + DOTS.length) % DOTS.length];
}
