#!/usr/bin/env node
/**
 * Patch: Add supertitle to Header for clear screen identification.
 * Run AFTER patch_receive_flow.js, from /opt/krawings-portal:
 *   node scripts/patch_supertitle.js
 */
const fs = require('fs');
const path = require('path');

const FILE = path.join(__dirname, '..', 'src/app/purchase/page.tsx');
let content = fs.readFileSync(FILE, 'utf8');
const original = content;
let changes = 0;

function replace(search, replacement, label) {
  if (!content.includes(search)) {
    console.error('FAILED: ' + label);
    console.error('  Search: ' + JSON.stringify(search).slice(0, 140));
    process.exit(1);
  }
  content = content.replace(search, replacement);
  changes++;
  console.log('OK: ' + label);
}

// 1. Update Header component to support supertitle prop
replace(
  'const Header = ({ title, subtitle, showBack, onBack }: { title: string; subtitle?: string; showBack?: boolean; onBack?: () => void }) => (',
  'const Header = ({ supertitle, title, subtitle, showBack, onBack }: { supertitle?: string; title: string; subtitle?: string; showBack?: boolean; onBack?: () => void }) => (',
  'Add supertitle to Header props'
);

// 2. Render supertitle above title in header
replace(
  '<div className="flex-1"><h1 className="text-[20px] font-bold text-white">{title}</h1>{subtitle && <p className="text-[12px] text-white/45 mt-0.5">{subtitle}</p>}</div>',
  '<div className="flex-1">{supertitle && <div className="text-[10px] font-bold tracking-[0.08em] uppercase text-white/50 mb-0.5">{supertitle}</div>}<h1 className="text-[18px] font-bold text-white leading-tight">{title}</h1>{subtitle && <p className="text-[12px] text-white/45 mt-0.5">{subtitle}</p>}</div>',
  'Render supertitle in Header'
);

// 3. Order guide screen
replace(
  "screen === 'guide' ? (<><Header title={guideSupplierName} subtitle={`${locName}",
  "screen === 'guide' ? (<><Header supertitle=\"Order guide\" title={guideSupplierName} subtitle={`${locName}",
  'Guide screen supertitle'
);

// 4. Manage screen
replace(
  'screen === \'manage\' ? (<><Header title="Manage Purchases" subtitle="Guides, suppliers, settings"',
  'screen === \'manage\' ? (<><Header supertitle="Settings" title="Manage Purchases" subtitle="Guides, suppliers, settings"',
  'Manage screen supertitle'
);

// 5. Manage guide screen — use regex to replace the whole subtitle cleanly
var mgOld = "screen === 'manage-guide' ? (<><Header title={guideSupplierName} subtitle={`Edit guide";
if (!content.includes(mgOld)) {
  console.error('FAILED: Manage guide supertitle');
  process.exit(1);
}
// Find and replace the full Header tag for manage-guide
var mgStart = content.indexOf(mgOld);
// Find the closing /> of this Header
var mgHeaderEnd = content.indexOf('/>', mgStart);
var mgFull = content.slice(mgStart, mgHeaderEnd + 2);
// Build the new header: supertitle = Edit guide, subtitle = just location + count
var mgNew = mgFull
  .replace('title={guideSupplierName} subtitle={`Edit guide', 'supertitle="Edit guide" title={guideSupplierName} subtitle={`');
// Also clean up the leading bullet from subtitle
mgNew = mgNew.replace("subtitle={`", "subtitle={`");
// Remove the bullet and space after Edit guide was removed
// The template literal now starts with " \u2022 " — strip that
mgNew = mgNew.replace(/subtitle=\{`\s*\u2022\s*/, 'subtitle={`');
content = content.replace(mgFull, mgNew);
changes++;
console.log('OK: Manage guide supertitle');

// 6. Review order screen
replace(
  '<><Header title="Review order" subtitle={reviewCart?.supplier_name} showBack onBack={() => { setScreen(\'cart\'); setTab(\'cart\'); }}',
  '<><Header supertitle="Review order" title={reviewCart?.supplier_name || "Order"} subtitle={locName} showBack onBack={() => { setScreen(\'cart\'); setTab(\'cart\'); }}',
  'Review order supertitle'
);

// 7. Receive check screen
replace(
  '<><Header title={selectedOrder?.supplier_name || \'Receive\'} subtitle={selectedOrder?.odoo_po_name || \'\'} showBack onBack={() => { setScreen(\'receive-list\'); setTab(\'receive\'); }}',
  '<><Header supertitle="Receive delivery" title={selectedOrder?.supplier_name || \'Receive\'} subtitle={selectedOrder?.odoo_po_name || \'\'} showBack onBack={() => { setScreen(\'receive-list\'); setTab(\'receive\'); }}',
  'Receive check supertitle'
);

// 8. Receive review screen
replace(
  '<><Header title="Review receipt" subtitle={selectedOrder?.supplier_name} showBack onBack={() => setScreen(\'receive-check\')',
  '<><Header supertitle="Review receipt" title={selectedOrder?.supplier_name || "Receipt"} subtitle={selectedOrder?.odoo_po_name || \'\'} showBack onBack={() => setScreen(\'receive-check\')',
  'Receive review supertitle'
);

// 9. Report issue screen
replace(
  '<><Header title="Report issue" showBack onBack={() => setScreen(\'receive-check\')',
  '<><Header supertitle="Report issue" title={issueLine?.product_name || "Issue"} showBack onBack={() => setScreen(\'receive-check\')',
  'Report issue supertitle'
);

// 10. Order detail screen
replace(
  '<><Header title="Order details" showBack onBack={() => { setScreen(\'history\'); setTab(\'history\'); }}',
  '<><Header supertitle="Order details" title={selectedOrder?.supplier_name || "Order"} subtitle={selectedOrder?.odoo_po_name || \'\'} showBack onBack={() => { setScreen(\'history\'); setTab(\'history\'); }}',
  'Order detail supertitle'
);

fs.writeFileSync(FILE, content, 'utf8');
console.log('\nDone! Applied ' + changes + ' changes.');
console.log('  Original: ' + original.length + ' chars');
console.log('  Patched:  ' + content.length + ' chars');
console.log('\nNext: npm run build && systemctl restart krawings-portal');
