import { test, expect } from '@playwright/test';
import { buildProductVals, buildDraftApprovalVals } from '../src/lib/product-create';

/**
 * There were three product creators and they disagreed. All three set `type` and
 * none set `is_storable`, so every product the portal has ever made arrived
 * holding no stock figure and could never take a count. Purchase additionally
 * wrote the one price it was given into BOTH the cost and the selling price.
 *
 * These pin the shape so a fourth creator, or an edit to one of the three,
 * cannot quietly reintroduce either bug.
 */

test('THE BUG: stock tracking is on by default, against Odoo’s own default', () => {
  const v = buildProductVals({ name: 'Ting', uomId: 1, categId: 5 });
  expect(v.is_storable, 'Odoo defaults this to FALSE; a stock catalog must not').toBe(true);
  expect(v.type).toBe('consu');
});

test('...and can still be turned off deliberately', () => {
  expect(buildProductVals({ name: 'Delivery fee', uomId: 1, categId: 5, isStorable: false }).is_storable).toBe(false);
});

test('THE OTHER BUG: cost and selling price are separate, and neither is invented', () => {
  // Purchase used to do `list_price: price, standard_price: price`, so adding a
  // case of soy sauce to an order guide told the till to sell it for the case
  // price. A cost must never become a selling price.
  const bought = buildProductVals({ name: 'Soy sauce 15l', uomId: 1, categId: 5, cost: 24.9 });
  expect(bought.standard_price).toBe(24.9);
  expect(bought.list_price, 'a supplier price must NOT become the selling price').toBeUndefined();

  const sold = buildProductVals({ name: 'Ting', uomId: 1, categId: 5, salesPrice: 2.5 });
  expect(sold.list_price).toBe(2.5);
  expect(sold.standard_price).toBeUndefined();
});

test('a price of zero is a real answer, not a missing one', () => {
  // `if (cost)` would drop this; the check is against null.
  expect(buildProductVals({ name: 'Sample', uomId: 1, categId: 5, cost: 0 }).standard_price).toBe(0);
});

test('the buying unit starts equal to the stock unit', () => {
  // Odoo requires both to share a unit family, and equal is the only value
  // guaranteed valid at create time.
  const v = buildProductVals({ name: 'Rice', uomId: 12, categId: 5 });
  expect(v.uom_id).toBe(12);
  expect(v.uom_po_id).toBe(12);
});

test('lot/serial tracking is explicitly off, not left to chance', () => {
  expect(buildProductVals({ name: 'Rice', uomId: 1, categId: 5 }).tracking).toBe('none');
});

test('company and orderability are left to Odoo — products here are shared', () => {
  const v = buildProductVals({ name: 'Rice', uomId: 1, categId: 5 });
  expect(v.company_id, 'setting this would make portal products behave unlike every other').toBeUndefined();
  expect(v.purchase_ok).toBeUndefined();
  expect(v.sale_ok).toBeUndefined();
});

test('optional identifiers are omitted rather than written blank', () => {
  const bare = buildProductVals({ name: 'Rice', uomId: 1, categId: 5, barcode: '', defaultCode: '' });
  expect(bare.barcode).toBeUndefined();
  expect(bare.default_code).toBeUndefined();
  const full = buildProductVals({ name: 'Rice', uomId: 1, categId: 5, barcode: '4001', defaultCode: 'R-1' });
  expect(full.barcode).toBe('4001');
  expect(full.default_code).toBe('R-1');
});

test('a draft is created inactive, and active is otherwise never set', () => {
  expect(buildProductVals({ name: 'Scanned', uomId: 1, categId: 5, inactive: true }).active).toBe(false);
  expect(buildProductVals({ name: 'Normal', uomId: 1, categId: 5 }).active).toBeUndefined();
});

test('a scanned draft is stock-tracked from creation AND on approval', () => {
  // Both halves matter. A draft created untracked, then approved untracked, is a
  // product that can never take the count it was scanned during.
  expect(buildProductVals({ name: 'Scanned', uomId: 1, categId: 5, inactive: true }).is_storable).toBe(true);
  const a = buildDraftApprovalVals({ name: 'Scanned', uomId: 1, categId: 5 });
  expect(a.is_storable).toBe(true);
  expect(a.active).toBe(true);
});

test('approval carries a cost when given one, and invents none otherwise', () => {
  expect(buildDraftApprovalVals({ name: 'S', uomId: 1, categId: 5, cost: 3.2 }).standard_price).toBe(3.2);
  expect(buildDraftApprovalVals({ name: 'S', uomId: 1, categId: 5 }).standard_price).toBeUndefined();
  expect(buildDraftApprovalVals({ name: 'S', uomId: 1, categId: 5, cost: null }).standard_price).toBeUndefined();
  // ...and never a selling price, for the same reason as above.
  expect(buildDraftApprovalVals({ name: 'S', uomId: 1, categId: 5, cost: 3.2 }).list_price).toBeUndefined();
});
