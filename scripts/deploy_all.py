#!/usr/bin/env python3
"""Master deploy script. Run AFTER git checkout + git pull + JS patches.
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

print('\n=== Purchase page ===')
p = 'src/app/purchase/page.tsx'
t = open(p).read()

# 1. Numpad migration
if 'onKey={numpadKey}' in t:
    t = t.replace('onKey={numpadKey}', 'onChange={(v: string) => setNumpadValue(v)}')
    print('  OK: onKey -> onChange')

# 2. Label null guards
t = t.replace('label={numpadProduct?.product_name}', 'label={numpadProduct?.product_name || ""}')
t = t.replace('sublabel={numpadProduct?.product_uom}', 'sublabel={numpadProduct?.product_uom || ""}')
print('  OK: label null guards')

# 3. Rename Purchase -> Orders
for old, new in [
    ("title=\"Purchase\"", "title=\"Orders\""),
    ("title=\"Manage Purchases\"", "title=\"Manage Orders\""),
    ("subtitle=\"Guides, suppliers, settings\"", "subtitle=\"Order lists & settings\""),
    ("Manage guides &amp; settings", "Manage order lists"),
    ("Manage guides & settings", "Manage order lists"),
]:
    if old in t and old != new:
        t = t.replace(old, new)
        print(f'  OK: rename "{old[:35]}"')

# 4. Move manage button to top
for btn_text in ['Manage order lists', 'Manage guides &amp; settings']:
    old_btn = "{isManager && <div className=\"text-center mt-4\"><button onClick={() => setScreen('manage')} className=\"text-[12px] font-semibold text-orange-600 px-4 py-2 rounded-lg bg-orange-50 active:bg-orange-100\">" + btn_text + "</button></div>}"
    if old_btn in t:
        t = t.replace(old_btn, '')
        sa = 'SearchInput value={supplierSearch} onChange={setSupplierSearch} placeholder="Search suppliers..." />'
        if sa in t:
            nb = (
                sa +
                "\n      {isManager && <button onClick={() => setScreen('manage')} "
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
            print('  OK: manage button moved to top')
        break

# 5. Add ManageOrders import
if 'ManageOrders' not in t:
    t = t.replace(
        "import Numpad from '@/components/ui/Numpad';",
        "import Numpad from '@/components/ui/Numpad';\nimport ManageOrders from '@/components/purchase/ManageOrders';"
    )
    print('  OK: ManageOrders import')

# 6. Add deleteSupplierGuide handler — passes ONLY supplier_id, no location_id
if 'deleteSupplierGuide' not in t:
    fn = (
        'async function deleteSupplierGuide(suppId: number, suppName: string) {\n'
        '    setConfirmDialog({\n'
        "      title: 'Delete order list for ' + suppName + '?',\n"
        "      message: 'This will permanently remove the order list and all products for ' + suppName + '. This cannot be undone.',\n"
        "      confirmLabel: 'Yes, delete it',\n"
        "      cancelLabel: 'Cancel',\n"
        "      variant: 'danger' as const,\n"
        '      onConfirm: async () => {\n'
        '        setConfirmDialog(null);\n'
        '        try {\n'
        "          await fetch('/api/purchase/guides?supplier_id=' + suppId, { method: 'DELETE' });\n"
        '          fetchSuppliers();\n'
        '        } catch (e) { void e; }\n'
        '      }\n'
        '    });\n'
        '  }\n\n  '
    )
    anchor = 'async function removeGuideItemAction(itemId: number)'
    if anchor in t:
        t = t.replace(anchor, fn + anchor)
        print('  OK: deleteSupplierGuide handler (supplier_id only, no location filter)')

# 7. Replace ManageScreen with ManageOrders component
ms_start = t.find('const ManageScreen = ()')
ms_next = t.find('const ManageGuideScreen', ms_start + 1) if ms_start > 0 else -1

if ms_start > 0 and ms_next > 0 and 'ManageOrders' not in t[ms_start:ms_next]:
    new_manage = (
        "const ManageScreen = () => "
        "<ManageOrders suppliers={suppliers} locationId={locationId} isAdmin={isAdmin} "
        "onOpenGuide={openManageGuide} onDeleteGuide={deleteSupplierGuide} "
        "onSeed={runSeed} seedMsg={seedMsg} />;\n\n  "
    )
    old_manage = t[ms_start:ms_next]
    t = t.replace(old_manage, new_manage)
    print('  OK: ManageScreen replaced with ManageOrders')

write(p, t)
print('  purchase/page.tsx written')

# 8. Dashboard rename
d = 'src/components/dashboard/DashboardHome.tsx'
dt = open(d).read()
dt = dt.replace("id: 'purchase', label: 'Purchase'", "id: 'purchase', label: 'Orders'")
write(d, dt)
print('\n  OK: Dashboard Purchase -> Orders')

# 9. AppTabBar
tb = 'src/components/ui/AppTabBar.tsx'
if os.path.exists(tb):
    tt = open(tb).read()
    if 'Purchase' in tt:
        tt = tt.replace("label: 'Purchase'", "label: 'Orders'")
        tt = tt.replace("'Purchase'", "'Orders'")
        write(tb, tt)
        print('  OK: AppTabBar')

# 10. purchase-db.ts
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

# 11. Remove conflicting files
for f in ['src/components/ui/NumPad.tsx', 'src/components/ui/PurchaseNumpad.tsx']:
    if os.path.exists(f):
        os.remove(f)
        print(f'  Removed {f}')

print('\nAll done. Run: npm run build && systemctl restart krawings-portal')
