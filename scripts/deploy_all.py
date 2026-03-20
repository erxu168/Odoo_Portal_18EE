#!/usr/bin/env python3
"""Master deploy script. Run AFTER git checkout + git pull + JS patches.
Handles: numpad migration, delete guide, label guards.
Run from /opt/krawings-portal"""
import os, sys

def write(path, t):
    open(path, 'w').write(t)

print('=== Manufacturing: NumPad -> Numpad ===')
for f in ['src/components/manufacturing/MoDetail.tsx', 'src/components/manufacturing/WoDetail.tsx']:
    t = open(f).read()
    t = t.replace("import NumPad from '@/components/ui/NumPad'", "import Numpad from '@/components/ui/Numpad'")
    t = t.replace('<NumPad', '<Numpad')
    t = t.replace('value={numpadComp.picked', 'initialValue={numpadComp.picked')
    write(f, t)
    print(f'  {f}: done')

print('\n=== Purchase: All fixes ===')
p = 'src/app/purchase/page.tsx'
t = open(p).read()

# 1. Numpad migration: onKey -> onChange
if 'onKey={numpadKey}' in t:
    t = t.replace('onKey={numpadKey}', 'onChange={(v: string) => setNumpadValue(v)}')
    print('  OK: onKey -> onChange')
else:
    print('  SKIP: onKey already migrated')

# 2. Label null guards
t = t.replace('label={numpadProduct?.product_name}', 'label={numpadProduct?.product_name || ""}')
t = t.replace('sublabel={numpadProduct?.product_uom}', 'sublabel={numpadProduct?.product_uom || ""}')
print('  OK: label null guards')

# 3. Add deleteGuideAction handler
if 'deleteGuideAction' not in t:
    handler = (
        'async function deleteGuideAction() {\n'
        '    if (!guideSupplierId) return;\n'
        '    setConfirmDialog({\n'
        "      title: 'Delete this order list?',\n"
        "      message: 'This will remove all ' + guideItems.length + ' products from ' + guideSupplierName + '. This cannot be undone.',\n"
        "      confirmLabel: 'Yes, delete it',\n"
        "      variant: 'danger' as const,\n"
        '      onConfirm: async () => {\n'
        '        setConfirmDialog(null);\n'
        '        try {\n'
        "          const gr = await fetch('/api/purchase/guides?supplier_id=' + guideSupplierId + '&location_id=' + locationId).then(r => r.json());\n"
        '          if (gr.guide && gr.guide.id) {\n'
        "            await fetch('/api/purchase/guides?guide_id=' + gr.guide.id, { method: 'DELETE' });\n"
        '          }\n'
        '          fetchSuppliers();\n'
        "          setScreen('manage');\n"
        '        } catch (e) { void e; }\n'
        '      }\n'
        '    });\n'
        '  }\n'
        '\n  '
    )
    anchor = 'async function removeGuideItemAction(itemId: number)'
    if anchor in t:
        t = t.replace(anchor, handler + anchor)
        print('  OK: deleteGuideAction handler')
    else:
        print('  FAIL: removeGuideItemAction anchor not found')
else:
    print('  SKIP: deleteGuideAction exists')

# 4. Add delete button AT THE TOP — between Header and ManageGuideScreen in the RENDER section
#    This is a stable, unique string that won't be affected by other patches
if 'Delete entire order list' not in t:
    # The render section has this exact pattern:
    old_render = "onBack={() => setScreen('manage')} /><ManageGuideScreen />"
    if old_render in t:
        delete_bar = (
            "onBack={() => setScreen('manage')} />"
            '{isManager && guideItems.length > 0 && ('
            '<div className="px-4 pt-3">'
            '<button onClick={() => deleteGuideAction()} '
            'className="w-full py-2.5 rounded-xl bg-red-50 border border-red-200 '
            'text-red-600 text-[12px] font-semibold active:bg-red-100 '
            'flex items-center justify-center gap-2">'
            '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">'
            '<polyline points="3 6 5 6 21 6"/>'
            '<path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/>'
            '</svg>'
            'Delete entire order list</button></div>)}'
            '<ManageGuideScreen />'
        )
        t = t.replace(old_render, delete_bar)
        print('  OK: delete button added (top of manage-guide screen)')
    else:
        print('  FAIL: manage-guide render pattern not found')
        # Debug
        idx = t.find('ManageGuideScreen')
        if idx > 0:
            print('  DEBUG: ManageGuideScreen found at index ' + str(idx))
            # Show 200 chars before ManageGuideScreen in render
            render_idx = t.find('ManageGuideScreen />', t.find('RENDER'))
            if render_idx > 0:
                print('  DEBUG: render usage at ' + str(render_idx))
                print('  DEBUG: 100 chars before: ' + repr(t[render_idx-100:render_idx]))
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
    if 'guide_id' not in gt:
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
