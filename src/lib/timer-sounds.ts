/**
 * Timer sound effects — generated via Web Audio API, no external files needed.
 * Each sound is designed to cut through kitchen noise while remaining distinct.
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

// ── Individual sounds ──

/** Gentle kitchen-timer ding — two harmonic tones */
export function playChime(): void {
  const ctx = getCtx();
  const now = ctx.currentTime;
  [880, 1108.73].forEach((freq, i) => {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0, now + i * 0.15);
    gain.gain.linearRampToValueAtTime(0.4, now + i * 0.15 + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.001, now + i * 0.15 + 1.5);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now + i * 0.15);
    osc.stop(now + i * 0.15 + 1.5);
  });
}

/** Classic beep-beep-beep alarm */
export function playBeep(): void {
  const ctx = getCtx();
  const now = ctx.currentTime;
  for (let i = 0; i < 3; i++) {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'square';
    osc.frequency.value = 1000;
    const t = now + i * 0.3;
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(0.3, t + 0.01);
    gain.gain.setValueAtTime(0.3, t + 0.15);
    gain.gain.linearRampToValueAtTime(0, t + 0.17);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(t);
    osc.stop(t + 0.2);
  }
}

/** Urgent rapid alarm — higher pitch, faster pattern */
export function playUrgent(): void {
  const ctx = getCtx();
  const now = ctx.currentTime;
  for (let round = 0; round < 2; round++) {
    for (let i = 0; i < 5; i++) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'square';
      osc.frequency.value = 1400;
      const t = now + round * 0.8 + i * 0.12;
      gain.gain.setValueAtTime(0, t);
      gain.gain.linearRampToValueAtTime(0.35, t + 0.005);
      gain.gain.setValueAtTime(0.35, t + 0.06);
      gain.gain.linearRampToValueAtTime(0, t + 0.08);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(t);
      osc.stop(t + 0.1);
    }
  }
}

/** Warm bell / gong with inharmonic partials */
export function playBell(): void {
  const ctx = getCtx();
  const now = ctx.currentTime;
  const fundamental = 440;
  const partials = [
    { ratio: 1.0, amp: 0.35, decay: 2.5 },
    { ratio: 2.0, amp: 0.15, decay: 1.8 },
    { ratio: 3.0, amp: 0.10, decay: 1.2 },
    { ratio: 4.16, amp: 0.08, decay: 0.8 },
    { ratio: 5.43, amp: 0.05, decay: 0.6 },
  ];
  partials.forEach(({ ratio, amp, decay }) => {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.value = fundamental * ratio;
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(amp, now + 0.005);
    gain.gain.exponentialRampToValueAtTime(0.001, now + decay);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + decay);
  });
}

/** Short C-major arpeggio melody */
export function playMelody(): void {
  const ctx = getCtx();
  const now = ctx.currentTime;
  const notes = [523.25, 659.25, 783.99, 1046.50];
  notes.forEach((freq, i) => {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.value = freq;
    const t = now + i * 0.25;
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(0.3, t + 0.01);
    gain.gain.setValueAtTime(0.3, t + 0.15);
    gain.gain.linearRampToValueAtTime(0, t + 0.2);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(t);
    osc.stop(t + 0.21);
  });
}

// ── Sound registry ──

export const TIMER_SOUNDS = {
  chime:  { label: 'Gentle Chime',   icon: '\u{1F514}', play: playChime },
  beep:   { label: 'Classic Beep',   icon: '\u{1F4E2}', play: playBeep },
  urgent: { label: 'Urgent Alarm',   icon: '\u{1F6A8}', play: playUrgent },
  bell:   { label: 'Soft Bell',      icon: '\u{1F6CE}', play: playBell },
  melody: { label: 'Melody',         icon: '\u{1F3B5}', play: playMelody },
} as const;

export type TimerSoundKey = keyof typeof TIMER_SOUNDS;

/**
 * Play a sound repeatedly at an interval until the returned stop-function is called.
 */
export function playRepeating(soundKey: TimerSoundKey, intervalMs: number): () => void {
  const fn = TIMER_SOUNDS[soundKey].play;
  fn();
  const id = setInterval(fn, intervalMs);
  return () => clearInterval(id);
}
