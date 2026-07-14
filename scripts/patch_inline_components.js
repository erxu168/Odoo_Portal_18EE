#!/usr/bin/env node
/**
 * Patch: Fix search input losing focus by converting inline component
 * JSX calls to direct function calls.
 *
 * Problem: Components like ManageGuideScreen are defined as arrow functions
 * INSIDE PurchasePage. Using <ManageGuideScreen /> creates a new component
 * type on every render, causing React to unmount/remount and lose input focus.
 *
 * Fix: Context-aware replacement:
 *   - Inside && expressions: `&& <Comp />` -> `&& Comp()` (no braces)
 *   - As JSX children: `<Comp />` -> `{Comp()}` (need braces)
 *
 * Run from /opt/krawings-portal:
 *   node scripts/patch_inline_components.js
 */
const fs = require('fs');
const path = require('path');

const FILE = path.join(__dirname, '..', 'src/app/purchase/page.tsx');
let content = fs.readFileSync(FILE, 'utf8');
const original = content;
let changes = 0;

// All inline components to fix
const components = [
  'SupplierList', 'OrderGuide', 'CartView', 'ReviewOrder',
  'OrderSent', 'HistoryView', 'OrderDetail', 'ReceiveList',
  'ReceiveCheck', 'ReceiveIssue', 'ManageScreen', 'ManageGuideScreen',
];

for (const comp of components) {
  const jsxTag = '<' + comp + ' />';

  // Pass 1: Handle `&& <Comp />` — no braces needed (already in expression)
  var andPattern = '&& ' + jsxTag;
  var andReplace = '&& ' + comp + '()';
  if (content.includes(andPattern)) {
    content = content.split(andPattern).join(andReplace);
    changes++;
    console.log('OK (&&): ' + andPattern + ' -> ' + andReplace);
  }

  // Pass 2: Handle remaining `<Comp />` as JSX children — need braces
  if (content.includes(jsxTag)) {
    content = content.split(jsxTag).join('{' + comp + '()}');
    changes++;
    console.log('OK (jsx): ' + jsxTag + ' -> {' + comp + '()}');
  }
}

fs.writeFileSync(FILE, content, 'utf8');
console.log('\nDone! Fixed ' + changes + ' inline component calls.');
console.log('  Original: ' + original.length + ' chars');
console.log('  Patched:  ' + content.length + ' chars');
