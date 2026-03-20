#!/usr/bin/env node
/**
 * Patch: Add "Delete order list" functionality
 * 1. Add deleteGuide() to purchase-db.ts
 * 2. Add delete button + handler to page.tsx ManageGuideScreen
 *
 * Run from /opt/krawings-portal:
 *   node scripts/patch_delete_guide.js
 */
const fs = require('fs');
const path = require('path');
let changes = 0;

function patchFile(relPath, patches) {
  const file = path.join(__dirname, '..', relPath);
  let content = fs.readFileSync(file, 'utf8');
  for (const [search, replacement, label] of patches) {
    if (!content.includes(search)) {
      console.log('SKIP: ' + label + ' (marker not found in ' + relPath + ')');
      continue;
    }
    content = content.replace(search, replacement);
    changes++;
    console.log('OK: ' + label);
  }
  fs.writeFileSync(file, content, 'utf8');
}

// 1. Add deleteGuide function to purchase-db.ts
patchFile('src/lib/purchase-db.ts', [
  [
    'export function updateGuideItemPrice(itemId: number, price: number, source: string) {',
    'export function deleteGuide(guideId: number) {\n  db().prepare(\'DELETE FROM purchase_order_guides WHERE id = ?\').run(guideId);\n}\n\nexport function updateGuideItemPrice(itemId: number, price: number, source: string) {',
    'Add deleteGuide() to purchase-db.ts'
  ]
]);

// 2. Add deleteGuide handler to page.tsx (inside PurchasePage, after removeGuideItemAction)
patchFile('src/app/purchase/page.tsx', [
  [
    'async function removeGuideItemAction(itemId: number)',
    'async function deleteGuideAction() {\n    if (!guideSupplierId) return;\n    setConfirmDialog({\n      title: \'Delete this order list?\',\n      message: `This will remove all ${guideItems.length} products from ${guideSupplierName}. You can re-add them later. This cannot be undone.`,\n      confirmLabel: \'Yes, delete it\',\n      variant: \'danger\' as const,\n      onConfirm: async () => {\n        setConfirmDialog(null);\n        try {\n          const guide = await fetch(`/api/purchase/guides?supplier_id=${guideSupplierId}&location_id=${locationId}`).then(r => r.json());\n          if (guide.guide?.id) {\n            await fetch(`/api/purchase/guides?guide_id=${guide.guide.id}`, { method: \'DELETE\' });\n          }\n          fetchSuppliers();\n          setScreen(\'manage\');\n        } catch (e) { void e; }\n      }\n    });\n  }\n\n  async function removeGuideItemAction(itemId: number)',
    'Add deleteGuideAction handler'
  ]
]);

// 3. Add the delete button at bottom of ManageGuideScreen
// Find the end of the guide items list and add a button before the closing </div>
patchFile('src/app/purchase/page.tsx', [
  [
    "guideItems.length === 0 ? (<div className=\"bg-white border border-gray-200 rounded-xl p-6 text-center\"><div className=\"text-[13px] text-gray-500\">No products yet. Search above to add products from Odoo.</div></div>)",
    "guideItems.length === 0 ? (<div className=\"bg-white border border-gray-200 rounded-xl p-6 text-center\"><div className=\"text-[13px] text-gray-500\">No products yet. Search above to add products from Odoo.</div></div>)",
    'Locate guide items empty state (no change)'
  ]
]);
// Decrement because that was a no-op marker
changes--;

// Add delete button after the guide items section
// Look for the closing of ManageGuideScreen and add the button before it
var file = path.join(__dirname, '..', 'src/app/purchase/page.tsx');
var content = fs.readFileSync(file, 'utf8');

// Find a unique marker near the end of ManageGuideScreen
var marker = "No products yet. Search above to add products from Odoo.";
var markerIdx = content.indexOf(marker);
if (markerIdx > 0) {
  // Find the next occurrence of the manage-guide's closing section
  // The ManageGuideScreen ends with `</div>);\n  };`
  // We want to add the delete button after the guide items list but inside the component
  // Best approach: find the last </div> before the ManageGuideScreen's return closes
  // 
  // Simpler: add it right after the mapped guide categories section
  // The categories map ends with `)))}`
  // Let's find that by searching for the specific closing pattern after the marker
  
  // Actually, let's insert using a known pattern: the last line of ManageGuideScreen before the closing
  // Look for the return's closing </div>) of ManageGuideScreen
  var deleteBtn = '\n      {guideItems.length > 0 && (<div className="mt-6 pt-4 border-t border-gray-200"><button onClick={() => deleteGuideAction()} className="w-full py-3 rounded-xl bg-red-50 border border-red-200 text-red-700 text-[13px] font-semibold active:bg-red-100">Delete entire order list</button><p className="text-[11px] text-gray-400 text-center mt-2">Removes all {guideItems.length} products from this supplier</p></div>)}\n';
  
  // Insert after the guide categories section closes
  // The pattern is: `)))}`  followed by newline and `    </div>` (the ManageGuideScreen outer div close)
  var insertPoint = '    </div>);\n  };';
  // Actually this is a function component defined inside PurchasePage. 
  // The ManageGuideScreen arrow function returns JSX wrapped in <div>.
  // Let me find a safer insertion point.
  
  // The last part of ManageGuideScreen before its closing </div>) is the guide items list.
  // After the categories map, there's the empty state, then the component ends.
  // The safest approach: insert before the LAST `</div>` of ManageGuideScreen.
  // But that's hard to find uniquely.
  
  // Better: use the empty state text as anchor and find the next `</div>);}` pattern
  var afterMarker = content.indexOf('</div>)))}</div>', markerIdx);
  if (afterMarker > 0) {
    // Found the closing. Insert after it
    var insertAt = afterMarker + '</div>)))}'.length;
    content = content.slice(0, insertAt) + deleteBtn + content.slice(insertAt);
    changes++;
    console.log('OK: Add delete order list button');
  } else {
    // Try alternate: find next occurrence of `</div>` after the categories
    console.log('SKIP: Could not find ManageGuideScreen closing pattern');
    console.log('  You can manually add the delete button to ManageGuideScreen');
  }
  
  fs.writeFileSync(file, content, 'utf8');
}

console.log('\nDone! Applied ' + changes + ' changes.');
console.log('Next: npm run build && systemctl restart krawings-portal');
