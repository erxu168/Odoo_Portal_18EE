'use client';

/** Small green on/off switch used across the setup tabs. Green = on (the portal's
 *  one action color); grey = off. */
export default function Toggle({
  on, onChange, disabled, label,
}: {
  on: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
  label?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!on)}
      className={`relative w-12 h-7 rounded-full transition-colors flex-shrink-0 ${on ? 'bg-green-500' : 'bg-gray-300'} ${disabled ? 'opacity-40 cursor-default' : ''}`}
    >
      <span className={`absolute top-0.5 left-0.5 w-6 h-6 rounded-full bg-white shadow transition-transform ${on ? 'translate-x-5' : ''}`} />
    </button>
  );
}
