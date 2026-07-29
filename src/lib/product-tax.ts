/**
 * Per-restaurant tax on a shared product.
 *
 * THE PROBLEM THIS SOLVES. In Odoo a product's `taxes_id` is a many2many that
 * spans every company at once. Most products in this database are shared
 * (company_id = false), so one bottle of soy sauce carries WAJ's tax, Ssam's tax
 * and Krawings' tax simultaneously, side by side in the same field. Odoo picks
 * the right one at invoice time by matching the company.
 *
 * So the obvious write is a data-loss bug:
 *
 *     taxes_id = [[6, 0, [chosenTaxId]]]      // "SET the list to just this"
 *
 * That is a full replace. Setting WAJ's tax this way silently deletes Ssam's and
 * Krawings' tax from the same product, and nobody notices until an invoice comes
 * out with no VAT on it. (That exact line is live today in the POS drinks
 * editor. It has not caused damage only because every product it has touched
 * happened to be tagged to one company, where there was nothing else to lose.)
 *
 * The correct write keeps every other company's taxes and replaces only the
 * active company's. These are pure functions so that rule can be tested without
 * an Odoo, which matters: the failure is invisible from the screen that causes
 * it and shows up weeks later in somebody else's accounts.
 */

/** A tax as the portal needs to know it. */
export interface TaxOption {
  id: number;
  name: string;
  /** The real percentage. Shown next to the name because names lie — WAJ has
   *  one called "19% Vorsteuer" that is configured at 0%. */
  amount: number;
  /** Odoo's price_include: is the tax already inside the price shown? */
  included: boolean;
  company_id: number;
}

/**
 * Which tax on this product belongs to the active restaurant.
 *
 * Returns null when the restaurant has not set one. Never guesses from the
 * first entry in the list — that is whichever company happens to sort first,
 * and reading another restaurant's rate as your own is how a wrong number gets
 * shown confidently.
 */
export function currentCompanyTax(productTaxIds: number[], companyTaxIds: readonly number[]): number | null {
  const owned = new Set(companyTaxIds);
  const mine = productTaxIds.filter((id) => owned.has(id));
  // More than one is a misconfiguration rather than an error: return the first
  // so the screen can show something, and let a save clean it up (the merge
  // below drops every one of this company's before adding the chosen one).
  return mine.length > 0 ? mine[0] : null;
}

/** True when this product carries more than one tax for the active company. */
export function hasConflictingTax(productTaxIds: number[], companyTaxIds: readonly number[]): boolean {
  const owned = new Set(companyTaxIds);
  return productTaxIds.filter((id) => owned.has(id)).length > 1;
}

/**
 * Odoo many2many commands: 3 = unlink this id, 4 = link this id.
 */
export type TaxCommand = [3, number] | [4, number];

/**
 * THE WRITE. Targeted unlink/link commands rather than a full SET — and that
 * choice is the difference between correct and merely usually-correct.
 *
 * mergeCompanyTax() above computes the right FINAL list, but writing it with
 * (6, 0, list) restates every other company's taxes as well, so it carries the
 * whole relation across a read-modify-write. Two restaurants saving the same
 * shared product seconds apart then lose one another's change:
 *
 *   start        [WAJ-old, Ssam-old]
 *   WAJ  writes  [WAJ-new, Ssam-old]      (read before Ssam's write)
 *   Ssam writes  [WAJ-old, Ssam-new]      (read before WAJ's write) — WAJ reverted
 *
 * These are separate RPC calls with no shared transaction, so no amount of care
 * in the merge prevents it. Unlink/link touches ONLY this restaurant's rows, so
 * another company's tax is never named in the write and cannot be clobbered by
 * it. Same-restaurant concurrency still ends last-write-wins, which is both
 * expected and harmless — it is one restaurant disagreeing with itself.
 *
 * Idempotent: setting the tax a product already has produces no commands.
 *
 * It does NOT make two saves for the SAME restaurant safe. Both read tax A, one
 * chooses B and one chooses C, and each emits "unlink A, link mine" — leaving
 * the product with B AND C. That is why the route re-reads after writing and
 * corrects any leftover (see reconcileCompanyTax below); unlink/link removes the
 * cross-company danger, not every race.
 */
export function taxDiffCommands(
  productTaxIds: number[],
  companyTaxIds: readonly number[],
  chosen: number | null,
): TaxCommand[] {
  const owned = new Set(companyTaxIds);
  if (chosen != null && !owned.has(chosen)) {
    throw new Error('TAX_NOT_IN_COMPANY: that tax belongs to a different restaurant');
  }
  const mine = productTaxIds.filter((id) => owned.has(id));
  const cmds: TaxCommand[] = mine
    .filter((id) => id !== chosen)
    .map((id) => [3, id] as TaxCommand);
  if (chosen != null && !productTaxIds.includes(chosen)) cmds.push([4, chosen]);
  return cmds;
}

/**
 * What still needs unlinking AFTER a write, given what the product actually
 * holds now.
 *
 * The write above computes its commands from a read that has since gone stale.
 * If another save for the same restaurant landed in between, both taxes end up
 * linked — so the route reads back and calls this. It returns the unlinks needed
 * to leave exactly the intended tax, and nothing when the state is already
 * right (the normal case, so the correction costs one read and no write).
 *
 * Deliberately only ever UNLINKS. If the intended tax has vanished — because the
 * other save cleared it — that is that save's decision, and re-adding it here
 * would start the two requests fighting.
 */
export function reconcileCompanyTax(
  actualTaxIds: number[],
  companyTaxIds: readonly number[],
  intended: number | null,
): TaxCommand[] {
  const owned = new Set(companyTaxIds);
  return actualTaxIds
    .filter((id) => owned.has(id) && id !== intended)
    .map((id) => [3, id] as TaxCommand);
}
