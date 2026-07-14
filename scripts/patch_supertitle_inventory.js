#!/usr/bin/env node
/**
 * Patch: Add supertitle to Inventory module headers.
 * Run from /opt/krawings-portal:
 *   node scripts/patch_supertitle_inventory.js
 */
const fs = require('fs');
const path = require('path');

const FILE = path.join(__dirname, '..', 'src/app/inventory/page.tsx');
let content = fs.readFileSync(FILE, 'utf8');
let changes = 0;

function replace(search, replacement, label) {
  if (!content.includes(search)) {
    console.error('FAILED: ' + label);
    console.error('  Search: ' + JSON.stringify(search).slice(0, 120));
    process.exit(1);
  }
  content = content.replace(search, replacement);
  changes++;
  console.log('OK: ' + label);
}

// Quick Count header
replace(
  '<div className="flex-1">\n                  <h1 className="text-[20px] font-bold text-white">Quick Count</h1>\n                  <p className="text-[12px] text-white/50 mt-0.5">Search any product, enter quantity</p>',
  '<div className="flex-1">\n                  <div className="text-[10px] font-bold tracking-[0.08em] uppercase text-white/50 mb-0.5">Inventory</div>\n                  <h1 className="text-[18px] font-bold text-white leading-tight">Quick Count</h1>\n                  <p className="text-[12px] text-white/45 mt-0.5">Search any product, enter quantity</p>',
  'Quick Count supertitle'
);

// Manage Lists header
replace(
  '<div className="flex-1">\n                  <h1 className="text-[20px] font-bold text-white">Manage Lists</h1>\n                  <p className="text-[12px] text-white/50 mt-0.5">Create and manage counting templates</p>',
  '<div className="flex-1">\n                  <div className="text-[10px] font-bold tracking-[0.08em] uppercase text-white/50 mb-0.5">Inventory</div>\n                  <h1 className="text-[18px] font-bold text-white leading-tight">Manage Lists</h1>\n                  <p className="text-[12px] text-white/45 mt-0.5">Create and manage counting templates</p>',
  'Manage Lists supertitle'
);

// Review header
replace(
  '<div className="flex-1">\n                  <h1 className="text-[20px] font-bold text-white">Review</h1>\n                  <p className="text-[12px] text-white/50 mt-0.5">Approve or reject submitted counts</p>',
  '<div className="flex-1">\n                  <div className="text-[10px] font-bold tracking-[0.08em] uppercase text-white/50 mb-0.5">Inventory</div>\n                  <h1 className="text-[18px] font-bold text-white leading-tight">Review</h1>\n                  <p className="text-[12px] text-white/45 mt-0.5">Approve or reject submitted counts</p>',
  'Review supertitle'
);

fs.writeFileSync(FILE, content, 'utf8');
console.log('\nDone! Applied ' + changes + ' changes to inventory.');
