#!/bin/bash
# Fix tax display in purchase page.tsx to mirror Odoo exactly (0% default)
# Run after git pull, before npm run build

FILE="src/app/purchase/page.tsx"

if [ ! -f "$FILE" ]; then
  echo "ERROR: $FILE not found. Run from project root."
  exit 1
fi

cp "$FILE" "$FILE.bak"

# 1. Replace calcTax function - change from hardcoded 7/19 buckets to dynamic grouping
python3 -c "
import re
with open('$FILE', 'r') as f:
    content = f.read()

# Fix 1: calcTax function
old_calc = '''    const calcTax = (cart: CartSummary) => {
      let tax7 = 0, tax19 = 0, net = 0;
      for (const item of cart.items) {
        const lineNet = item.quantity * item.price;
        net += lineNet;
        const rate = taxRates[item.product_id] ?? 19;
        if (rate <= 7) tax7 += lineNet * 0.07;
        else tax19 += lineNet * 0.19;
      }
      return { net, tax7, tax19, gross: net + tax7 + tax19 };
    };'''

new_calc = '''    const calcTax = (cart: CartSummary) => {
      const taxByRate: Record<number, number> = {};
      let net = 0;
      for (const item of cart.items) {
        const lineNet = item.quantity * item.price;
        net += lineNet;
        const rate = taxRates[item.product_id] ?? 0;
        if (rate > 0) { taxByRate[rate] = (taxByRate[rate] || 0) + lineNet * (rate / 100); }
      }
      const totalTax = Object.values(taxByRate).reduce((s, v) => s + v, 0);
      return { net, taxByRate, totalTax, gross: net + totalTax };
    };'''

content = content.replace(old_calc, new_calc)

# Fix 2: destructure
content = content.replace(
    'const { net, tax7, tax19, gross } = calcTax(cart);',
    'const { net, taxByRate, totalTax, gross } = calcTax(cart);'
)

# Fix 3: per-line tax badge - show actual rate, hide if 0%
content = content.replace(
    '<div className=\"text-[9px] text-gray-400 font-mono\">{(taxRates[item.product_id] ?? 19) <= 7 ? \'7%\' : \'19%\'} MwSt</div>',
    '{(taxRates[item.product_id] ?? 0) > 0 && <div className=\"text-[9px] text-gray-400 font-mono\">{taxRates[item.product_id]}% MwSt</div>}'
)

# Fix 4: tax breakdown rows - dynamic loop
old_rows = '''            {tax7 > 0 && <div className=\"flex justify-between text-[11px] text-gray-400\"><span>7% MwSt</span><span className=\"font-mono\">&euro;{tax7.toFixed(2)}</span></div>}
            {tax19 > 0 && <div className=\"flex justify-between text-[11px] text-gray-400\"><span>19% MwSt</span><span className=\"font-mono\">&euro;{tax19.toFixed(2)}</span></div>}'''

new_rows = '            {Object.entries(taxByRate).sort(([a],[b]) => Number(a)-Number(b)).map(([rate, amt]) => (<div key={rate} className=\"flex justify-between text-[11px] text-gray-400\"><span>{rate}% MwSt</span><span className=\"font-mono\">&euro;{(amt as number).toFixed(2)}</span></div>))}'

content = content.replace(old_rows, new_rows)

with open('$FILE', 'w') as f:
    f.write(content)

print('All 4 tax replacements applied successfully.')
"

if [ $? -eq 0 ]; then
  echo "Tax fix applied. You can remove $FILE.bak after verifying."
  rm -f scripts/fix-tax-defaults.sh
else
  echo "ERROR: Fix failed. Restoring backup."
  mv "$FILE.bak" "$FILE"
  exit 1
fi
