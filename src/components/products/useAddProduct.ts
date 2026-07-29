'use client';

/**
 * "Add a product" — the state and the save, shared by every entry point in the
 * Products module so the dashboard button and the catalog button are the same
 * flow rather than two that drift.
 *
 * On success it navigates to the product's own page with ?new=1, which is the
 * whole design: this sheet asks the four things that cannot be guessed, and the
 * canonical page — which already owns the photo, price, tax, supplier, par and
 * note — takes it from there with a list of what is still missing. Building a
 * second full form would mean two places to fix a typo.
 */
import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

interface Option { id: number; name: string }

export interface AddProductPayload {
  name: string; uom_id: number; categ_id: number;
  default_code: string; barcode?: string; is_storable?: boolean;
}

export function useAddProduct() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [units, setUnits] = useState<Option[]>([]);
  const [categories, setCategories] = useState<Option[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  /**
   * The exact name a duplicate warning was shown for — not a bare boolean.
   *
   * A boolean leaks: warn about "Ting", let the manager edit the name to
   * "Ting Grapefruit", and the next submit would carry the override and
   * force-create a duplicate of THAT name with no warning at all. The override
   * only applies to the name it was actually shown for.
   */
  const [warnedName, setWarnedName] = useState<string | null>(null);

  // Loaded when the sheet first opens, not on mount: most visits to these
  // screens never add a product, and this is two extra requests.
  useEffect(() => {
    if (!open || (units.length > 0 && categories.length > 0)) return;
    fetch('/api/inventory/uoms').then((r) => (r.ok ? r.json() : { uoms: [] }))
      .then((d) => setUnits(d.uoms || [])).catch(() => {});
    fetch('/api/inventory/categories').then((r) => (r.ok ? r.json() : { categories: [] }))
      .then((d) => setCategories((d.categories || []).map((c: { id: number; complete_name?: string; name: string }) => ({
        id: c.id,
        // The full path: "RAW MATERIALS / Spices" and "PACKAGING / Spices" are
        // different places, and the leaf name alone cannot tell them apart.
        name: c.complete_name || c.name,
      })))).catch(() => {});
  }, [open, units.length, categories.length]);

  const start = useCallback(() => { setError(''); setWarnedName(null); setOpen(true); }, []);
  const close = useCallback(() => { setOpen(false); setError(''); setWarnedName(null); }, []);

  const create = useCallback(async (payload: AddProductPayload) => {
    if (saving) return;                       // a second tap must not create two
    setSaving(true);
    setError('');
    // Case- and space-insensitive, because the server's check is =ilike: the
    // override must cover the same name the warning was about, however it was
    // retyped, and nothing else.
    const norm = (v: string) => v.trim().toLowerCase();
    const overrideApplies = warnedName != null && norm(warnedName) === norm(payload.name);
    if (!overrideApplies && warnedName != null) setWarnedName(null);
    try {
      const res = await fetch('/api/products', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...payload,
          // Second attempt at the SAME name after a warning: the manager has
          // read it and said this really is a different product.
          ...(overrideApplies ? { allow_duplicate_name: true } : {}),
        }),
      });
      const d = await res.json().catch(() => ({}));

      if (res.status === 409 && d.code === 'NAME_EXISTS') {
        // A warning, not a wall. Two suppliers' "Chicken wings" are two real
        // products; refusing outright leaves no way to record the second.
        setWarnedName(payload.name);
        setError(`${d.error} Tap Create again if this really is a different one, or open the existing product from the list.`);
        return;
      }
      if (res.status === 409) { setError(d.error || 'That product already exists'); return; }
      if (!res.ok || !d.product?.id) { setError(d.error || 'Could not create the product'); return; }

      setOpen(false);
      setWarnedName(null);
      // ?new=1 so the page can lead with what is still missing rather than
      // presenting a mostly-empty form with no indication of what matters.
      router.push(`/products/${d.product.id}?new=1`);
    } catch {
      setError('Network error — the product was not created.');
    } finally {
      setSaving(false);
    }
  }, [saving, warnedName, router]);

  return { open, start, close, units, categories, saving, error, create };
}
