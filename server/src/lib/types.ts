export const UNASSIGNED_UNIT = 'UNASSIGNED';

export const CSV_COLUMNS = [
  'item_id',
  'brand_name',
  'salt_compound',
  'strength_form',
  'category',
  'tags',
  'unit_id',
  'row',
  'col',
  'mrp_inr',
  'find_time_sec',
  'observed_at',
  'last_verified',
  'status',
  'notes',
] as const;

export type CsvColumn = (typeof CSV_COLUMNS)[number];
export type ItemStatus = 'OK' | 'FLAGGED_MISSING' | 'UNASSIGNED';
export const ITEM_STATUSES: readonly ItemStatus[] = ['OK', 'FLAGGED_MISSING', 'UNASSIGNED'];

export interface MedicineItem {
  item_id: string;
  brand_name: string;
  salt_compound: string;
  strength_form: string;
  category: string;
  tags: string[];
  unit_id: string;
  row: number | null;
  col: number | null;
  mrp_inr: number | null;
  find_time_sec: number | null;
  observed_at: string;
  last_verified: string | null;
  status: ItemStatus;
  notes: string;
}

export type WarningSeverity = 'error' | 'warn' | 'info';
export type WarningCode =
  | 'FILE_MISSING'
  | 'FILE_UNREADABLE'
  | 'HEADER_MISSING_BRAND'
  | 'MISSING_BRAND'
  | 'BAD_ROW'
  | 'BAD_COL'
  | 'PARTIAL_LOCATION'
  | 'BAD_MRP'
  | 'BAD_FIND_TIME'
  | 'BAD_LAST_VERIFIED'
  | 'BAD_OBSERVED_AT'
  | 'BAD_STATUS'
  | 'DUPLICATE_ID'
  | 'EXTRA_COLUMNS'
  | 'ROW_PARSE_ERROR'
  | 'LAYOUT_INVALID'
  | 'LAYOUT_EXPANDED'
  | 'UNIT_INFERRED';

export interface Warning {
  code: WarningCode;
  severity: WarningSeverity;
  line: number;
  message: string;
  item_id?: string;
  field?: string;
  rawValue?: string;
}

export interface UnitLayout {
  unit_id: string;
  name: string;
  walk_order: number;
  anchor_rule: string;
  row_widths: number[];
}

export interface LoadResult {
  items: MedicineItem[];
  warnings: Warning[];
  totalRows: number;
  quarantined: number;
}

export type SearchTier = 1 | 2 | 3;

export interface SearchResult {
  item: MedicineItem;
  score: number;
  tier: SearchTier;
  isApproximate: boolean;
  alsoStoredAt: string[];
}

export interface NeighborLandmark {
  col: number;
  brands: string[];
}

export interface LocationCue {
  code: string;
  unit_name: string;
  anchor_rule: string;
  band: string;
  siblings: string[];
  left: NeighborLandmark | null;
  right: NeighborLandmark | null;
}

export interface PickLine {
  item_id: string;
  qty: number;
}

export interface RouteStop {
  item: MedicineItem;
  qty: number;
  code: string | null;
  lineTotal: number | null;
}

export interface RouteGroup {
  unit_id: string;
  unit_name: string;
  anchor_rule: string;
  stops: RouteStop[];
}

export interface PickRoute {
  groups: RouteGroup[];
  unmapped: RouteStop[];
  unknownIds: string[];
  subtotalInr: number;
  missingMrpCount: number;
  lineCount: number;
}