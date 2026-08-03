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

/** The shared implementation itself, plus the fields that deliberately keep a native keyboard. */
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
  // The scanner's hidden input receives a hardware scan, never a human number.
  'src/components/ui/BarcodeScanner.tsx',
  // "On day -1" means the last day of the month, and the pad has no minus key.
  'src/app/tasks/_components/RecurrenceEditor.tsx',
  // Scan targets. The pad DISCARDS scanner bursts by design, so routing a field
  // a scanner aims at through it makes a fast scanner do nothing and a slow one
  // auto-commit — behaviour that varies by scanner model.
  'src/components/inventory/DrinksScanner.tsx',
  'src/components/products/CreateProductSheet.tsx',
  // PIN entry, same reason as the other PIN screens above: the pad renders its
  // buffer at 36px in a full-width sheet, in front of whoever else is standing there.
  'src/components/shifts/MyPin.tsx',
  'src/components/shifts/RosterCaps.tsx',
]);

const PATTERN = /type="number"|inputMode="(numeric|decimal)"/;

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
    if (PATTERN.test(line)) offenders.push(`${rel}:${i + 1}`);
  });
}

if (offenders.length) {
  console.error('\nRaw number inputs found outside the shared components:\n');
  for (const o of offenders) console.error('  ' + o);
  console.error(
    '\nUse ui/NumberField instead (or ui/useNumpadField when the number is not an input),' +
    '\nso Android’s keypad never covers the field being typed into.' +
    '\nIf this field genuinely needs a native keyboard — a phone number, an OTP, a masked' +
    '\nPIN — add it to ALLOWED in scripts/check-numeric-inputs.mjs with the reason.\n',
  );
  process.exit(1);
}

console.log(`No raw number inputs outside the shared components (${ALLOWED.size} deliberate exemptions).`);
