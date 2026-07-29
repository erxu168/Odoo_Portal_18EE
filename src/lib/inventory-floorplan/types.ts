/**
 * Inventory Floorplan — shared types.
 *
 * Pt is a point in PAGE FRACTIONS of the uploaded plan (0–1 on both axes,
 * y grows DOWN, i.e. top edge = 0). Every polygon stored anywhere in the
 * floorplan tables uses this space, which makes marker positions independent
 * of the raster resolution: re-rendering the PDF sharper never moves a pin.
 */

export interface Pt {
  x: number;
  y: number;
}

export type RevisionStatus = 'draft' | 'published' | 'superseded' | 'failed';
export type CandidateKind = 'spot' | 'room' | 'other';
export type CandidateDisposition = 'pending' | 'linked' | 'create' | 'ignored';
export type AnchorDisplay = 'overlay' | 'pin';

export interface FloorRow {
  id: number;
  company_id: number;
  name: string;
  code: string;
  sort_order: number;
  active: number;
  current_revision_id: number | null;
  created_by: number | null;
  created_at: string;
  updated_at: string | null;
}

export interface RevisionRow {
  id: number;
  floor_id: number;
  document_id: number;
  revision_no: number;
  source_page_number: number;
  page_width: number;
  page_height: number;
  page_rotation: number;
  raster_relpath: string;
  raster_mime: string;
  raster_width: number;
  raster_height: number;
  raster_bytes: number;
  coord_version: number;
  status: RevisionStatus;
  version: number;
  uploaded_by: number | null;
  uploaded_at: string;
  published_by: number | null;
  published_at: string | null;
}

export interface CandidateRow {
  id: number;
  revision_id: number;
  item_index: number;
  raw_text: string;
  normalized_text: string;
  polygon: Pt[];
  rotation_degrees: number;
  proposed_kind: CandidateKind;
  disposition: CandidateDisposition;
  ignored_reason: string | null;
  linked_location_id: number | null;
  proposed_type: string | null;
  proposed_room: string | null;
}

export interface AnchorRow {
  id: number;
  revision_id: number;
  count_location_id: number;
  source_candidate_id: number | null;
  polygon: Pt[];
  cx: number;
  cy: number;
  label: string;
  display: AnchorDisplay;
  is_primary: number;
  created_by: number | null;
  created_at: string;
}
