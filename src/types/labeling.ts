// =============================================================================
// Labeling System Types
// Post-production: container split + Zebra ZPL label printing
// =============================================================================

// --- Label Size Presets ---

export interface LabelSize {
  id: string;
  name: string;
  category: 'small' | 'medium' | 'large';
  widthMm: number;
  heightMm: number;
  description: string;
}

/** Standard Zebra-compatible label sizes (metric primary) */
export const LABEL_SIZE_PRESETS: LabelSize[] = [
  { id: '55x75',   name: '55 × 75 mm',   category: 'medium', widthMm: 55,  heightMm: 75,  description: 'WAJ Standard' },
  { id: '51x25',   name: '51 × 25 mm',   category: 'small',  widthMm: 51,  heightMm: 25,  description: 'Prep – Small' },
  { id: '51x51',   name: '51 × 51 mm',   category: 'small',  widthMm: 51,  heightMm: 51,  description: 'Prep – Square' },
  { id: '57x32',   name: '57 × 32 mm',   category: 'small',  widthMm: 57,  heightMm: 32,  description: 'Product ID' },
  { id: '76x51',   name: '76 × 51 mm',   category: 'medium', widthMm: 76,  heightMm: 51,  description: 'Container' },
  { id: '102x51',  name: '102 × 51 mm',  category: 'medium', widthMm: 102, heightMm: 51,  description: 'Ingredient' },
  { id: '102x76',  name: '102 × 76 mm',  category: 'medium', widthMm: 102, heightMm: 76,  description: 'Production' },
  { id: '102x102', name: '102 × 102 mm', category: 'large',  widthMm: 102, heightMm: 102, description: 'Barrel / Drum' },
  { id: '102x152', name: '102 × 152 mm', category: 'large',  widthMm: 102, heightMm: 152, description: 'Full Detail' },
];

export const LABEL_CONSTRAINTS = {
  maxWidthMm: 108,
  minHeightMm: 25,
  maxHeightMm: 990,
} as const;

// --- Printer ---

export interface Printer {
  id: number;
  name: string;
  ip_address: string;
  port: number;
  location_id: number;
  location_name: string;
  dpi: number;
  default_label_size_id: string;
  custom_width_mm: number | null;
  custom_height_mm: number | null;
  active: number;
  created_at: string;
  updated_at: string;
}

export interface CreatePrinterRequest {
  name: string;
  ip_address: string;
  port?: number;
  location_id: number;
  location_name: string;
  dpi?: number;
  default_label_size_id?: string;
  custom_width_mm?: number;
  custom_height_mm?: number;
}

// --- Container Split ---

export interface ContainerSplit {
  id: number;
  mo_id: number;
  mo_name: string;
  product_id: number;
  product_name: string;
  total_qty: number;
  uom: string;
  status: string;
  created_by: number;
  created_at: string;
  confirmed_at: string | null;
}

export interface Container {
  id: number;
  split_id: number;
  sequence: number;
  qty: number;
  lot_name: string | null;
  lot_id: number | null;
  expiry_date: string | null;
  label_printed: number;
  last_printed_at: string | null;
}

export interface ContainerInput {
  qty: number;
  expiry_date?: string;
}

export interface CreateSplitRequest {
  mo_id: number;
  mo_name: string;
  product_id: number;
  product_name: string;
  total_qty: number;
  uom: string;
  containers: ContainerInput[];
}

// --- Print Job ---

export interface PrintJob {
  id: number;
  container_id: number;
  printer_id: number;
  printer_name: string;
  label_size_id: string;
  label_width_mm: number;
  label_height_mm: number;
  zpl_content: string;
  status: string;
  error_message: string | null;
  printed_by: number;
  printed_by_name: string;
  created_at: string;
}

// --- ZPL Label Data ---

export interface LabelData {
  productName: string;
  productReference?: string;
  productionDate: string;
  qty: number;
  uom: string;
  expiryDate: string;
  lotName?: string;
  moName: string;
  containerNumber: number;
  totalContainers: number;
  barcodeValue?: string;
}

// --- API Responses ---

export interface PrintResponse {
  success: boolean;
  jobId?: number;
  error?: string;
}

export interface SplitResponse {
  split: ContainerSplit;
  containers: Container[];
}

// --- Saved Custom Sizes (SQLite-persisted) ---

export interface SavedCustomSize {
  id: number;
  name: string;
  width_mm: number;
  height_mm: number;
  created_by: number;
  created_by_name: string;
  created_at: string;
  company_id: number;
}

// --- Default Label Size Preference (per user+company) ---

export interface LabelSizePreference {
  id: number;
  user_id: number;
  company_id: number;
  size_type: 'preset' | 'custom' | 'saved';
  preset_id: string | null;
  saved_size_id: number | null;
  custom_width_mm: number | null;
  custom_height_mm: number | null;
  updated_at: string;
}
