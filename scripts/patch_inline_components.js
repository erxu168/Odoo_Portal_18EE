#!/usr/bin/env node
/**
 * Patch: Fix search input losing focus by converting inline component
 * JSX calls to direct function calls.
 *
 * Problem: Components like ManageGuideScreen are defined as arrow functions
 * INSIDE PurchasePage. Using <ManageGuideScreen /> creates a new component
 * type on every render, causing React to unmount/remount and lose input focus.
 *
 * Fix: Change <ComponentName /> to {ComponentName()} so React treats the
 * output as inline JSX in the parent tree.
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

const replacements = [
  ['<SupplierList />', '{SupplierList()}'],
  ['<OrderGuide />', '{OrderGuide()}'],
  ['<CartView />', '{CartView()}'],
  ['<ReviewOrder />', '{ReviewOrder()}'],
  ['<OrderSent />', '{OrderSent()}'],
  ['<HistoryView />', '{HistoryView()}'],
  ['<OrderDetail />', '{OrderDetail()}'],
  ['<ReceiveList />', '{ReceiveList()}'],
  ['<ReceiveCheck />', '{ReceiveCheck()}'],
  ['<ReceiveIssue />', '{ReceiveIssue()}'],
  ['<ManageScreen />', '{ManageScreen()}'],
  ['<ManageGuideScreen />', '{ManageGuideScreen()}'],
];

for (const [search, replacement] of replacements) {
  if (content.includes(search)) {
    content = content.split(search).join(replacement);
    changes++;
    console.log('OK: ' + search + ' -> ' + replacement);
  } else {
    console.log('SKIP (not found): ' + search);
  }
}

fs.writeFileSync(FILE, content, 'utf8');
console.log('\nDone! Fixed ' + changes + ' inline component calls.');
console.log('  Original: ' + original.length + ' chars');
console.log('  Patched:  ' + content.length + ' chars');
