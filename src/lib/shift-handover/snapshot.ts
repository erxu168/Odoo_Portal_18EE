/**
 * Shift Handover — pure snapshot helpers.
 *
 *  - `computeSnapshotHash` produces an order-independent SHA-256 fingerprint of
 *    the frozen handover data, so a submitted snapshot can be proven unchanged.
 *  - `buildHandoverSections` turns the live container/action set into the eight
 *    display sections of the auto-generated handover. Pure so it drives both the
 *    live preview and the frozen snapshot from one code path.
 */
import { createHash } from 'crypto';
import { isServeablePrep } from './states';

// ── Canonical hashing ────────────────────────────────────────────────────────

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) {
    // Snapshot rows are a set, not a sequence — sort so order can't change the
    // fingerprint.
    return value
      .map(canonical)
      .sort((a, b) => (JSON.stringify(a) < JSON.stringify(b) ? -1 : 1));
  }
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(value as Record<string, unknown>).sort()) {
      out[k] = canonical((value as Record<string, unknown>)[k]);
    }
    return out;
  }
  return value;
}

export function computeSnapshotHash(payload: unknown): string {
  return createHash('sha256').update(JSON.stringify(canonical(payload))).digest('hex');
}

// ── Handover section grouping ────────────────────────────────────────────────

export interface PreviewContainer {
  id: number;
  batch_id: number;
  product_id: number;
  product_name: string;
  product_kind: string | null;
  container_code: string;
  container_type_name: string | null;
  fill_level: number | null;
  preparation_state: string | null;
  availability_state: string | null;
  storage_location_id: number | null;
  storage_location_name: string | null;
  use_first: number;
  next_action: string | null;
  status: string;
}

export interface PreviewAction {
  id: number;
  instruction: string;
  priority: string;
  status: string;
  due_at: string | null;
  container_id: number | null;
  batch_id: number | null;
}

export interface HandoverSections {
  ready_for_service: PreviewContainer[];
  backup_stock: PreviewContainer[];
  in_production_or_cooling: PreviewContainer[];
  components_prepared: PreviewContainer[];
  use_first: PreviewContainer[];
  on_hold_or_discrepancy: PreviewContainer[];
  actions_required: PreviewAction[];
  no_production: boolean;
}

/** Section keys in the order they should be shown on the handover screen. */
export const HANDOVER_SECTION_ORDER: Array<{ key: keyof HandoverSections; label: string }> = [
  { key: 'ready_for_service', label: 'Ready for Service' },
  { key: 'backup_stock', label: 'Backup Stock' },
  { key: 'in_production_or_cooling', label: 'In Production or Cooling' },
  { key: 'components_prepared', label: 'Components Prepared Separately' },
  { key: 'use_first', label: 'Use First' },
  { key: 'actions_required', label: 'Actions Required' },
  { key: 'on_hold_or_discrepancy', label: 'On Hold or Discrepancies' },
];

/**
 * Group live containers + open actions into the handover display sections.
 * Only ACTIVE containers count as stock; depleted/discarded are excluded (they
 * must never show as available). Use-first and component lists are cross-cutting
 * — a container can appear in its availability section AND in those.
 */
export function buildHandoverSections(
  containers: PreviewContainer[],
  actions: PreviewAction[],
  productKinds: Record<number, string> = {},
): HandoverSections {
  const active = containers.filter((c) => c.status === 'active');

  const sections: HandoverSections = {
    ready_for_service: [],
    backup_stock: [],
    in_production_or_cooling: [],
    components_prepared: [],
    use_first: [],
    on_hold_or_discrepancy: [],
    actions_required: [],
    no_production: active.length === 0,
  };

  for (const c of active) {
    const kind = c.product_kind ?? productKinds[c.product_id] ?? 'finished';
    if (kind === 'component') sections.components_prepared.push(c);
    if (c.use_first) sections.use_first.push(c);

    const av = c.availability_state;
    const inProcess = !isServeablePrep(c.preparation_state); // raw / smoking / cooking / cooling
    if (av === 'ready_for_service') sections.ready_for_service.push(c);
    else if (av === 'on_hold' || av === 'expired') sections.on_hold_or_discrepancy.push(c);
    else if (av === 'backup_stock' || av === 'reserved') sections.backup_stock.push(c);
    else if (av === 'not_ready' || inProcess) sections.in_production_or_cooling.push(c);
    else sections.backup_stock.push(c); // reserved-like / catch-all
  }

  sections.actions_required = actions.filter(
    (a) => a.status === 'open' || a.status === 'in_progress',
  );

  return sections;
}
