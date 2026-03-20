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

# 3. Rename Purchase -> Orders
renames = [
    ("title=\"Purchase\"", "title=\"Orders\""),
    ("title=\"Manage Purchases\"", "title=\"Manage Orders\""),
    ("subtitle=\"Guides, suppliers, settings\"", "subtitle=\"Order lists & settings\""),
    ("Manage guides &amp; settings", "Manage order lists"),
    ("Manage guides & settings", "Manage order lists"),
]
for old, new in renames:
    if old in t and old != new:
        t = t.replace(old, new)
        print(f'  OK: rename "{old[:40]}" -> "{new[:40]}"')

# 4. Move manage button to top
old_manage_btn = '{isManager && <div className="text-center mt-4"><button onClick={() => setScreen(\'manage\')} className="text-[12px] font-semibold text-orange-600 px-4 py-2 rounded-lg bg-orange-50 active:bg-orange-100">Manage order lists</button></div>}'
if old_manage_btn in t:
    t = t.replace(old_manage_btn, '')
    search_anchor = 'SearchInput value={supplierSearch} onChange={setSupplierSearch} placeholder="Search suppliers..." />'
    if search_anchor in t:
        new_btn = (
            'SearchInput value={supplierSearch} onChange={setSupplierSearch} placeholder="Search suppliers..." />'
            '\n      {isManager && <button onClick={() => setScreen(\'manage\')} '
            'className="w-full flex items-center justify-between px-3.5 py-3 mb-3 '
            'bg-white border border-orange-200 rounded-xl active:bg-orange-50 transition-colors">'
            '<div className="flex items-center gap-2.5">'
            '<div className="w-8 h-8 rounded-lg bg-orange-50 flex items-center justify-center">'
            '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#EA580C" strokeWidth="2" strokeLinecap="round">'
            '<path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 013 3L7 19l-4 1 1-4L16.5 3.5z"/>'
            '</svg></div>'
            '<div><div className="text-[13px] font-semibold text-[#1F2933]">Manage order lists</div>'
            '<div className="text-[10px] text-gray-400">Add, edit or remove products</div></div></div>'
            '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#D1D5DB" strokeWidth="2"><path d="M9 5l7 7-7 7"/></svg>'
            '</button>}'
        )
        t = t.replace(search_anchor, new_btn)
        print('  OK: manage button moved to top')
else:
    old2 = '{isManager && <div className="text-center mt-4"><button onClick={() => setScreen(\'manage\')} className="text-[12px] font-semibold text-orange-600 px-4 py-2 rounded-lg bg-orange-50 active:bg-orange-100">Manage guides &amp; settings</button></div>}'
    if old2 in t:
        t = t.replace(old2, '')
        sa = 'SearchInput value={supplierSearch} onChange={setSupplierSearch} placeholder="Search suppliers..." />'
        if sa in t:
            nb = (
                'SearchInput value={supplierSearch} onChange={setSupplierSearch} placeholder="Search suppliers..." />'
                '\n      {isManager && <button onClick={() => setScreen(\'manage\')} '
                'className="w-full flex items-center justify-between px-3.5 py-3 mb-3 '
                'bg-white border border-orange-200 rounded-xl active:bg-orange-50 transition-colors">'
                '<div className="flex items-center gap-2.5">'
                '<div className="w-8 h-8 rounded-lg bg-orange-50 flex items-center justify-center">'
                '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#EA580C" strokeWidth="2" strokeLinecap="round">'
                '<path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 013 3L7 19l-4 1 1-4L16.5 3.5z"/>'
                '</svg></div>'
                '<div><div className="text-[13px] font-semibold text-[#1F2933]">Manage order lists</div>'
                '<div className="text-[10px] text-gray-400">Add, edit or remove products</div></div></div>'
                '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#D1D5DB" strokeWidth="2"><path d="M9 5l7 7-7 7"/></svg>'
                '</button>}'
            )
            t = t.replace(sa, nb)
            print('  OK: manage button moved to top (pre-rename)')

# 5. deleteGuideAction — calls DELETE with supplier_id+location_id directly (no guide_id lookup)
if 'deleteGuideAction' not in t:
    handler = (
        'async function deleteGuideAction() {\n'
        '    if (!guideSupplierId) return;\n'
        '    const msg = guideItems.length > 0\n'
        "      ? 'This will remove all ' + guideItems.length + ' products from ' + guideSupplierName + '. This cannot be undone.'\n"
        "      : 'This will delete the empty order list for ' + guideSupplierName + '. This cannot be undone.';\n"
        '    setConfirmDialog({\n'
        "      title: 'Delete this order list?',\n"
        '      message: msg,\n'
        "      confirmLabel: 'Yes, delete it',\n"
        "      cancelLabel: 'Cancel',\n"
        "      variant: 'danger' as const,\n"
        '      onConfirm: async () => {\n'
        '        setConfirmDialog(null);\n'
        '        try {\n'
        "          await fetch('/api/purchase/guides?supplier_id=' + guideSupplierId + '&location_id=' + locationId, { method: 'DELETE' });\n"
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
        print('  OK: deleteGuideAction handler (direct supplier_id+location_id DELETE)')

# 6. Delete button before {ManageGuideScreen()}
if 'Delete entire order list' not in t:
    target = '{ManageGuideScreen()}'
    if target in t:
        delete_bar = (
            '{isManager && ('
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
        print('  OK: delete button added')

write(p, t)
print('  purchase/page.tsx written')

# 7. Dashboard rename
print('\n=== Dashboard rename ===')
d = 'src/components/dashboard/DashboardHome.tsx'
dt = open(d).read()
dt = dt.replace("id: 'purchase', label: 'Purchase'", "id: 'purchase', label: 'Orders'")
write(d, dt)
print('  OK: Purchase -> Orders')

# 8. AppTabBar rename
tb = 'src/components/ui/AppTabBar.tsx'
if os.path.exists(tb):
    tt = open(tb).read()
    if 'Purchase' in tt:
        tt = tt.replace("label: 'Purchase'", "label: 'Orders'")
        tt = tt.replace("'Purchase'", "'Orders'")
        write(tb, tt)
        print('  OK: AppTabBar renamed')

# 9. purchase-db.ts — deleteGuide not needed here anymore, API route handles it directly
# But add it for backward compat if other code calls it
print('\n=== purchase-db.ts ===')
db = 'src/lib/purchase-db.ts'
dbt = open(db).read()
if 'deleteGuide' not in dbt:
    dbt = dbt.replace(
        'export function updateGuideItemPrice(',
        'export function deleteGuide(guideId: number) {\n'
        "  db().prepare('DELETE FROM purchase_guide_items WHERE guide_id = ?').run(guideId);\n"
        "  db().prepare('DELETE FROM purchase_order_guides WHERE id = ?').run(guideId);\n"
        '}\n\n'
        'export function updateGuideItemPrice('
    )
    write(db, dbt)
    print('  OK: deleteGuide added')
else:
    print('  SKIP: deleteGuide exists')

# 10. guides/route.ts — already updated in repo, no patching needed
print('\n=== guides/route.ts ===')
print('  OK: using repo version (supports supplier_id+location_id DELETE)')

# 11. Remove conflicting files
print('\n=== Remove conflicting files ===')
for f in ['src/components/ui/NumPad.tsx', 'src/components/ui/PurchaseNumpad.tsx']:
    if os.path.exists(f):
        os.remove(f)
        print(f'  Removed {f}')

print('\nAll done. Run: npm run build && systemctl restart krawings-portal')
