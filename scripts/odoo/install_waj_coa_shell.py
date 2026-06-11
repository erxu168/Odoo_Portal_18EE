# Run via odoo shell (pipe this file in). Installs de_skr03 chart of accounts
# + German taxes for the What a Jerk company, then prints the resulting taxes.
#
# Usage on the production server:
#   cat /opt/Odoo_Portal_18EE/scripts/odoo/install_waj_coa_shell.py | \
#     sudo -u odoo /opt/odoo/18.0/odoo-18.0/venv/bin/python3 \
#     /opt/odoo/18.0/odoo-18.0/odoo-bin shell \
#     -c /opt/odoo/18.0/odoo-18.0/odoo.conf -d krawings --no-http

waj = env['res.company'].search([('name', 'ilike', 'What a Jerk')], limit=1)
print('WAJ company:', waj.id, waj.name, '| chart_template:', waj.chart_template)

if waj.chart_template:
    print('Chart template already installed, nothing to do.')
else:
    print('Installing de_skr03 for', waj.name, '...')
    env['account.chart.template'].try_loading('de_skr03', waj, install_demo=False)
    env.cr.commit()
    print('Committed.')

taxes = env['account.tax'].search([
    ('company_id', '=', waj.id), ('type_tax_use', '=', 'sale'),
    ('amount', 'in', [7.0, 19.0])])
print('Sale taxes for WAJ now:')
for t in taxes:
    print(' ', t.id, '|', t.name, '|', t.amount, '| incl =', t.price_include)
print('SHELL SCRIPT DONE')
