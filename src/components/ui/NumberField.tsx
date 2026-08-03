'use client';

import React, { useEffect, useId, useState } from 'react';
import { useNumpad } from './NumpadProvider';
import { bufferFromValue, type NumericRules, type NumericValue } from '@/lib/numeric-input';
import type { NumpadLayout } from './NumpadCore';
import type { NumpadQuickAction } from './NumpadProvider';

/**
 * NumberField — the number input to use everywhere in the portal.
 *
 * Spec: docs/superpowers/specs/2026-08-03-android-keyboard-numpad-design.md
 *
 * On a touch device it suppresses Android's keypad (which covers the field you
 * are typing into) and opens the shared in-app numpad instead. On desktop it is
 * an ordinary typed input — a mouse user gains nothing from a tapped pad.
 *
 * THE CONTRACT THAT PROTECTS SAVES: while the pad is open, edits live in the
 * pad's own buffer. `onValueChange` fires only for desktop typing; the parent
 * hears about a tapped value exactly once, through `onCommit`, when the user
 * presses Confirm. Screens that save on change or on blur therefore cannot save
 * a half-typed number, and Cancel really does leave the old value alone.
 */

export interface NumberFieldProps {
  value: NumericValue;
  /** Desktop typing only. A tapped pad reports through onCommit, never here. */
  onValueChange?: (value: NumericValue) => void;
  /** The committed value: Confirm on the pad, or blur/Enter when typed on desktop. */
  onCommit?: (value: NumericValue) => void | Promise<void>;

  mode?: NumericRules['mode'];
  allowEmpty?: boolean;
  min?: number;
  max?: number;
  step?: number;
  fractionDigits?: number;
  maxLength?: number;

  label?: string;
  sublabel?: string;
  unit?: string;
  placeholder?: string;
  confirmLabel?: string;
  layout?: NumpadLayout;
  quickActions?: NumpadQuickAction[];
  hint?: React.ReactNode;

  disabled?: boolean;
  /** Visible and selectable, but not editable — the value is calculated elsewhere. */
  readOnly?: boolean;
  required?: boolean;
  /** Focus on mount. Typed path only: focus deliberately does not open the pad. */
  autoFocus?: boolean;
  name?: string;
  id?: string;
  className?: string;
  inputClassName?: string;
  'aria-label'?: string;
}

/**
 * Touch device? Decided by capability, never by user-agent string — a Windows
 * tablet and an Android tablet deserve the same treatment, and UA sniffing gets
 * both wrong eventually.
 */
function prefersInAppPad(): boolean {
  if (typeof window === 'undefined' || !window.matchMedia) return false;
  return window.matchMedia('(pointer: coarse)').matches;
}

export default function NumberField({
  value,
  onValueChange,
  onCommit,
  mode = 'decimal',
  allowEmpty = false,
  min,
  max,
  step,
  fractionDigits,
  maxLength,
  label,
  sublabel,
  unit,
  placeholder,
  confirmLabel,
  layout,
  quickActions,
  hint,
  disabled = false,
  readOnly = false,
  required = false,
  autoFocus = false,
  name,
  id,
  className = '',
  inputClassName = '',
  'aria-label': ariaLabel,
}: NumberFieldProps) {
  const numpad = useNumpad();
  const generatedId = useId();
  const fieldId = id || generatedId;

  const rules: NumericRules = { mode, allowEmpty, min, max, step, fractionDigits, maxLength };

  // Resolved after mount, never during render: the server has no pointer to
  // check, so deciding at render time would make the server's HTML and the
  // client's first pass disagree and trip a hydration mismatch.
  const [coarsePointer, setCoarsePointer] = useState(false);
  useEffect(() => setCoarsePointer(prefersInAppPad()), []);

  // No provider mounted, a desktop pointer, or a field that cannot be edited:
  // behave as a normal input.
  const usePad = !!numpad && coarsePointer && !disabled && !readOnly;

  /**
   * What the user has typed but has not finished typing.
   *
   * WITHOUT THIS THE DECIMAL POINT IS UNTYPEABLE. The input is controlled off a
   * parsed number, so typing "2." parses back to 2, the parent's state does not
   * change, and React restores the DOM node to "2" — silently eating the dot.
   * The next keystroke appends to the whole number, so a typed 2.5 is entered as
   * 25. On a wage, a price or a rent that is a 10x error with nothing on screen
   * to show it happening.
   *
   * So the raw text lives here while the field is being typed into, and is
   * normalised back to the parsed value on blur.
   */
  const [draft, setDraft] = useState<string | null>(null);
  const text = draft ?? bufferFromValue(value, rules);

  function openPad() {
    if (!numpad) return;
    setDraft(null); // the pad owns the buffer from here

    numpad.open({
      rules,
      initialValue: value,
      label: label || ariaLabel,
      sublabel,
      unit,
      confirmLabel,
      layout,
      quickActions,
      hint,
      onCommit: (committed) => {
        // Exactly one of the two, never both — `??` would have fired
        // onValueChange as well whenever onCommit returned void.
        if (onCommit) return onCommit(committed);
        onValueChange?.(committed);
      },
    });
  }

  function handleTypedChange(e: React.ChangeEvent<HTMLInputElement>) {
    const raw = e.target.value.replace(',', '.');
    // Keep exactly what was typed, so a trailing "." survives to become "2.5".
    setDraft(maxLength !== undefined ? raw.slice(0, maxLength) : raw);
    if (raw === '') {
      onValueChange?.(null);
      return;
    }
    if (mode === 'digit-string') {
      onValueChange?.(raw);
      return;
    }
    const num = parseFloat(raw);
    onValueChange?.(Number.isFinite(num) ? num : null);
  }

  return (
    <div className={className}>
      {label && (
        <label htmlFor={fieldId} className="block text-[11px] font-bold tracking-wide uppercase text-gray-400 mb-1.5">
          {label}
        </label>
      )}
      <input
        id={fieldId}
        name={name}
        type="text"
        // The suppression itself: "this field has its own keyboard, don't raise
        // yours". The field stays a real, editable input, so a hardware keyboard
        // and assistive tech still work — which readOnly would have broken.
        inputMode={usePad ? 'none' : mode === 'digit-string' ? 'numeric' : 'decimal'}
        // Numeric soft keyboards on non-pad fallbacks; harmless when a pad is used.
        pattern={mode === 'integer' || mode === 'digit-string' ? '[0-9]*' : undefined}
        value={text}
        placeholder={placeholder}
        disabled={disabled}
        readOnly={readOnly}
        required={required}
        // Forwarded, not merely held in `rules`: the pad enforces it via applyKey,
        // but a TYPED postcode or PIN would otherwise have no cap at all.
        maxLength={maxLength}
        autoFocus={!usePad && autoFocus}
        aria-label={ariaLabel || label}
        // Opened on pointer-down and on Enter/Space — deliberately NOT on focus.
        // The pad restores focus to this field when it closes, so opening on
        // focus would immediately re-open it, forever.
        onPointerDown={usePad ? (e) => { e.preventDefault(); openPad(); } : undefined}
        onKeyDown={usePad ? (e) => {
          if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openPad(); }
        } : undefined}
        // Always live, even in pad mode: a Bluetooth keyboard on a tablet must
        // still be able to type straight into the field while the pad is closed.
        onChange={handleTypedChange}
        // Blur-commit ONLY off the pad path. The provider blurs this field in
        // order to open the pad, so committing on blur there would save the old
        // value the instant the pad appeared — the save-on-open bug.
        onBlur={usePad ? undefined : () => { setDraft(null); onCommit?.(value); }}
        // readOnly is passed through only when the CALLER asks for it. It is never
        // used to suppress the keypad: that would refuse a Bluetooth keyboard,
        // announce every field as uneditable, and drop them out of native
        // `required` validation. inputMode="none" alone stops the OS keypad.
        aria-haspopup={usePad ? 'dialog' : undefined}
        className={
          inputClassName ||
          'w-full min-h-[48px] rounded-lg border-[1.5px] border-gray-200 bg-gray-50 px-3 text-[var(--fs-base)] text-gray-900 outline-none focus:border-green-600 focus:bg-white tabular-nums'
        }
      />
      {sublabel && <div className="mt-1 text-[12px] text-gray-500">{sublabel}</div>}
    </div>
  );
}
