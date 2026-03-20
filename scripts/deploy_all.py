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

# 6. Add deleteSupplierGuide handler
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
        print('  OK: deleteSupplierGuide handler')

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

# 8. CRITICAL: Hide suppliers with 0 products from the main Order tab (SupplierList)
#    The SupplierList shows all suppliers — filter to only ones with an order list
#    Find the supplier filter/map in SupplierList and add product_count > 0 filter
if 'product_count > 0' not in t:
    # Pattern: suppliers are filtered by search then mapped
    # Look for the .filter() that uses supplierSearch
    old_filter = '.filter(s => s.name.toLowerCase().includes(supplierSearch.toLowerCase()))'
    new_filter = '.filter(s => s.product_count > 0 && s.name.toLowerCase().includes(supplierSearch.toLowerCase()))'
    if old_filter in t:
        t = t.replace(old_filter, new_filter)
        print('  OK: main Order tab only shows suppliers with products')
    else:
        # Try alternate patterns
        old_filter2 = '.filter((s: any) => s.name.toLowerCase().includes(supplierSearch.toLowerCase()))'
        new_filter2 = '.filter((s: any) => s.product_count > 0 && s.name.toLowerCase().includes(supplierSearch.toLowerCase()))'
        if old_filter2 in t:
            t = t.replace(old_filter2, new_filter2)
            print('  OK: main Order tab only shows suppliers with products (typed)')
        else:
            print('  WARN: supplier filter pattern not found — checking for .map')
            # Maybe suppliers are mapped directly without filter
            # Find the map inside SupplierList
            sl_start = t.find('const SupplierList')
            if sl_start > 0:
                # Find the next component definition to bound our search
                sl_end = t.find('\n  const ', sl_start + 30)
                if sl_end > 0:
                    region = t[sl_start:sl_end]
                    # Look for suppliers.filter or suppliers.map in this region
                    if 'suppliers.filter' in region:
                        # Insert product_count check into existing filter
                        local_old = 'suppliers.filter(s =>'
                        local_new = 'suppliers.filter(s => s.product_count > 0 &&'
                        if local_old in region:
                            t = t[:sl_start] + region.replace(local_old, local_new) + t[sl_end:]
                            print('  OK: added product_count filter to SupplierList')
                    elif 'suppliers.map' in region:
                        # No filter exists, add one before map
                        t = t[:sl_start] + region.replace('suppliers.map', 'suppliers.filter((s: any) => s.product_count > 0).map') + t[sl_end:]
                        print('  OK: added product_count filter before supplier map')
else:
    print('  SKIP: product_count filter already present')

write(p, t)
print('  purchase/page.tsx written')

# 9. Dashboard rename
d = 'src/components/dashboard/DashboardHome.tsx'
dt = open(d).read()
dt = dt.replace("id: 'purchase', label: 'Purchase'", "id: 'purchase', label: 'Orders'")
write(d, dt)
print('\n  OK: Dashboard Purchase -> Orders')

# 10. AppTabBar
tb = 'src/components/ui/AppTabBar.tsx'
if os.path.exists(tb):
    tt = open(tb).read()
    if 'Purchase' in tt:
        tt = tt.replace("label: 'Purchase'", "label: 'Orders'")
        tt = tt.replace("'Purchase'", "'Orders'")
        write(tb, tt)
        print('  OK: AppTabBar')

# 11. purchase-db.ts
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

# 12. Remove conflicting files
for f in ['src/components/ui/NumPad.tsx', 'src/components/ui/PurchaseNumpad.tsx']:
    if os.path.exists(f):
        os.remove(f)
        print(f'  Removed {f}')

print('\nAll done. Run: npm run build && systemctl restart krawings-portal')
