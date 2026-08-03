#!/usr/bin/env node
/**
 * Fails when a raw number input is added outside the shared components.
 *
 * Android's keypad covers the field you are typing into, which is why every
 * number-only field goes through ui/NumberField (or ui/useNumpadField when the
 * number is not an input element). Spec:
 * docs/superpowers/specs/2026-08-03-android-keyboard-numpad-design.md
 *
 * Run: node scripts/check-numeric-inputs.mjs
 *
 * WHAT THIS CANNOT SEE: a hand-rolled keypad — a digit array mapped into
 * buttons. Two of those hid in the recipes module through an entire audit
 * because they contain neither `type="number"` nor `inputMode`. If you are
 * looking for pads, grep for a digit array, not for an attribute.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const SRC = join(ROOT, 'src');

/**
 * Whole files that ARE the mechanism, or are nothing but native-keyboard entry.
 *
 * Keep this list tiny. A file-level skip once hid two real quantity inputs
 * inside BarcodeScanner.tsx and the guard passed while the sweep was
 * incomplete — so anything with MIXED content marks the individual line with
 * `keyboard-exempt: <reason>` instead (see EXEMPT_MARKER below).
 */
const ALLOWED = new Set([
  // The shared components — they ARE the mechanism.
  'src/components/ui/NumberField.tsx',
  'src/components/ui/NumpadCore.tsx',
  'src/components/ui/NumpadProvider.tsx',
  // Phone numbers need "+" and country codes; OTP needs SMS autofill.
  'src/components/ui/PhoneInput.tsx',
  // Masked PIN entry: dots, and auto-submit on the last digit. The shared pad
  // shows the value and waits for Confirm, so converting these is a regression.
  'src/components/ui/SignInSheet.tsx',
  'src/components/tablet/PinPad.tsx',
  'src/components/station/StationSignIn.tsx',
  'src/app/kiosk/page.tsx',
  'src/app/kiosk/reset-pin/page.tsx',
]);

const PATTERN = /type="number"|inputMode="(numeric|decimal)"/;

/**
 * Per-line opt-out. Put it on the line itself or the line above, WITH a reason:
 * Put a JSX comment reading "keyboard-exempt: <reason>" on the offending line
 * or within the five lines above it. The reason belongs next to the code,
 * where the next reader will look for it.
 */
const EXEMPT_MARKER = 'keyboard-exempt';

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (entry.endsWith('.tsx')) out.push(full);
  }
  return out;
}

const offenders = [];
for (const file of walk(SRC)) {
  const rel = relative(ROOT, file);
  if (ALLOWED.has(rel)) continue;
  const lines = readFileSync(file, 'utf8').split('\n');
  lines.forEach((line, i) => {
    if (!PATTERN.test(line)) return;
    // Looks a few lines up: in JSX the attribute sits inside an element whose
    // explaining comment naturally lands above the opening tag.
    const window = lines.slice(Math.max(0, i - 5), i + 1);
    const marked = window.some((l) => l.includes(EXEMPT_MARKER));
    if (!marked) offenders.push(`${rel}:${i + 1}`);
  });
}

if (offenders.length) {
  console.error('\nRaw number inputs found outside the shared components:\n');
  for (const o of offenders) console.error('  ' + o);
  console.error(
    '\nUse ui/NumberField instead (or ui/useNumpadField when the number is not an input),' +
    '\nso Android’s keypad never covers the field being typed into.' +
    '\nIf this field genuinely needs a native keyboard — a phone number, an OTP, a' +
    '\nmasked PIN, a barcode scan target — mark THAT LINE (or the line above) with' +
    '\n"keyboard-exempt: <reason>". Whole-file exemptions hide the next mistake.\n',
  );
  process.exit(1);
}

console.log(`No unmarked raw number inputs (${ALLOWED.size} exempt files, plus per-line \`${EXEMPT_MARKER}\` markers).`);
