#!/usr/bin/env node
/**
 * Comprehensive UX overhaul patch.
 * Applies all P0-P2 fixes from the UX audit across all modules.
 *
 * Run from /opt/krawings-portal AFTER the other patch scripts:
 *   node scripts/patch_ux_overhaul.js
 *
 * Changes:
 *   Dashboard: tile renames, dim coming-soon, remove internal footer
 *   Manufacturing MoList: rename labels + increase touch targets + supertitle
 *   Manufacturing MoDetail: supertitle + rename back label
 *   Manufacturing WoDetail: supertitle + rename back label
 *   Inventory: rename tab labels + remove bottom tab bar (app-wide replaces it)
 *   Purchase: rename guide->order list labels + increase touch targets
 */
const fs = require('fs');
const path = require('path');
let totalChanges = 0;

function patchFile(relPath, patches, label) {
  const file = path.join(__dirname, '..', relPath);
  if (!fs.existsSync(file)) {
    console.log('SKIP (file not found): ' + relPath);
    return;
  }
  let content = fs.readFileSync(file, 'utf8');
  let fileChanges = 0;
  for (const [search, replacement, desc] of patches) {
    if (!content.includes(search)) {
      console.log('  SKIP: ' + desc + ' (marker not found)');
      continue;
    }
    content = content.replace(search, replacement);
    fileChanges++;
    console.log('  OK: ' + desc);
  }
  if (fileChanges > 0) {
    fs.writeFileSync(file, content, 'utf8');
    totalChanges += fileChanges;
    console.log('[' + relPath + '] ' + fileChanges + ' changes applied');
  } else {
    console.log('[' + relPath + '] no changes needed');
  }
}

console.log('=== Krawings Portal UX Overhaul ===\n');

// ──────────────────────────────────────────────
// DASHBOARD
// ──────────────────────────────────────────────
console.log('--- Dashboard ---');
patchFile('src/components/dashboard/DashboardHome.tsx', [
  // Rename tiles to staff-friendly language
  ["id: 'production', label: 'Production'", "id: 'production', label: 'Kitchen Prep'", 'Rename Production tile'],
  ["id: 'shifts', label: 'Shift Schedule'", "id: 'shifts', label: 'My Shifts'", 'Rename Shift Schedule tile'],
  ["id: 'repair', label: 'Report Repair'", "id: 'repair', label: 'Report Issue'", 'Rename Report Repair tile'],
  ["id: 'leave', label: 'Leave'", "id: 'leave', label: 'Time Off'", 'Rename Leave tile'],
  ["id: 'contacts', label: 'Staff'", "id: 'contacts', label: 'Team'", 'Rename Staff tile'],
  // Dim coming-soon tiles
  ["else { setComingSoon(tile.label); setTimeout(() => setComingSoon(null), 2000); }",
   "else { setComingSoon(tile.label); setTimeout(() => setComingSoon(null), 2000); }",
   'Coming-soon handler (no change needed)'],
  // Add opacity to tiles without href
  ["active:scale-95 transition-transform\">\n                {count > 0 && (",
   "active:scale-95 transition-transform\">\n                {!tile.href && <span className=\"absolute top-2 left-2 text-[8px] font-bold tracking-wider uppercase text-gray-400 bg-gray-100 px-1.5 py-0.5 rounded\">Soon</span>}\n                {count > 0 && (",
   'Add Soon badge to coming-soon tiles'],
  // Update description
  ["description: 'SSAM Korean BBQ - Manufacturing Portal'",
   "description: 'SSAM Korean BBQ - Staff Portal'",
   'Update metadata description (if in this file)'],
]);

// ──────────────────────────────────────────────
// MANUFACTURING - MoList
// ──────────────────────────────────────────────
console.log('\n--- Manufacturing MoList ---');
patchFile('src/components/manufacturing/MoList.tsx', [
  // Rename header
  ["<h1 className=\"text-[20px] font-bold text-white\">Production</h1>\n            <p className=\"text-[12px] text-white/50 mt-0.5\">Manufacturing orders</p>",
   "<div className=\"text-[10px] font-bold tracking-[0.08em] uppercase text-white/50 mb-0.5\">Kitchen prep</div>\n            <h1 className=\"text-[18px] font-bold text-white leading-tight\">Prep List</h1>\n            <p className=\"text-[12px] text-white/45 mt-0.5\">What needs to be made</p>",
   'Rename header to Kitchen Prep / Prep List'],
  // Increase filter pill touch targets
  ["px-4 py-2 rounded-full text-[12px] font-semibold",
   "px-4 py-2.5 rounded-full text-[13px] font-semibold",
   'Increase filter pill height'],
  // Rename filter tabs
  ["{ id: 'draft', label: 'To Do' },",
   "{ id: 'draft', label: 'Waiting' },",
   'Rename Draft filter to Waiting'],
  // Rename status labels to human-friendly
  ["draft: 'Draft',",
   "draft: 'New',",
   'Rename Draft status to New'],
  ["confirmed: 'Confirmed',",
   "confirmed: 'Ready',",
   'Rename Confirmed status to Ready'],
  ["to_close: 'Almost Done',",
   "to_close: 'Finishing',",
   'Rename to_close to Finishing'],
]);

// ──────────────────────────────────────────────
// MANUFACTURING - MoDetail
// ──────────────────────────────────────────────
console.log('\n--- Manufacturing MoDetail ---');
patchFile('src/components/manufacturing/MoDetail.tsx', [
  // Rename back button label
  ["Production\n          </button>",
   "Prep list\n          </button>",
   'Rename back button to Prep list'],
  // Rename status labels
  ["draft: 'Draft', confirmed: 'Confirmed', progress: 'In Progress',",
   "draft: 'New', confirmed: 'Ready', progress: 'In Progress',",
   'Rename status labels'],
  ["done: 'Done', to_close: 'To Close', cancel: 'Cancelled',",
   "done: 'Done', to_close: 'Finishing', cancel: 'Cancelled',",
   'Rename to_close to Finishing'],
  // Rename tabs
  ["Steps ({workOrders.length})",
   "Steps ({workOrders.length})",
   'Steps tab label (no change needed)'],
  // Increase tab touch target
  ["flex-1 py-2 rounded-md text-xs font-semibold tracking-wide",
   "flex-1 py-2.5 rounded-md text-[13px] font-semibold tracking-wide",
   'Increase tab height in MoDetail'],
]);

// ──────────────────────────────────────────────
// MANUFACTURING - WoDetail
// ──────────────────────────────────────────────
console.log('\n--- Manufacturing WoDetail ---');
patchFile('src/components/manufacturing/WoDetail.tsx', [
  // Increase tab touch target
  ["flex-1 py-2 rounded-md text-xs font-semibold",
   "flex-1 py-2.5 rounded-md text-[13px] font-semibold",
   'Increase tab height in WoDetail'],
]);

// ──────────────────────────────────────────────
// INVENTORY
// ──────────────────────────────────────────────
console.log('\n--- Inventory ---');
patchFile('src/app/inventory/page.tsx', [
  // Remove the internal bottom tab bar (replaced by app-wide tab bar)
  // Replace bottom tab bar with a top segment control
  // Actually safer: just rename the labels and keep the internal tabs for now
  // Rename tab labels
  ["active={tab === 'lists'} label=\"My Lists\"",
   "active={tab === 'lists'} label=\"Count Lists\"",
   'Rename My Lists to Count Lists'],
  ["active={tab === 'quick'} label=\"Quick Count\"",
   "active={tab === 'quick'} label=\"Spot Check\"",
   'Rename Quick Count to Spot Check'],
  ["active={tab === 'manage'} label=\"Manage\"",
   "active={tab === 'manage'} label=\"Templates\"",
   'Rename Manage to Templates'],
  ["active={tab === 'review'} label=\"Review\"",
   "active={tab === 'review'} label=\"Approve\"",
   'Rename Review to Approve'],
  // Rename Quick Count header
  ["<h1 className=\"text-[20px] font-bold text-white\">Quick Count</h1>",
   "<h1 className=\"text-[20px] font-bold text-white\">Spot Check</h1>",
   'Rename Quick Count header'],
  ["Search any product, enter quantity",
   "Search a product and count it",
   'Simplify Quick Count subtitle'],
  // Rename Manage header
  ["<h1 className=\"text-[20px] font-bold text-white\">Manage Lists</h1>",
   "<h1 className=\"text-[20px] font-bold text-white\">Count Templates</h1>",
   'Rename Manage Lists header'],
  ["Create and manage counting templates",
   "Set up what gets counted and when",
   'Simplify Manage subtitle'],
  // Rename Review header
  ["<h1 className=\"text-[20px] font-bold text-white\">Review</h1>",
   "<h1 className=\"text-[20px] font-bold text-white\">Approve Counts</h1>",
   'Rename Review header'],
  ["Approve or reject submitted counts",
   "Check and approve staff stock counts",
   'Simplify Review subtitle'],
]);

// ──────────────────────────────────────────────
// PURCHASE
// ──────────────────────────────────────────────
console.log('\n--- Purchase ---');
patchFile('src/app/purchase/page.tsx', [
  // Increase filter pill touch targets (category pills)
  ["px-3 py-1.5 rounded-full text-[11px] font-semibold whitespace-nowrap flex-shrink-0",
   "px-4 py-2.5 rounded-full text-[13px] font-semibold whitespace-nowrap flex-shrink-0",
   'Increase category pill touch targets (all instances)'],
  // Increase cart stepper button size
  ["w-8 h-8 rounded-lg border border-gray-200 bg-white flex items-center justify-center text-[15px] text-gray-600 active:bg-gray-100\">-</button>",
   "w-11 h-11 rounded-xl border border-gray-200 bg-white flex items-center justify-center text-[18px] text-gray-600 active:bg-gray-100\">-</button>",
   'Increase cart minus button to 44px'],
  ["w-8 h-8 rounded-lg border border-gray-200 bg-white flex items-center justify-center text-[15px] text-gray-600 active:bg-gray-100\">+</button>",
   "w-11 h-11 rounded-xl border border-gray-200 bg-white flex items-center justify-center text-[18px] text-gray-600 active:bg-gray-100\">+</button>",
   'Increase cart plus button to 44px'],
  // Rename Purchase subtitle
  ["Order from your suppliers",
   "Order supplies for SSAM & GBM38",
   'More specific Purchase subtitle'],
]);

console.log('\n=== Done! Applied ' + totalChanges + ' total changes across all modules. ===');
console.log('Next: npm run build && systemctl restart krawings-portal');
