#!/usr/bin/env python3
"""Master deploy script. Run AFTER git checkout + git pull + JS patches.
Handles: numpad migration, delete guide, label guards, Purchase->Orders rename.
Run from /opt/krawings-portal"""
import os

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

print('\n=== Purchase page: All fixes ===')
p = 'src/app/purchase/page.tsx'
t = open(p).read()

# 1. Numpad migration: onKey -> onChange
if 'onKey={numpadKey}' in t:
    t = t.replace('onKey={numpadKey}', 'onChange={(v: string) => setNumpadValue(v)}')
    print('  OK: onKey -> onChange')

# 2. Label null guards
t = t.replace('label={numpadProduct?.product_name}', 'label={numpadProduct?.product_name || ""}')
t = t.replace('sublabel={numpadProduct?.product_uom}', 'sublabel={numpadProduct?.product_uom || ""}')
print('  OK: label null guards')

# 3. Rename Purchase -> Orders (user-facing labels only)
renames = [
    ("title=\"Purchase\"", "title=\"Orders\""),
    ("title=\"Manage Purchases\"", "title=\"Manage Orders\""),
    ("subtitle=\"Order from your suppliers\"", "subtitle=\"Order from your suppliers\""),  # keep this
    ("subtitle=\"Guides, suppliers, settings\"", "subtitle=\"Order lists & settings\""),
    ("Manage guides &amp; settings", "Manage order lists"),
    ("Manage guides & settings", "Manage order lists"),
]
for old, new in renames:
    if old in t and old != new:
        t = t.replace(old, new)
        print(f'  OK: rename "{old[:40]}" -> "{new[:40]}"')

# 4. Add deleteGuideAction handler
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
        '  }\n\n  '
    )
    anchor = 'async function removeGuideItemAction(itemId: number)'
    if anchor in t:
        t = t.replace(anchor, handler + anchor)
        print('  OK: deleteGuideAction handler')

# 5. Add delete button - find {ManageGuideScreen()} in the render section and insert before it
if 'Delete entire order list' not in t:
    # After patch_inline_components.js: {ManageGuideScreen()}
    target = '{ManageGuideScreen()}'
    if target in t:
        delete_bar = (
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
        )
        t = t.replace(target, delete_bar + target)
        print('  OK: delete button added before {ManageGuideScreen()}')
    else:
        # Try pre-patch version
        target2 = '<ManageGuideScreen />'
        if target2 in t:
            delete_bar = (
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
            )
            t = t.replace(target2, delete_bar + target2)
            print('  OK: delete button added before <ManageGuideScreen />')
        else:
            print('  FAIL: ManageGuideScreen not found in render')

write(p, t)
print('  purchase/page.tsx written')

# 6. Dashboard: rename Purchase -> Orders
print('\n=== Dashboard rename ===')
d = 'src/components/dashboard/DashboardHome.tsx'
dt = open(d).read()
dt = dt.replace("id: 'purchase', label: 'Purchase'", "id: 'purchase', label: 'Orders'")
write(d, dt)
print('  OK: Purchase -> Orders on dashboard')

# 7. AppTabBar: rename if present
print('\n=== AppTabBar rename ===')
tb = 'src/components/ui/AppTabBar.tsx'
if os.path.exists(tb):
    tt = open(tb).read()
    if 'Purchase' in tt or 'Orders' in tt:
        tt = tt.replace("label: 'Purchase'", "label: 'Orders'")
        tt = tt.replace("'Purchase'", "'Orders'")
        write(tb, tt)
        print('  OK: renamed in AppTabBar')
    else:
        print('  SKIP: no Purchase label in AppTabBar')

# 8. Add deleteGuide to purchase-db.ts
print('\n=== purchase-db.ts ===')
db = 'src/lib/purchase-db.ts'
dbt = open(db).read()
if 'deleteGuide' not in dbt:
    dbt = dbt.replace(
        'export function updateGuideItemPrice(',
        'export function deleteGuide(guideId: number) {\n'
        '  db().prepare(\'DELETE FROM purchase_order_guides WHERE id = ?\').run(guideId);\n'
        '}\n\n'
        'export function updateGuideItemPrice('
    )
    write(db, dbt)
    print('  OK: deleteGuide added')
else:
    print('  SKIP: deleteGuide exists')

# 9. Update guides API route
print('\n=== guides/route.ts ===')
gr = 'src/app/api/purchase/guides/route.ts'
gt = open(gr).read()
if 'deleteGuide' not in gt:
    gt = gt.replace(
        'updateGuideItemPrice }',
        'updateGuideItemPrice, deleteGuide }'
    )
    if 'guide_id' not in gt:
        old_del = "  const { searchParams } = new URL(request.url);\n  const itemId = parseInt(searchParams.get('item_id') || '0');\n  if (!itemId) return NextResponse.json({ error: 'item_id required' }, { status: 400 });\n\n  removeGuideItem(itemId);\n  return NextResponse.json({ message: 'Item removed' });"
        new_del = "  const { searchParams } = new URL(request.url);\n  const itemId = parseInt(searchParams.get('item_id') || '0');\n  const guideId = parseInt(searchParams.get('guide_id') || '0');\n\n  if (guideId) {\n    deleteGuide(guideId);\n    return NextResponse.json({ message: 'Order list deleted' });\n  }\n  if (itemId) {\n    removeGuideItem(itemId);\n    return NextResponse.json({ message: 'Item removed' });\n  }\n  return NextResponse.json({ error: 'item_id or guide_id required' }, { status: 400 });"
        gt = gt.replace(old_del, new_del)
        print('  OK: DELETE handler updated')
    write(gr, gt)
    print('  OK: deleteGuide imported')
else:
    print('  SKIP: deleteGuide already in route')

# 10. Remove conflicting files
print('\n=== Remove conflicting files ===')
for f in ['src/components/ui/NumPad.tsx', 'src/components/ui/PurchaseNumpad.tsx']:
    if os.path.exists(f):
        os.remove(f)
        print(f'  Removed {f}')

print('\nAll done. Run: npm run build && systemctl restart krawings-portal')
