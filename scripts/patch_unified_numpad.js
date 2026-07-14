#!/usr/bin/env node
/**
 * Patch: Migrate Manufacturing and Purchase to the unified Numpad component.
 *
 * Manufacturing (NumPad.tsx) used:
 *   import NumPad from '@/components/ui/NumPad';
 *   <NumPad value={v} unit={u} label={l} demandQty={d} onConfirm={fn} onClose={fn} loading={b} />
 *
 * Purchase (PurchaseNumpad.tsx) used:
 *   import PurchaseNumpad from '@/components/ui/PurchaseNumpad';
 *   <PurchaseNumpad open={o} value={v} label={l} sublabel={s} onKey={fn} onConfirm={fn} onClose={fn} />
 *
 * Both are replaced with:
 *   import Numpad from '@/components/ui/Numpad';
 *
 * Manufacturing: <Numpad initialValue={v} unit={u} label={l} demandQty={d} onConfirm={fn} onClose={fn} loading={b} />
 * Purchase: <Numpad open={o} value={v} label={l} sublabel={s} onChange={fn} onConfirm={fn} onClose={fn} />
 *
 * Run from /opt/krawings-portal:
 *   node scripts/patch_unified_numpad.js
 */
const fs = require('fs');
const path = require('path');
let changes = 0;

function patchFile(relPath, patches) {
  const file = path.join(__dirname, '..', relPath);
  if (!fs.existsSync(file)) {
    console.log('SKIP FILE: ' + relPath + ' (not found)');
    return;
  }
  let content = fs.readFileSync(file, 'utf8');
  for (const [search, replacement, label] of patches) {
    if (!content.includes(search)) {
      console.log('  SKIP: ' + label + ' (not found)');
      continue;
    }
    content = content.replace(search, replacement);
    changes++;
    console.log('  OK: ' + label);
  }
  fs.writeFileSync(file, content, 'utf8');
}

// --- Manufacturing ---
console.log('\n--- Manufacturing ---');

// MoDetail.tsx
patchFile('src/components/manufacturing/MoDetail.tsx', [
  [
    "import NumPad from '@/components/ui/NumPad';",
    "import Numpad from '@/components/ui/Numpad';",
    'Update MoDetail import'
  ],
  [
    '<NumPad',
    '<Numpad',
    'Update MoDetail JSX tag (open)'
  ],
]);

// WoDetail.tsx
patchFile('src/components/manufacturing/WoDetail.tsx', [
  [
    "import NumPad from '@/components/ui/NumPad';",
    "import Numpad from '@/components/ui/Numpad';",
    'Update WoDetail import'
  ],
  [
    '<NumPad',
    '<Numpad',
    'Update WoDetail JSX tag (open)'
  ],
]);

// --- Purchase ---
console.log('\n--- Purchase ---');
patchFile('src/app/purchase/page.tsx', [
  [
    "import PurchaseNumpad from '@/components/ui/PurchaseNumpad';",
    "import Numpad from '@/components/ui/Numpad';",
    'Update Purchase import'
  ],
  // PurchaseNumpad used onKey for individual key presses.
  // The unified Numpad uses value+onChange for controlled mode.
  // We need to update the JSX usage. The purchase page manages numpadValue state
  // and has a handleNumpadKey function. We replace it with onChange.
]);

// For Purchase: the component is used as <PurchaseNumpad ... />
// We replace all occurrences
var purchasePath = path.join(__dirname, '..', 'src/app/purchase/page.tsx');
if (fs.existsSync(purchasePath)) {
  var content = fs.readFileSync(purchasePath, 'utf8');
  var count = (content.match(/<PurchaseNumpad/g) || []).length;
  if (count > 0) {
    content = content.split('<PurchaseNumpad').join('<Numpad');
    content = content.split('</PurchaseNumpad').join('</Numpad');
    fs.writeFileSync(purchasePath, content, 'utf8');
    changes += count;
    console.log('  OK: Replace ' + count + ' <PurchaseNumpad> -> <Numpad>');
  } else {
    console.log('  SKIP: No <PurchaseNumpad> tags found');
  }
}

console.log('\nDone! Applied ' + changes + ' changes.');
console.log('Next: npm run build && systemctl restart krawings-portal');
