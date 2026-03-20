#!/usr/bin/env node
/**
 * Patch: Add "Delete entire order list" to ManageGuideScreen.
 *
 * 1. Add deleteGuide() to purchase-db.ts
 * 2. Add deleteGuideAction() handler to page.tsx
 * 3. Add red delete button at bottom of ManageGuideScreen
 *
 * Run from /opt/krawings-portal:
 *   node scripts/patch_delete_guide.js
 */
const fs = require('fs');
const path = require('path');
let changes = 0;

// === 1. Add deleteGuide to purchase-db.ts ===
const dbFile = path.join(__dirname, '..', 'src/lib/purchase-db.ts');
let dbContent = fs.readFileSync(dbFile, 'utf8');

if (!dbContent.includes('export function deleteGuide')) {
  const marker = 'export function updateGuideItemPrice(';
  if (dbContent.includes(marker)) {
    dbContent = dbContent.replace(
      marker,
      'export function deleteGuide(guideId: number) {\n  // Items cascade via ON DELETE CASCADE\n  db().prepare(\'DELETE FROM purchase_order_guides WHERE id = ?\').run(guideId);\n}\n\n' + marker
    );
    fs.writeFileSync(dbFile, dbContent, 'utf8');
    changes++;
    console.log('OK: Added deleteGuide() to purchase-db.ts');
  } else {
    console.log('SKIP: updateGuideItemPrice marker not found in purchase-db.ts');
  }
} else {
  console.log('SKIP: deleteGuide already exists in purchase-db.ts');
}

// === 2 & 3. Add deleteGuideAction handler + delete button to page.tsx ===
const pageFile = path.join(__dirname, '..', 'src/app/purchase/page.tsx');
let pageContent = fs.readFileSync(pageFile, 'utf8');

// 2a. Add deleteGuideAction handler before removeGuideItemAction
if (!pageContent.includes('deleteGuideAction')) {
  const handlerMarker = 'async function removeGuideItemAction(itemId: number)';
  if (pageContent.includes(handlerMarker)) {
    const handler = `async function deleteGuideAction() {
    if (!guideSupplierId) return;
    setConfirmDialog({
      title: 'Delete this order list?',
      message: 'This will remove all ' + guideItems.length + ' products from ' + guideSupplierName + '. This cannot be undone.',
      confirmLabel: 'Yes, delete it',
      variant: 'danger' as const,
      onConfirm: async () => {
        setConfirmDialog(null);
        try {
          const gr = await fetch('/api/purchase/guides?supplier_id=' + guideSupplierId + '&location_id=' + locationId).then(r => r.json());
          if (gr.guide?.id) {
            await fetch('/api/purchase/guides?guide_id=' + gr.guide.id, { method: 'DELETE' });
          }
          fetchSuppliers();
          setScreen('manage');
        } catch (e) { void e; }
      }
    });
  }

  `;
    pageContent = pageContent.replace(handlerMarker, handler + handlerMarker);
    changes++;
    console.log('OK: Added deleteGuideAction handler');
  } else {
    console.log('SKIP: removeGuideItemAction marker not found');
  }
} else {
  console.log('SKIP: deleteGuideAction already exists');
}

// 2b. Add delete button at bottom of ManageGuideScreen
// The unique marker: the closing of ManageGuideScreen's guide items section
// Pattern: `>Remove</button></div>))}</div></div>)))}`
// After this, there's `\n    </div>);` which closes ManageGuideScreen
const btnMarker = '>Remove</button></div>))}</div></div>)))}\n    </div>);';
if (pageContent.includes(btnMarker) && !pageContent.includes('Delete entire order list')) {
  const deleteBtn = `>Remove</button></div>))}</div></div>)))}\n      {guideItems.length > 0 && (<div className="mt-6 pt-4 border-t border-gray-200"><button onClick={() => deleteGuideAction()} className="w-full py-3 rounded-xl bg-red-50 border border-red-200 text-red-700 text-[13px] font-semibold active:bg-red-100">Delete entire order list</button><p className="text-[11px] text-gray-400 text-center mt-2">Removes all {guideItems.length} products from this supplier</p></div>)}\n    </div>);`;
  pageContent = pageContent.replace(btnMarker, deleteBtn);
  changes++;
  console.log('OK: Added delete button to ManageGuideScreen');
} else if (pageContent.includes('Delete entire order list')) {
  console.log('SKIP: Delete button already exists');
} else {
  console.log('SKIP: ManageGuideScreen closing marker not found');
}

fs.writeFileSync(pageFile, pageContent, 'utf8');
console.log('\nDone! Applied ' + changes + ' changes.');
console.log('Next: npm run build && systemctl restart krawings-portal');
