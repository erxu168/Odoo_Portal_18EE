/**
 * Shift Handover — plain-English display labels + badge tones for the mobile UI.
 * Client-safe (imports only the pure states module). No ERP jargon.
 */
export const PREP_LABELS: Record<string, string> = {
  raw: 'Raw', prepared: 'Prepared', cut: 'Cut', mixed: 'Mixed',
  smoking: 'Smoking', cooking: 'Cooking', cooling: 'Cooling', chilled: 'Chilled',
  ready: 'Ready', partially_used: 'Partly used',
};

export const AVAIL_LABELS: Record<string, string> = {
  not_ready: 'Not ready', ready_for_service: 'Ready for service', backup_stock: 'Backup stock',
  reserved: 'Reserved', on_hold: 'On hold', expired: 'Expired', discarded: 'Discarded', depleted: 'Used up',
};

/** Badge tone key understood by design-system getBadgeStyle(). */
export const AVAIL_BADGE: Record<string, string> = {
  not_ready: 'progress', ready_for_service: 'done', backup_stock: 'confirmed', reserved: 'confirmed',
  on_hold: 'due_soon', expired: 'overdue', discarded: 'overdue', depleted: 'draft',
};

export const FILL_LABELS: Record<number, string> = { 0: 'Empty', 25: '25% full', 50: 'Half full', 75: '75% full', 100: 'Full' };

export const QMETHOD_LABELS: Record<string, string> = {
  counted: 'Counted', measured: 'Measured', container_estimate: 'By container', visual: 'Eyeballed', unknown: 'Unknown',
};

export const PRIORITY_LABELS: Record<string, string> = {
  normal: 'Normal', important: 'Important', urgent: 'Urgent', food_safety_critical: 'Food safety',
};
export const PRIORITY_BADGE: Record<string, string> = {
  normal: 'draft', important: 'confirmed', urgent: 'due_soon', food_safety_critical: 'overdue',
};

export const DISCREPANCY_LABELS: Record<string, string> = {
  confirmed: 'Confirmed', quantity_differs: 'Quantity differs', product_not_found: 'Product not found',
  wrong_location: 'Wrong location', wrong_state: 'Wrong state', quality_issue: 'Quality issue',
  temperature_issue: 'Temperature issue', other: 'Other',
};

export const HANDOVER_STATUS_LABELS: Record<string, string> = {
  draft: 'Draft', submitted: 'Awaiting acknowledgement', acknowledged: 'Acknowledged',
  acknowledged_with_discrepancies: 'Acknowledged — issues noted', superseded: 'Superseded',
};
export const HANDOVER_STATUS_BADGE: Record<string, string> = {
  draft: 'draft', submitted: 'due_soon', acknowledged: 'done', acknowledged_with_discrepancies: 'overdue', superseded: 'draft',
};

export const KIND_LABELS: Record<string, string> = { finished: 'Finished', component: 'Component', other: 'Other' };
