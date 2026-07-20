/**
 * Shift Handover — state vocabularies and the single validation authority.
 *
 * This file is PURE (no DB, no I/O) so it is unit-testable and is the one place
 * every API command calls to decide whether a container is in a legal state.
 * Preparation state ("what happened to the food") and availability state
 * ("may it be used") are deliberately separate axes; the cross-field rules below
 * stop contradictory combinations such as "cooling" + "ready for service".
 */

// ── Vocabularies ────────────────────────────────────────────────────────────

/** What has happened to the food. */
export const PREPARATION_STATES = [
  'raw',
  'prepared',
  'cut',
  'mixed',
  'smoking',
  'cooking',
  'cooling',
  'chilled',
  'ready',
  'partially_used',
] as const;
export type PreparationState = (typeof PREPARATION_STATES)[number];

/** Whether the food may be used. */
export const AVAILABILITY_STATES = [
  'not_ready',
  'ready_for_service',
  'backup_stock',
  'reserved',
  'on_hold',
  'expired',
  'discarded',
  'depleted',
] as const;
export type AvailabilityState = (typeof AVAILABILITY_STATES)[number];

/** How the recorded quantity was arrived at (kg is never mandatory). */
export const QUANTITY_METHODS = [
  'counted',
  'measured',
  'container_estimate',
  'visual',
  'unknown',
] as const;
export type QuantityMethod = (typeof QUANTITY_METHODS)[number];

/** Coarse fill levels — no arbitrary percentages. */
export const FILL_LEVELS = [0, 25, 50, 75, 100] as const;
export type FillLevel = (typeof FILL_LEVELS)[number];

/** Lifecycle of a physical container record. */
export const CONTAINER_STATUSES = ['active', 'depleted', 'discarded'] as const;
export type ContainerStatus = (typeof CONTAINER_STATUSES)[number];

/** Per-product / per-event photo requirement. */
export const PHOTO_POLICIES = ['optional', 'recommended', 'mandatory'] as const;
export type PhotoPolicy = (typeof PHOTO_POLICIES)[number];

/** Task / next-action priorities. */
export const ACTION_PRIORITIES = ['normal', 'important', 'urgent', 'food_safety_critical'] as const;
export type ActionPriorityLevel = (typeof ACTION_PRIORITIES)[number];

/** Discrepancy types the incoming shift can report against a submitted handover. */
export const DISCREPANCY_TYPES = [
  'confirmed',
  'quantity_differs',
  'product_not_found',
  'wrong_location',
  'wrong_state',
  'quality_issue',
  'temperature_issue',
  'other',
] as const;
export type DiscrepancyTypeValue = (typeof DISCREPANCY_TYPES)[number];

/**
 * Preparation states at which food is NOT yet safe/finished to serve. A
 * container in one of these may not carry availability "ready_for_service".
 * Thermal-danger / in-process states only — "chilled", "ready", "partially_used",
 * and the component end-states (prepared/cut/mixed) can legitimately be served.
 */
export const NOT_SERVEABLE_PREP_STATES: readonly PreparationState[] = [
  'raw',
  'smoking',
  'cooking',
  'cooling',
];

export function isServeablePrep(prep: string | null | undefined): boolean {
  if (!prep) return false;
  return !(NOT_SERVEABLE_PREP_STATES as readonly string[]).includes(prep);
}

// ── Validation ──────────────────────────────────────────────────────────────

export interface ContainerValidationInput {
  status: string;
  preparation_state: string | null;
  availability_state: string | null;
  storage_location_id: number | null;
  fill_level: number | null;
  quantity_method: string | null;
  /** Number of active photos attached to this container. */
  photo_count?: number;
  /** Photo requirement inherited from the product / event. */
  photo_policy?: string | null;
}

export interface ValidationError {
  code: string;
  message: string;
}

export interface ValidationResult {
  ok: boolean;
  errors: ValidationError[];
}

const inSet = (v: unknown, set: readonly unknown[]) => v != null && set.includes(v as never);

/**
 * Validate a single container. Returns every problem found (not just the first)
 * so the mobile UI can show them all at once.
 */
export function validateContainer(input: ContainerValidationInput): ValidationResult {
  const errors: ValidationError[] = [];
  const add = (code: string, message: string) => errors.push({ code, message });

  const isActive = input.status === 'active';

  // Enum sanity (present-but-wrong values).
  if (!inSet(input.status, CONTAINER_STATUSES)) {
    add('INVALID_STATUS', `Unknown container status "${input.status}".`);
  }
  if (input.preparation_state != null && !inSet(input.preparation_state, PREPARATION_STATES)) {
    add('INVALID_PREP_STATE', `Unknown preparation state "${input.preparation_state}".`);
  }
  if (input.availability_state != null && !inSet(input.availability_state, AVAILABILITY_STATES)) {
    add('INVALID_AVAILABILITY_STATE', `Unknown availability state "${input.availability_state}".`);
  }
  if (input.quantity_method != null && !inSet(input.quantity_method, QUANTITY_METHODS)) {
    add('INVALID_QUANTITY_METHOD', `Unknown quantity method "${input.quantity_method}".`);
  }
  if (input.fill_level != null && !inSet(input.fill_level, FILL_LEVELS)) {
    add('INVALID_FILL_LEVEL', 'Fill level must be Empty, 25%, 50%, 75% or Full.');
  }

  // Active containers must be locatable and have a preparation state.
  if (isActive && input.storage_location_id == null) {
    add('MISSING_LOCATION', 'Choose where this container is stored.');
  }
  if (isActive && input.preparation_state == null) {
    add('MISSING_PREP_STATE', 'Choose what state the food is in.');
  }

  // Depleted / discarded must agree on both axes so used-up stock never shows
  // as active.
  const av = input.availability_state;
  if (av === 'depleted' && input.status !== 'depleted') {
    add('DEPLETED_MISMATCH', 'A depleted container must be marked used up.');
  }
  // A terminal status must carry the matching availability — a missing (null)
  // availability is NOT an escape hatch.
  if (input.status === 'depleted' && av !== 'depleted') {
    add('DEPLETED_MISMATCH', 'A used-up container must show availability "depleted".');
  }
  if (av === 'discarded' && input.status !== 'discarded') {
    add('DISCARDED_MISMATCH', 'A discarded container must be marked discarded.');
  }
  if (input.status === 'discarded' && av !== 'discarded') {
    add('DISCARDED_MISMATCH', 'A discarded container must show availability "discarded".');
  }

  // The headline safety rule: food that is still in process can't be served.
  if (
    av === 'ready_for_service' &&
    inSet(input.preparation_state, PREPARATION_STATES) &&
    !isServeablePrep(input.preparation_state)
  ) {
    add('NOT_SERVEABLE', 'Food that is still raw, smoking, cooking or cooling can’t be marked ready for service.');
  }

  // Mandatory photo rule.
  if (input.photo_policy === 'mandatory' && (input.photo_count ?? 0) < 1) {
    add('PHOTO_REQUIRED', 'A photo is required for this product before saving.');
  }

  return { ok: errors.length === 0, errors };
}

// ── Fast-entry helpers ──────────────────────────────────────────────────────

/**
 * Spreadsheet-style container labels for fast entry: 0→A, 25→Z, 26→AA, 27→AB.
 * Used when a cook creates N identical containers at once.
 */
export function containerLabel(index: number): string {
  let n = Math.max(0, Math.floor(index)) + 1; // 1-indexed
  let out = '';
  while (n > 0) {
    const rem = (n - 1) % 26;
    out = String.fromCharCode(65 + rem) + out;
    n = Math.floor((n - 1) / 26);
  }
  return out;
}
