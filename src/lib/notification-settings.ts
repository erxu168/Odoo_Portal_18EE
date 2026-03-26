import { type TimerSoundKey } from './timer-sounds';

export interface NotificationSettings {
  /** Which sound to play */
  sound: TimerSoundKey;
  /** How long the banner stays visible (seconds). 0 = until dismissed manually. */
  bannerDuration: number;
  /** How often the sound repeats while banner is showing (seconds). 0 = play once. */
  soundRepeatInterval: number;
  /** Enable vibration on mobile */
  vibration: boolean;
}

const STORAGE_KEY = 'kw_notification_settings';

const DEFAULTS: NotificationSettings = {
  sound: 'chime',
  bannerDuration: 0,      // stay until dismissed
  soundRepeatInterval: 5,  // repeat every 5s
  vibration: true,
};

export const BANNER_DURATION_OPTIONS = [
  { value: 0,  label: 'Until dismissed' },
  { value: 8,  label: '8 seconds' },
  { value: 15, label: '15 seconds' },
  { value: 30, label: '30 seconds' },
  { value: 60, label: '1 minute' },
] as const;

export const SOUND_REPEAT_OPTIONS = [
  { value: 0,  label: 'Play once' },
  { value: 3,  label: 'Every 3 seconds' },
  { value: 5,  label: 'Every 5 seconds' },
  { value: 10, label: 'Every 10 seconds' },
  { value: 15, label: 'Every 15 seconds' },
] as const;

export function loadSettings(): NotificationSettings {
  if (typeof window === 'undefined') return DEFAULTS;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return { ...DEFAULTS, ...JSON.parse(raw) };
  } catch (_e) { /* */ }
  return DEFAULTS;
}

export function saveSettings(settings: NotificationSettings): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch (_e) { /* */ }
}
