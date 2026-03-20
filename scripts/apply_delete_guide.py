#!/usr/bin/env python3
"""Add delete order list: db function + handler + button. Run from /opt/krawings-portal."""

# 1. Add deleteGuide to purchase-db.ts
f = 'src/lib/purchase-db.ts'
t = open(f).read()
if 'deleteGuide' not in t:
    t = t.replace(
        'export function updateGuideItemPrice(',
        'export function deleteGuide(guideId: number) {\n  db().prepare("DELETE FROM purchase_order_guides WHERE id = ?").run(guideId);\n}\n\nexport function updateGuideItemPrice('
    )
    open(f, 'w').write(t)
    print('1. deleteGuide added to purchase-db.ts')
else:
    print('1. deleteGuide already exists')

# 2. page.tsx: handler + button
f = 'src/app/purchase/page.tsx'
t = open(f).read()

# 2a. Add deleteGuideAction handler
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
        '          if (gr.guide?.id) {\n'
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
    t = t.replace(
        'async function removeGuideItemAction(itemId: number)',
        handler + 'async function removeGuideItemAction(itemId: number)'
    )
    print('2a. handler added')
else:
    print('2a. handler already exists')

# 2b. Add delete button — find ManageGuideScreen's return closing
if 'Delete entire order list' not in t:
    # Find where ManageGuideScreen is defined
    mg_start = t.find('const ManageGuideScreen')
    if mg_start < 0:
        mg_start = t.find('ManageGuideScreen = ()')
    
    if mg_start > 0:
        # Find the next component or the RENDER section after ManageGuideScreen
        # ManageGuideScreen ends before the RENDER comment or before the next component
        render_marker = '// ============== RENDER =============='
        render_idx = t.find(render_marker, mg_start)
        
        if render_idx < 0:
            # Try finding the return statement
            render_idx = t.find('  // ============== RENDER', mg_start)
        
        if render_idx > 0:
            # Search backwards from render_idx to find the last }; which closes ManageGuideScreen
            # The function ends with:  </div>);\n  };\n
            search_region = t[mg_start:render_idx]
            # Find the last </div>); in ManageGuideScreen
            last_close = search_region.rfind('</div>);')
            
            if last_close > 0:
                # Insert BEFORE this closing </div>);
                abs_pos = mg_start + last_close
                btn = (
                    '\n      {guideItems.length > 0 && (<div className="mt-6 pt-4 border-t border-gray-200">'
                    '<button onClick={() => deleteGuideAction()} className="w-full py-3 rounded-xl bg-red-50 border border-red-200 text-red-700 text-[13px] font-semibold active:bg-red-100">'
                    'Delete entire order list</button>'
                    '<p className="text-[11px] text-gray-400 text-center mt-2">'
                    'Removes all {guideItems.length} products from this supplier</p></div>)}\n    '
                )
                t = t[:abs_pos] + btn + t[abs_pos:]
                print('2b. delete button added')
            else:
                print('2b. FAIL - no </div>); found in ManageGuideScreen')
        else:
            print('2b. FAIL - RENDER marker not found')
            print('    Searching for: ' + render_marker)
    else:
        print('2b. FAIL - ManageGuideScreen not found')
else:
    print('2b. delete button already exists')

open(f, 'w').write(t)
print('done')
