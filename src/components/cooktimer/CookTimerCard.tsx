'use client';

import { useEffect, useRef, useState } from 'react';
import type { CookTimerDTO } from '@/types/cooktimer';
import {
  deriveDisplayState, stepRemainingSeconds, confirmActionFor, formatMMSS,
} from '@/lib/cooktimer-logic';

interface Props {
  timer: CookTimerDTO;
  nowMs: number;
  color: string;
  onAdvance: (id: number, expectedStep: number) => void;
  onFinish: (id: number, expectedStep: number, label: string) => void;
  onCancel: (id: number) => void;
  onMute: (id: number, expectedStep: number, muted: boolean) => void;
}

const CONFIRM_MS = 3500;

export default function CookTimerCard({ timer, nowMs, color, onAdvance, onFinish, onCancel, onMute }: Props) {
  const [confirm, setConfirm] = useState<'skip' | 'cancel' | null>(null);
  const confirmTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Any structural change to the timer (step advanced) clears a pending confirm.
  useEffect(() => { setConfirm(null); }, [timer.currentStep, timer.id]);
  useEffect(() => () => { if (confirmTimer.current) clearTimeout(confirmTimer.current); }, []);

  const arm = (which: 'skip' | 'cancel') => {
    setConfirm(which);
    if (confirmTimer.current) clearTimeout(confirmTimer.current);
    confirmTimer.current = setTimeout(() => setConfirm(null), CONFIRM_MS);
  };

  const step = timer.steps[timer.currentStep];
  if (!step) return null; // corrupt/empty profile — skip rather than crash the board
  const isLast = timer.currentStep >= timer.steps.length - 1;
  const display = deriveDisplayState(step, timer.stepStartedEpoch, isLast, nowMs);
  const stateClass = display === 'running' ? 'run' : display;
  const label = `${timer.profileName}${timer.orderRefs.length > 1 ? ` ×${timer.orderRefs.length}` : ''} ${timer.orderRefs.join(' ')}`.trim();

  // Count text
  let countText: string;
  if (step.stepType === 'action') countText = 'NOW';
  else if (display === 'done' || display === 'alarm') countText = '0:00';
  else countText = formatMMSS(stepRemainingSeconds(step.durationSeconds, timer.stepStartedEpoch, nowMs));

  const primary = () => {
    const action = confirmActionFor(display, isLast);
    if (action === 'finish') onFinish(timer.id, timer.currentStep, label);
    else if (action === 'advance') onAdvance(timer.id, timer.currentStep);
  };

  const cardClick = (display === 'alarm' || display === 'done') ? primary : undefined;

  // Action button
  let btn: React.ReactNode = null;
  if (display === 'done') {
    btn = <button className="ct-abtn done" onClick={e => { e.stopPropagation(); onFinish(timer.id, timer.currentStep, label); }}>DONE → READY ON KDS</button>;
  } else if (display === 'alarm' && step.stepType === 'action') {
    btn = <button className="ct-abtn hot" onClick={e => { e.stopPropagation(); primary(); }}>{`${step.label.toUpperCase()} ✓`}</button>;
  } else if (display === 'alarm') {
    const next = timer.steps[timer.currentStep + 1];
    btn = <button className="ct-abtn next" onClick={e => { e.stopPropagation(); primary(); }}>{`START: ${(next?.label || '?').toUpperCase()}`}</button>;
  } else if (confirm === 'skip') {
    btn = <button className="ct-abtn hot" onClick={e => { e.stopPropagation(); setConfirm(null); if (isLast) onFinish(timer.id, timer.currentStep, label); else onAdvance(timer.id, timer.currentStep); }}>TAP AGAIN TO SKIP</button>;
  } else {
    btn = <button className="ct-abtn" onClick={e => { e.stopPropagation(); arm('skip'); }}>SKIP STEP</button>;
  }

  const stepNameText = step.stepType === 'rest' ? 'REST' : `${step.label}${step.stepType === 'action' ? ' — ACTION' : ''}`;

  return (
    <div className={`ct-tcard state-${stateClass}`} onClick={cardClick}>
      <div className="ct-thead">
        <div style={{ minWidth: 0 }}>
          <div className="ct-tname">
            {timer.profileName}{timer.orderRefs.length > 1 && <span className="ct-xn"> ×{timer.orderRefs.length}</span>}
          </div>
          <div className="ct-osub">
            <span className="ct-order">{timer.orderRefs.join('  ')}</span>
            <span className="ct-badge" style={{ background: color }}>{timer.stationName.toUpperCase()}</span>
          </div>
        </div>
        <div className="ct-hbtns">
          <button
            className={`ct-mute ${timer.muted ? 'on' : ''}`}
            title={timer.muted ? 'Unmute this item' : 'Mute this item'}
            onClick={e => { e.stopPropagation(); onMute(timer.id, timer.currentStep, !timer.muted); }}
          >
            {timer.muted ? '🔇' : '🔊'}
          </button>
          {confirm === 'cancel' ? (
            <button className="ct-cancel sure" onClick={e => { e.stopPropagation(); setConfirm(null); onCancel(timer.id); }}>SURE?</button>
          ) : (
            <button className="ct-cancel" onClick={e => { e.stopPropagation(); arm('cancel'); }}>✕ CANCEL</button>
          )}
        </div>
      </div>

      <div className="ct-stepname">{stepNameText}</div>
      <div className="ct-count">{countText}</div>

      <div className="ct-rail">
        {timer.steps.map((st, i) => {
          const cls = i < timer.currentStep ? 'donept' : i === timer.currentStep ? 'now' : '';
          const isNow = i === timer.currentStep;
          const width = isNow && st.durationSeconds > 0 && display !== 'alarm' && display !== 'done'
            ? `${Math.min(100, (1 - stepRemainingSeconds(st.durationSeconds, timer.stepStartedEpoch, nowMs) / st.durationSeconds) * 100)}%`
            : undefined; // CSS fills done/alarm/done segments to 100%
          return (
            <div key={st.id} className={`ct-rseg ${cls}`}>
              <div className="ct-rbar"><i style={width ? { width } : undefined} /></div>
              <div className="ct-rlabel">{st.label}</div>
            </div>
          );
        })}
      </div>

      {btn}
    </div>
  );
}
