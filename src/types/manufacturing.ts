// =============================================================================
// Manufacturing Portal Types
// Maps to Odoo 18 EE models via JSON-RPC
// =============================================================================

// --- BOM ---

export interface BomLine {
  id: number;
  product_id: [number, string]; // [id, name]
  product_qty: number;
  product_uom_id: [number, string];
  bom_id?: [number, string];
  child_bom_id?: [number, string] | false; // sub-BOM reference
  child_line_ids?: BomLine[]; // resolved sub-BOM lines
}

export interface Bom {
  id: number;
  product_tmpl_id: [number, string];
  product_id?: [number, string] | false;
  product_qty: number;
  product_uom_id: [number, string];
  bom_line_ids: number[];
  type: 'normal' | 'phantom' | 'subcontract';
  code?: string;
  // Enriched fields (calculated by API)
  lines?: BomLine[];
  component_count?: number;
  availability_status?: 'ok' | 'low' | 'out';
  can_make_qty?: number;
  category?: string;
}

export interface ComponentAvailability {
  product_id: number;
  product_name: string;
  required_qty: number;
  on_hand_qty: number;
  uom: string;
  status: 'ok' | 'low' | 'out';
  is_sub_bom: boolean;
  sub_bom_id?: number;
  sub_bom_lines?: ComponentAvailability[];
}

// --- Manufacturing Order ---

export type MoState = 'draft' | 'confirmed' | 'progress' | 'to_close' | 'done' | 'cancel';

export interface ManufacturingOrder {
  id: number;
  name: string; // MO/00142
  product_id: [number, string];
  product_qty: number;
  product_uom_id: [number, string];
  bom_id: [number, string];
  state: MoState;
  date_start?: string;
  date_finished?: string;
  date_deadline?: string;
  user_id?: [number, string];
  move_raw_ids: number[];
  workorder_ids: number[];
  qty_producing: number;
  // Enriched
  components?: MoComponent[];
  work_orders?: WorkOrder[];
  progress_percent?: number;
}

export interface MoComponent {
  id: number;
  product_id: [number, string];
  product_uom_qty: number;
  quantity: number; // done/consumed qty (Odoo 18: 'quantity' on stock.move)
  product_uom: [number, string];
  forecast_availability: number;
  is_picked?: boolean; // waj_is_picked custom field
  state: string;
}

// --- Work Order ---

export type WoState = 'pending' | 'waiting' | 'ready' | 'progress' | 'done' | 'cancel';

export interface WorkOrder {
  id: number;
  name: string;
  workcenter_id: [number, string];
  state: WoState;
  duration_expected: number; // minutes
  duration: number; // actual elapsed minutes
  date_start?: string;
  date_finished?: string;
  sequence: number;
  production_id: [number, string];
  // Components assigned to this work order step
  move_raw_ids?: number[];
  components?: MoComponent[];
  // Timer state
  is_timer_running?: boolean;
  time_ids?: number[]; // mrp.workcenter.productivity records
}

// --- Stock ---

export interface StockQuant {
  id: number;
  product_id: [number, string];
  location_id: [number, string];
  quantity: number;
  reserved_quantity: number;
  available_quantity: number; // computed
}

// --- API Request/Response ---

export interface CreateMoRequest {
  product_id: number;
  bom_id: number;
  product_qty: number;
  product_uom_id: number;
  date_deadline?: string;
  user_id?: number;
  company_id?: number;
}

export interface BomListResponse {
  boms: Bom[];
  total: number;
}

export interface BomDetailResponse {
  bom: Bom;
  components: ComponentAvailability[];
  can_make_qty: number;
}
