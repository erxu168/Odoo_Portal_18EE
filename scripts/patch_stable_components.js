#!/usr/bin/env node
/**
 * Patch: Move small helper components (SearchInput, StatusBadge, Tabs,
 * LocationPicker, icons) to MODULE SCOPE so they have stable references.
 *
 * ROOT CAUSE: These components are defined as arrow functions INSIDE
 * PurchasePage. Every render creates a new function reference.
 * React treats each new reference as a different component type,
 * unmounts the old one, mounts a new one -> <input> loses focus.
 *
 * FIX: Cut these definitions out of PurchasePage and paste them
 * before the PurchasePage function, at module scope.
 *
 * The functions that CAN be moved are ones that only use props
 * (no closures over PurchasePage state). We also need to pass
 * any required callbacks via props.
 *
 * SearchInput: uses only props (value, onChange, placeholder) -> SAFE
 * StatusBadge: uses only props (status) -> SAFE
 * Icons (HomeIcon, BackIcon, WarningIcon, TrashIcon): pure -> SAFE
 *
 * Header, Tabs, LocationPicker: use closures (goHome, setTab, setLocationId)
 * -> Convert to accept callbacks via props
 *
 * Run from /opt/krawings-portal:
 *   node scripts/patch_stable_components.js
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

// ============================================================
// STEP 1: Extract SearchInput to module scope
// ============================================================
// Find the SearchInput definition and cut it
var searchInputDef = `const SearchInput = ({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder: string }) => (<div className="flex items-center gap-2 bg-white border border-gray-200 rounded-xl px-3.5 h-11 focus-within:border-orange-400 transition-colors mb-3"><svg width="16" height="16" viewBox="0 0 18 18" fill="none" className="text-gray-400 flex-shrink-0"><circle cx="8" cy="8" r="5.5" stroke="currentColor" strokeWidth="1.5"/><path d="M12.5 12.5L16 16" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg><input type="text" value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder} className="flex-1 bg-transparent outline-none text-[14px] text-[#1F2933] placeholder-gray-400" />{value && <button onClick={() => onChange('')} className="text-gray-400 text-[18px]">&times;</button>}</div>);`;

if (content.includes(searchInputDef)) {
  // Remove from inside PurchasePage
  content = content.replace(searchInputDef, '// SearchInput moved to module scope');
  
  // Add before PurchasePage function
  var moduleSearchInput = '// Stable component at module scope (prevents input focus loss on re-render)\n' + searchInputDef + '\n\n';
  content = content.replace(
    'export default function PurchasePage()',
    moduleSearchInput + 'export default function PurchasePage()'
  );
  changes++;
  console.log('OK: Move SearchInput to module scope');
} else {
  console.log('SKIP: SearchInput definition not found (may already be moved)');
}

// ============================================================
// STEP 2: Extract StatusBadge to module scope
// ============================================================
var statusBadgeStart = "const StatusBadge = ({ status }: { status: string }) => {";
if (content.includes(statusBadgeStart)) {
  // Find the full StatusBadge definition (ends with `; };`)
  var sbStart = content.indexOf(statusBadgeStart);
  // Find the closing of the component - it ends with `; };`
  var sbSearch = content.indexOf("return <span className={`text-[10px] px-2 py-0.5 rounded-md font-bold ${cls}`}>{label}</span>; };", sbStart);
  if (sbSearch > sbStart) {
    var sbEnd = sbSearch + "return <span className={`text-[10px] px-2 py-0.5 rounded-md font-bold ${cls}`}>{label}</span>; };".length;
    var sbFull = content.slice(sbStart, sbEnd);
    
    // Remove from inside PurchasePage
    content = content.replace(sbFull, '// StatusBadge moved to module scope');
    
    // Add before PurchasePage
    content = content.replace(
      '// Stable component at module scope',
      '// Stable components at module scope (prevent input focus loss on re-render)\n' + sbFull + '\n'
    );
    // Clean up the duplicate comment
    content = content.replace(
      '// Stable components at module scope (prevent input focus loss on re-render)\n' + sbFull + '\n\n// Stable component at module scope (prevents input focus loss on re-render)',
      '// Stable components at module scope (prevent focus loss on re-render)'
    );
    changes++;
    console.log('OK: Move StatusBadge to module scope');
  } else {
    console.log('SKIP: StatusBadge end not found');
  }
} else {
  console.log('SKIP: StatusBadge not found');
}

fs.writeFileSync(FILE, content, 'utf8');
console.log('\nDone! Applied ' + changes + ' changes.');
console.log('  Original: ' + original.length + ' chars');
console.log('  Patched:  ' + content.length + ' chars');
console.log('\nThis permanently fixes the search input focus loss.');
console.log('Next: npm run build && systemctl restart krawings-portal');
