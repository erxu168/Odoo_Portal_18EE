#!/usr/bin/env node
/**
 * Patch: Add supertitle to Manufacturing module headers.
 * Run from /opt/krawings-portal:
 *   node scripts/patch_supertitle_manufacturing.js
 */
const fs = require('fs');
const path = require('path');
let changes = 0;

function patchFile(relPath, patches) {
  const file = path.join(__dirname, '..', relPath);
  let content = fs.readFileSync(file, 'utf8');
  for (const [search, replacement, label] of patches) {
    if (!content.includes(search)) {
      console.error('FAILED [' + relPath + ']: ' + label);
      console.error('  Search: ' + JSON.stringify(search).slice(0, 120));
      process.exit(1);
    }
    content = content.replace(search, replacement);
    changes++;
    console.log('OK [' + relPath + ']: ' + label);
  }
  fs.writeFileSync(file, content, 'utf8');
}

// --- MoDetail.tsx: Add supertitle above product name ---
patchFile('src/components/manufacturing/MoDetail.tsx', [
  [
    '<div className="flex-1">\n            <h1 className="text-[18px] font-bold text-gray-900">{mo.product_id[1]}</h1>',
    '<div className="flex-1">\n            <div className="text-[10px] font-bold tracking-[0.08em] uppercase text-gray-400 mb-0.5">Manufacturing order</div>\n            <h1 className="text-[18px] font-bold text-gray-900">{mo.product_id[1]}</h1>',
    'MoDetail supertitle'
  ]
]);

// --- WoDetail.tsx: Add supertitle above WO name ---
patchFile('src/components/manufacturing/WoDetail.tsx', [
  [
    '<h1 className="text-[18px] font-bold text-gray-900">{wo.name}</h1>\n        <p className="text-[13px] text-gray-500 mt-0.5">{wo.workcenter_id[1]}',
    '<div className="text-[10px] font-bold tracking-[0.08em] uppercase text-gray-400 mb-0.5">Work order</div>\n        <h1 className="text-[18px] font-bold text-gray-900">{wo.name}</h1>\n        <p className="text-[13px] text-gray-500 mt-0.5">{wo.workcenter_id[1]}',
    'WoDetail supertitle'
  ]
]);

console.log('\nDone! Applied ' + changes + ' changes to manufacturing.');
