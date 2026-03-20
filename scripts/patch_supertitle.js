#!/usr/bin/env node
/**
 * Patch: Add supertitle to Header for screen identification.
 * Run from /opt/krawings-portal:
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
    console.error('  Search: ' + JSON.stringify(search).slice(0, 120));
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

// 2. Render supertitle above title
replace(
  '<div className="flex-1"><h1 className="text-[20px] font-bold text-white">{title}</h1>{subtitle && <p className="text-[12px] text-white/45 mt-0.5">{subtitle}</p>}</div>',
  '<div className="flex-1">{supertitle && <div className="text-[10px] font-bold tracking-[0.08em] uppercase text-white/50 mb-0.5">{supertitle}</div>}<h1 className="text-[20px] font-bold text-white">{title}</h1>{subtitle && <p className="text-[12px] text-white/45 mt-0.5">{subtitle}</p>}</div>',
  'Render supertitle in Header'
);

// 3. Order guide screen: add supertitle
replace(
  "screen === 'guide' ? (<><Header title={guideSupplierName} subtitle={`${locName}",
  "screen === 'guide' ? (<><Header supertitle=\"Order guide\" title={guideSupplierName} subtitle={`${locName}",
  'Guide screen supertitle'
);

// 4. Manage screen: add supertitle
replace(
  'screen === \'manage\' ? (<><Header title="Manage Purchases" subtitle="Guides, suppliers, settings"',
  'screen === \'manage\' ? (<><Header supertitle="Settings" title="Manage Purchases" subtitle="Guides, suppliers, settings"',
  'Manage screen supertitle'
);

// 5. Manage guide screen: change title to supplier name, supertitle = Edit guide
replace(
  "screen === 'manage-guide' ? (<><Header title={guideSupplierName} subtitle={`Edit guide",
  "screen === 'manage-guide' ? (<><Header supertitle=\"Edit guide\" title={guideSupplierName} subtitle={`",
  'Manage guide supertitle'
);

// 6. Review order screen: add supertitle
replace(
  'screen === \'review\' ? (<><Header title="Review order" subtitle={reviewCart?.supplier_name}',
  'screen === \'review\' ? (<><Header supertitle="Review order" title={reviewCart?.supplier_name || "Order"} subtitle={`${locName}'}',
  'Review order supertitle'
);

// Actually that last one is tricky with the subtitle. Let me be more precise.
// Revert and redo #6 more carefully
// The original line after patches is:
// ) : screen === 'review' ? (<><Header title="Review order" subtitle={reviewCart?.supplier_name} showBack onBack={() => { setScreen('cart'); setTab('cart'); }} />
content = content.replace(
  'screen === \'review\' ? (<><Header supertitle="Review order" title={reviewCart?.supplier_name || "Order"} subtitle={`${locName}\'}',
  'screen === \'review\' ? (<><Header title="Review order" subtitle={reviewCart?.supplier_name}'
);
changes--;

// Redo #6 properly
replace(
  '<><Header title="Review order" subtitle={reviewCart?.supplier_name} showBack onBack={() => { setScreen(\'cart\'); setTab(\'cart\'); }}',
  '<><Header supertitle="Review order" title={reviewCart?.supplier_name || "Order"} subtitle={locName} showBack onBack={() => { setScreen(\'cart\'); setTab(\'cart\'); }}',
  'Review order supertitle (fixed)'
);

// 7. Receive check screen: add supertitle
replace(
  '<><Header title={selectedOrder?.supplier_name || \'Receive\'} subtitle={selectedOrder?.odoo_po_name || \'\'} showBack onBack={() => { setScreen(\'receive-list\'); setTab(\'receive\'); }}',
  '<><Header supertitle="Receive delivery" title={selectedOrder?.supplier_name || \'Receive\'} subtitle={selectedOrder?.odoo_po_name || \'\'} showBack onBack={() => { setScreen(\'receive-list\'); setTab(\'receive\'); }}',
  'Receive check supertitle'
);

// 8. Receive review screen: add supertitle
replace(
  '<><Header title="Review receipt" subtitle={selectedOrder?.supplier_name} showBack onBack={() => setScreen(\'receive-check\')}',
  '<><Header supertitle="Review receipt" title={selectedOrder?.supplier_name || "Receipt"} subtitle={selectedOrder?.odoo_po_name || \'\'} showBack onBack={() => setScreen(\'receive-check\')}',
  'Receive review supertitle'
);

// 9. Report issue screen: add supertitle
replace(
  '<><Header title="Report issue" showBack onBack={() => setScreen(\'receive-check\')}',
  '<><Header supertitle="Report issue" title={issueLine?.product_name || "Issue"} showBack onBack={() => setScreen(\'receive-check\')}',
  'Report issue supertitle'
);

// 10. Order detail screen: add supertitle
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
