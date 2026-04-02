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
  widthIn: string;
  heightIn: string;
  description: string;
}

export const LABEL_SIZE_PRESETS: LabelSize[] = [
  { id: '2x1', name: '2\" x 1\"', category: 'small', widthMm: 51, heightMm: 25, widthIn: '2\"', heightIn: '1\"', description: 'Prep \u2013 Small' },
  { id: '2x2', name: '2\" x 2\"', category: 'small', widthMm: 51, heightMm: 51, widthIn: '2\"', heightIn: '2\"', description: 'Prep \u2013 Square' },
  { id: '2.25x1.25', name: '2.25\" x 1.25\"', category: 'small', widthMm: 57, heightMm: 32, widthIn: '2.25\"', heightIn: '1.25\"', description: 'Product ID' },
  { id: '3x2', name: '3\" x 2\"', category: 'medium', widthMm: 76, heightMm: 51, widthIn: '3\"', heightIn: '2\"', description: 'Container' },
  { id: '4x2', name: '4\" x 2\"', category: 'medium', widthMm: 102, heightMm: 51, widthIn: '4\"', heightIn: '2\"', description: 'Ingredient' },
  { id: '4x3', name: '4\" x 3\"', category: 'medium', widthMm: 102, heightMm: 76, widthIn: '4\"', heightIn: '3\"', description: 'Production' },
  { id: '4x4', name: '4\" x 4\"', category: 'large', widthMm: 102, heightMm: 102, widthIn: '4\"', heightIn: '4\"', description: 'Barrel / Drum' },
  { id: '4x6', name: '4\" x 6\"', category: 'large', widthMm: 102, heightMm: 152, widthIn: '4\"', heightIn: '6\"', description: 'Full Detail' },
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
