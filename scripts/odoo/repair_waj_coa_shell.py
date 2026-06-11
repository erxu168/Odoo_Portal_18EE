# Verify + repair WAJ chart of accounts state, then (re)load de_skr03 taxes.
# Run via odoo shell:
#   cat /opt/Odoo_Portal_18EE/scripts/odoo/repair_waj_coa_shell.py | \
#     sudo -u odoo /opt/odoo/18.0/odoo-18.0/venv/bin/python3 \
#     /opt/odoo/18.0/odoo-18.0/odoo-bin shell \
#     -c /opt/odoo/18.0/odoo-18.0/odoo.conf -d krawings --no-http

waj = env['res.company'].search([('name', 'ilike', 'What a Jerk')], limit=1)
waj.invalidate_recordset()
print('WAJ:', waj.id, waj.name)
print('chart_template:', waj.chart_template, '| country:', waj.country_id.code if waj.country_id else None)

Tax = env['account.tax'].with_context(active_test=False)
n_tax = Tax.search_count([('company_id', '=', waj.id)])
print('existing taxes (incl. inactive):', n_tax)
try:
    n_acc = env['account.account'].with_context(active_test=False).search_count(
        [('company_ids', 'in', waj.id)])
except Exception:
    n_acc = env['account.account'].with_context(active_test=False).search_count(
        [('company_id', '=', waj.id)])
print('existing accounts:', n_acc)

print('running try_loading de_skr03 (reload if already flagged)...')
env['account.chart.template'].try_loading('de_skr03', waj, install_demo=False)
env.cr.commit()
print('committed.')

taxes = Tax.search([('company_id', '=', waj.id), ('type_tax_use', '=', 'sale'),
                    ('amount', 'in', [7.0, 19.0])])
print('sale taxes 7/19 now:', len(taxes))
for t in taxes:
    print(' ', t.id, '|', t.name, '|', t.amount, '| incl =', t.price_include, '| active =', t.active)
print('SHELL SCRIPT DONE')
