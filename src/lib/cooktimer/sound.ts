/**
 * Cooking Timer audio — fire-and-forget Web Audio, ported from the mock.
 *
 * HARD RULE (spec decision 12): audio is NEVER in the critical path of a state
 * transition. Callers set state / mark re-render BEFORE calling these, and every
 * function is fully wrapped in try/catch so a throwing or suspended AudioContext
 * (e.g. a sandbox) can never freeze the timer. Nothing here returns or awaits a
 * promise that a caller could accidentally gate on.
 */
let AC: AudioContext | null = null;

/** Unlock/resume the AudioContext on a user gesture (tap). Safe to call often. */
export function unlockAudio(): void {
  try {
    const Ctor = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    if (!AC) AC = new Ctor();
    if (AC && AC.state === 'suspended') { void AC.resume(); }
  } catch { /* audio unavailable — visual alarm still runs */ }
}

function tone(freq: number, dur: number, type: OscillatorType = 'square', gain = 0.25, when = 0): void {
  try {
    const c = AC;
    if (!c) return;
    const o = c.createOscillator();
    const g = c.createGain();
    o.type = type;
    o.frequency.value = freq;
    o.connect(g);
    g.connect(c.destination);
    const t = c.currentTime + when;
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.start(t);
    o.stop(t + dur);
  } catch { /* ignore */ }
}

/** Stage / action alarm — a step ended and needs a confirming tap. */
export function playStageAlarm(): void {
  try { [0, 0.18, 0.36].forEach(w => tone(1400, 0.14, 'square', 0.3, w)); } catch { /* ignore */ }
}

/** DONE alarm — more insistent two-note pattern; the whole item is ready. */
export function playDoneAlarm(): void {
  try {
    [0, 0.15, 0.3].forEach(w => { tone(1760, 0.12, 'square', 0.35, w); tone(880, 0.12, 'square', 0.3, w + 0.06); });
  } catch { /* ignore */ }
}
