/**
 * Shift Handover — database row types.
 *
 * The module is a simple shift LOG: the outgoing shift posts entries (a type +
 * a note and/or photos); "Stored" entries also pin a persistent storage item
 * the next shift can see until it's marked used. Pure type declarations (no DB
 * import) so server and client can share them.
 */

/** A manager-configurable entry type shown as a chip on the add sheet. */
export interface LogType {
  id: number;
  company_id: number;
  name: string;
  emoji: string;
  /** Red, and asks the next shift to acknowledge (e.g. "Heads-up"). */
  is_alert: number;
  /** Posting this type also pins a persistent "In storage now" item (e.g. "Stored"). */
  is_storage: number;
  sort_order: number;
  active: number;
  created_at: string;
  updated_at: string;
}

/** One post in the daily feed. */
export interface LogEntry {
  id: number;
  company_id: number;
  operational_date: string;
  type_id: number | null;
  /** Type name/emoji/alert are snapshotted so history stays stable if a type is edited/deleted. */
  type_name: string;
  type_emoji: string;
  is_alert: number;
  note: string | null;
  storage_item_id: number | null;
  author_user_id: number | null;
  author_name: string | null;
  acknowledged_by_user_id: number | null;
  acknowledged_by_name: string | null;
  acknowledged_at: string | null;
  active: number;
  edited_at: string | null;
  created_at: string;
  updated_at: string;
}

/** A persistent "In storage now" item — lives until someone marks it used. */
export interface StorageItem {
  id: number;
  company_id: number;
  name: string;
  location_text: string | null;
  use_first: number;
  status: 'here' | 'used' | string;
  entry_id: number | null;
  added_by_user_id: number | null;
  added_by_name: string | null;
  added_at: string;
  used_by_user_id: number | null;
  used_by_name: string | null;
  used_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface HandoverPhoto {
  id: number;
  company_id: number;
  entity_type: string;
  entity_id: number;
  event: string | null;
  photo: string;
  caption: string | null;
  uploaded_by_user_id: number | null;
  uploaded_by_name: string | null;
  uploaded_at: string;
  active: number;
  replaced_photo_id: number | null;
}
