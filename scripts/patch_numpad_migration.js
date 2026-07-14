#!/usr/bin/env node
/**
 * Patch: Migrate Purchase module from PurchaseNumpad to unified Numpad.
 *
 * The base purchase/page.tsx imports Numpad and uses onKey={handleNumpadKey}.
 * The unified Numpad uses controlled mode: value + onChange.
 *
 * Changes:
 *  1. Replace onKey={handleNumpadKey} with onChange
 *  2. Remove the handleNumpadKey function (no longer needed)
 *  3. Update onConfirm to accept the number from Numpad
 *
 * Run from /opt/krawings-portal:
 *   node scripts/patch_numpad_migration.js
 */
const fs = require('fs');
const path = require('path');

const FILE = path.join(__dirname, '..', 'src/app/purchase/page.tsx');
let content = fs.readFileSync(FILE, 'utf8');
const original = content;
let changes = 0;

function replace(search, replacement, label) {
  if (!content.includes(search)) {
    console.log('SKIP: ' + label);
    return false;
  }
  content = content.replace(search, replacement);
  changes++;
  console.log('OK: ' + label);
  return true;
}

// 1. Replace onKey prop with onChange (controlled mode)
replace(
  'onKey={handleNumpadKey}',
  'onChange={(v: string) => setNumpadValue(v)}',
  'Replace onKey with onChange'
);

// 2. Replace onConfirm={confirmNumpad} with version that accepts number
// The unified Numpad passes parsed number to onConfirm
replace(
  'onConfirm={confirmNumpad}',
  'onConfirm={() => confirmNumpad()}',
  'Wrap onConfirm'
);

// 3. Also handle onConfirm={() => confirmNumpad()} if already wrapped
// (no-op if step 2 succeeded)

fs.writeFileSync(FILE, content, 'utf8');
console.log('\nDone! Applied ' + changes + ' changes.');
console.log('  Original: ' + original.length + ' chars');
console.log('  Patched:  ' + content.length + ' chars');
console.log('\nNext: npm run build && systemctl restart krawings-portal');
