/**
 * KDS sound engine — Web Audio API.
 * Three distinct sounds for kitchen alerts.
 * Pattern follows src/lib/timer-sounds.ts.
 */

let audioCtx: AudioContext | null = null;

function getCtx(): AudioContext {
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
  }
  if (audioCtx.state === 'suspended') audioCtx.resume();
  return audioCtx;
}

/** Call once on first user tap/click to unlock audio on iOS/Android */
export function unlockAudio(): void {
  try {
    const ctx = getCtx();
    const buf = ctx.createBuffer(1, 1, 22050);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.connect(ctx.destination);
    src.start(0);
  } catch (_e) { /* silent */ }
}

function beep(freq: number, durationMs: number, vol: number, type: OscillatorType = 'sine'): void {
  const ctx = getCtx();
  const now = ctx.currentTime;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = type;
  osc.frequency.value = freq;
  gain.gain.setValueAtTime(0, now);
  gain.gain.linearRampToValueAtTime(vol, now + 0.01);
  gain.gain.setValueAtTime(vol, now + durationMs / 1000 - 0.05);
  gain.gain.linearRampToValueAtTime(0, now + durationMs / 1000);
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start(now);
  osc.stop(now + durationMs / 1000);
}

/** Two-tone chime for new orders */
export function playNewOrderSound(vol: number = 0.7): void {
  const ctx = getCtx();
  const now = ctx.currentTime;
  [880, 1108.73].forEach((freq, i) => {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0, now + i * 0.15);
    gain.gain.linearRampToValueAtTime(vol * 0.5, now + i * 0.15 + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.001, now + i * 0.15 + 1.2);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now + i * 0.15);
    osc.stop(now + i * 0.15 + 1.2);
  });
}

/** Rapid triple beep for pass alerts */
export function playPassAlert(vol: number = 0.8): void {
  for (let i = 0; i < 3; i++) {
    setTimeout(() => beep(1000, 150, vol * 0.4, 'square'), i * 250);
  }
}

/** Ascending arpeggio for round complete */
export function playRoundDone(vol: number = 0.6): void {
  const notes = [523.25, 659.25, 783.99, 1046.50];
  notes.forEach((freq, i) => {
    setTimeout(() => beep(freq, 180, vol * 0.35, 'sine'), i * 200);
  });
}
