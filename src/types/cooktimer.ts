// =============================================================================
// KDS Cooking Timer — shared types
//
// A station-based cooking timer for What a Jerk. POS order lines whose product
// has a cook profile appear in a TO COOK queue on the tablet(s) covering that
// profile's station; staff tap to start, and the timer walks them through the
// product's step chain with audio + visual alarms. On finish, the covered lines
// are marked ready at LINE level (kds_line_ready), which the main KDS reads.
//
// Spec: docs/kds-cooking-timer-handoff.md. Approved UX: mocks/kds-cooking-timer.
// =============================================================================

export type CookStepType = 'cook' | 'rest' | 'action';

/** A single step in a product's cook chain. `action` steps have duration 0. */
export interface CookStep {
  id: number;
  seq: number;
  label: string;
  durationSeconds: number;
  stepType: CookStepType;
}

export interface CookStation {
  id: number;
  name: string;
  sort: number;
  active: boolean;
}

export interface CookProfile {
  id: number;
  odooProductId: number | null;
  name: string;
  stationId: number;
  maxBatch: number | null;
  active: boolean;
  steps: CookStep[];
}

/** One POS order line covered by a queue unit or a running timer. */
export interface CoveredLine {
  lineId: number;
  orderId: number;
  ref: string;   // display ticket ref, e.g. "#742" or a table name
  qty: number;
  arrivedMs: number; // order date_order as epoch ms (drives queue aging)
}

/** A TO COOK queue group: identical products (same profile) waiting now. */
export interface QueueGroup {
  profileId: number;
  profileName: string;
  stationId: number;
  stationName: string;
  stepLabels: string[];
  count: number;             // number of covered order lines
  oldestArrivedMs: number;   // oldest line's order time (drives group age)
  lines: CoveredLine[];      // sorted oldest-first
}

/** Persisted lifecycle of a timer. alarm/done are DERIVED client-side from
 *  step_started_at + step duration, never persisted. */
export type TimerLifecycle = 'running' | 'finished' | 'cancelled';

/** A running timer as sent to the client (profile + steps embedded). */
export interface CookTimerDTO {
  id: number;
  profileId: number;
  profileName: string;
  stationId: number;
  stationName: string;
  steps: CookStep[];
  currentStep: number;
  stepStartedEpoch: number;  // parsed from the offset-bearing Berlin stamp
  state: TimerLifecycle;
  muted: boolean;
  orderRefs: string[];
  lines: CoveredLine[];
  createdAtEpoch: number;
}

/** A recently-finished timer shown in the "READY -> KDS" strip. */
export interface DoneEntry {
  timerId: number;
  profileName: string;
  orderRefs: string[];
  readyAtEpoch: number;
}

export interface QueueResponse {
  queue: QueueGroup[];
  stations: CookStation[];
  error?: string;
}

export interface TimersResponse {
  timers: CookTimerDTO[];
  done: DoneEntry[];
  stations: CookStation[];
  serverNow: number;   // server epoch ms, for clock-offset correction
  error?: string;
}
