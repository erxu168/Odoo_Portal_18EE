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

# 2. Add handler + button to page.tsx
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
    print('2a. deleteGuideAction handler added')
else:
    print('2a. deleteGuideAction already exists')

# 2b. Add delete button at bottom of ManageGuideScreen
if 'Delete entire order list' not in t:
    # Strategy: find the LAST >Remove</button> in the file,
    # then scan forward to find the closing of ManageGuideScreen's return.
    # The pattern after Remove</button> is: </div>))}</div></div>)))}\n    </div>);
    # We insert the delete button just before that final </div>);

    last_remove = t.rfind('>Remove</button>')
    if last_remove > 0:
        # From Remove button, scan forward to find the next </div>);
        # which closes ManageGuideScreen
        search_from = last_remove + len('>Remove</button>')
        close_marker = '</div>);\n'
        close_idx = t.find(close_marker, search_from)
        if close_idx > 0 and close_idx - search_from < 200:
            # Insert before the closing </div>);
            btn = (
                '\n      {guideItems.length > 0 && (<div className="mt-6 pt-4 border-t border-gray-200">'
                '<button onClick={() => deleteGuideAction()} className="w-full py-3 rounded-xl bg-red-50 border border-red-200 text-red-700 text-[13px] font-semibold active:bg-red-100">'
                'Delete entire order list</button>'
                '<p className="text-[11px] text-gray-400 text-center mt-2">'
                'Removes all {guideItems.length} products from this supplier</p></div>)}\n'
            )
            t = t[:close_idx] + btn + t[close_idx:]
            print('2b. delete button added before ManageGuideScreen closing')
        else:
            print('2b. FAILED - closing </div>); not found near Remove button')
            print('    close_idx=' + str(close_idx) + ' distance=' + str(close_idx - search_from if close_idx > 0 else -1))
            print('    next 200 chars: ' + repr(t[search_from:search_from+200]))
    else:
        print('2b. FAILED - no >Remove</button> found')
else:
    print('2b. delete button already exists')

open(f, 'w').write(t)
print('done')
