/**
 * Concurrent cooking session model.
 * Sessions use absolute timestamps (timerEndAt) so timers survive
 * navigation between sessions. All state lives in React; no localStorage for V1.
 */

export interface StepIngredient { id: number; name: string; qty: number; uom: string; uom_id: number | null; }
export interface StepImage { id: number; image: string; caption: string; }
export interface StepData {
  id: number; sequence: number; step_type: string; instruction: string;
  timer_seconds: number; tip: string; image_count: number;
  ingredients: StepIngredient[];
  images?: StepImage[];
}

export interface CookingSession {
  id: string;
  recipeId: number;
  recipeName: string;
  mode: 'cooking' | 'production';
  steps: StepData[];
  currentStep: number;
  batch: number;
  multiplier: number;
  timerEndAt: number | null;
  timerTotal: number;
  timerPausedLeft: number | null;
  showPlating: boolean;
  status: 'active' | 'done';
  startedAt: number;
}

export interface TimerDisplay {
  left: number;
  total: number;
  running: boolean;
  done: boolean;
  overdue: number;
  active: boolean;
}

export function computeTimer(s: CookingSession, now: number): TimerDisplay {
  if (s.timerEndAt !== null) {
    const remaining = Math.ceil((s.timerEndAt - now) / 1000);
    if (remaining <= 0) {
      return { left: 0, total: s.timerTotal, running: false, done: true, overdue: Math.floor((now - s.timerEndAt) / 1000), active: true };
    }
    return { left: remaining, total: s.timerTotal, running: true, done: false, overdue: 0, active: true };
  }
  if (s.timerPausedLeft !== null && s.timerPausedLeft > 0) {
    return { left: s.timerPausedLeft, total: s.timerTotal, running: false, done: false, overdue: 0, active: true };
  }
  return { left: 0, total: 0, running: false, done: false, overdue: 0, active: false };
}

export function createSessionId(): string {
  return `cs_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
}

export function formatTimer(sec: number): string {
  const m = Math.floor(Math.abs(sec) / 60);
  const s = Math.abs(sec) % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}
