#!/usr/bin/env python3
"""Master deploy script. Run AFTER git checkout + git pull + JS patches.
Handles: numpad migration, delete guide, label guards.
Run from /opt/krawings-portal"""
import os, sys

def fix(path, old, new, label):
    t = open(path).read()
    if old not in t:
        print(f'  SKIP: {label} (not found)')
        return t
    t = t.replace(old, new)
    print(f'  OK: {label}')
    return t

def write(path, t):
    open(path, 'w').write(t)

print('=== Manufacturing: NumPad -> Numpad ===')
for f in ['src/components/manufacturing/MoDetail.tsx', 'src/components/manufacturing/WoDetail.tsx']:
    t = open(f).read()
    t = fix(f, "import NumPad from '@/components/ui/NumPad'", "import Numpad from '@/components/ui/Numpad'", 'import')
    t = t.replace('<NumPad', '<Numpad')
    t = t.replace('value={numpadComp.picked', 'initialValue={numpadComp.picked')
    write(f, t)
    print(f'  {f}: done')

print('\n=== Purchase: All fixes ===')
p = 'src/app/purchase/page.tsx'
t = open(p).read()

# 1. Numpad migration: onKey -> onChange
old_numpad = 'onKey={numpadKey}'
new_numpad = 'onChange={(v: string) => setNumpadValue(v)}'
if old_numpad in t:
    t = t.replace(old_numpad, new_numpad)
    print('  OK: onKey -> onChange')
else:
    print('  SKIP: onKey already migrated')

# 2. Label null guards
t = t.replace('label={numpadProduct?.product_name}', 'label={numpadProduct?.product_name || ""}')
t = t.replace('sublabel={numpadProduct?.product_uom}', 'sublabel={numpadProduct?.product_uom || ""}')
print('  OK: label null guards')

# 3. Add deleteGuideAction handler
if 'deleteGuideAction' not in t:
    handler = '''async function deleteGuideAction() {
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
          if (gr.guide && gr.guide.id) {
            await fetch('/api/purchase/guides?guide_id=' + gr.guide.id, { method: 'DELETE' });
          }
          fetchSuppliers();
          setScreen('manage');
        } catch (e) { void e; }
      }
    });
  }

  '''
    anchor = 'async function removeGuideItemAction(itemId: number)'
    if anchor in t:
        t = t.replace(anchor, handler + anchor)
        print('  OK: deleteGuideAction handler')
    else:
        print('  FAIL: removeGuideItemAction anchor not found')
else:
    print('  SKIP: deleteGuideAction exists')

# 4. Add delete button to ManageGuideScreen
if 'Delete entire order list' not in t:
    # Strategy: find the ManageGuideScreen component boundaries
    mg_start = t.find('const ManageGuideScreen')
    if mg_start < 0:
        mg_start = t.find('ManageGuideScreen = ()')
    
    if mg_start > 0:
        # Find the end: ManageGuideScreen's return closes with </div>);\n  };
        # Search for the RENDER section which comes after ManageGuideScreen
        render_idx = t.find('// ============== RENDER', mg_start)
        if render_idx < 0:
            render_idx = t.find('return (\n    <div className="min-h-screen', mg_start)
        
        if render_idx > 0:
            # Within ManageGuideScreen, find the last </div>);
            region = t[mg_start:render_idx]
            # The component's JSX return ends with </div>);\n  };
            # Find the last occurrence of </div>); in this region
            last_close = region.rfind('</div>);')
            
            if last_close > 0:
                abs_pos = mg_start + last_close
                btn = (
                    '\n      {guideItems.length > 0 && ('
                    '<div className="mt-6 pt-4 border-t border-gray-200">'
                    '<button onClick={() => deleteGuideAction()} '
                    'className="w-full py-3 rounded-xl bg-red-50 border border-red-200 '
                    'text-red-700 text-[13px] font-semibold active:bg-red-100">'
                    'Delete entire order list</button>'
                    '<p className="text-[11px] text-gray-400 text-center mt-2">'
                    'Removes all {guideItems.length} products</p>'
                    '</div>)}\n    '
                )
                t = t[:abs_pos] + btn + t[abs_pos:]
                print('  OK: delete button added')
            else:
                print('  FAIL: no </div>); in ManageGuideScreen region')
        else:
            print('  FAIL: RENDER section not found after ManageGuideScreen')
            # Fallback: try counting from mg_start
            # ManageGuideScreen is an arrow function, ends with };\n
            # Find the 2nd }; after the return statement
            ret_idx = t.find('return (<div', mg_start)
            if ret_idx > 0:
                # Count angle brackets to find the closing
                print('  INFO: return found at ' + str(ret_idx - mg_start) + ' chars into ManageGuideScreen')
    else:
        print('  FAIL: ManageGuideScreen not found')
else:
    print('  SKIP: delete button exists')

write(p, t)
print('  purchase/page.tsx written')

# 5. Add deleteGuide to purchase-db.ts
print('\n=== purchase-db.ts ===')
db = 'src/lib/purchase-db.ts'
dt = open(db).read()
if 'deleteGuide' not in dt:
    dt = dt.replace(
        'export function updateGuideItemPrice(',
        'export function deleteGuide(guideId: number) {\n'
        '  db().prepare(\'DELETE FROM purchase_order_guides WHERE id = ?\').run(guideId);\n'
        '}\n\n'
        'export function updateGuideItemPrice('
    )
    write(db, dt)
    print('  OK: deleteGuide added')
else:
    print('  SKIP: deleteGuide exists')

# 6. Update guides API route to import deleteGuide  
print('\n=== guides/route.ts ===')
gr = 'src/app/api/purchase/guides/route.ts'
gt = open(gr).read()
if 'deleteGuide' not in gt:
    gt = gt.replace(
        'updateGuideItemPrice }',
        'updateGuideItemPrice, deleteGuide }'
    )
    # Also check if the DELETE handler supports guide_id
    if 'guide_id' not in gt:
        # Replace the DELETE handler
        old_delete = """  const { searchParams } = new URL(request.url);
  const itemId = parseInt(searchParams.get('item_id') || '0');
  if (!itemId) return NextResponse.json({ error: 'item_id required' }, { status: 400 });

  removeGuideItem(itemId);
  return NextResponse.json({ message: 'Item removed' });"""
        new_delete = """  const { searchParams } = new URL(request.url);
  const itemId = parseInt(searchParams.get('item_id') || '0');
  const guideId = parseInt(searchParams.get('guide_id') || '0');

  if (guideId) {
    deleteGuide(guideId);
    return NextResponse.json({ message: 'Order list deleted' });
  }
  if (itemId) {
    removeGuideItem(itemId);
    return NextResponse.json({ message: 'Item removed' });
  }
  return NextResponse.json({ error: 'item_id or guide_id required' }, { status: 400 });"""
        gt = gt.replace(old_delete, new_delete)
        print('  OK: DELETE handler updated for guide_id')
    write(gr, gt)
    print('  OK: deleteGuide imported')
else:
    print('  SKIP: deleteGuide already in route')

print('\n=== Remove conflicting files ===')
for f in ['src/components/ui/NumPad.tsx', 'src/components/ui/PurchaseNumpad.tsx']:
    if os.path.exists(f):
        os.remove(f)
        print(f'  Removed {f}')
    else:
        print(f'  {f} already gone')

print('\nAll done. Run: npm run build && systemctl restart krawings-portal')
