export type ItemStatus = 'OK' | 'FLAGGED_MISSING' | 'UNASSIGNED';

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

export interface UnitLayout {
  unit_id: string;
  name: string;
  walk_order: number;
  anchor_rule: string;
  row_widths: number[];
}

export interface Warning {
  code: string;
  severity: 'error' | 'warn' | 'info';
  line: number;
  message: string;
  item_id?: string;
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

export interface SearchHit {
  item: MedicineItem;
  score: number;
  tier: 1 | 2 | 3;
  isApproximate: boolean;
  alsoStoredAt: string[];
  cue: LocationCue | null;
  isSlowFind: boolean;
  isStale: boolean;
}

export interface SearchResponse {
  query: string;
  count: number;
  elapsedMs: number;
  results: SearchHit[];
}

export interface PickLine {
  item_id: string;
  qty: number;
}

export interface EnrichedRouteStop {
  item: MedicineItem;
  qty: number;
  code: string | null;
  lineTotal: number | null;
  cue?: LocationCue | null;
  isSlowFind?: boolean;
}

export interface EnrichedRouteGroup {
  unit_id: string;
  unit_name: string;
  anchor_rule: string;
  stops: EnrichedRouteStop[];
}

export interface PickRouteResponse {
  groups: EnrichedRouteGroup[];
  unmapped: EnrichedRouteStop[];
  unknownIds: string[];
  subtotalInr: number;
  missingMrpCount: number;
  lineCount: number;
}

export interface PublicOrgConfig {
  shopName: string;
  showPinHint: boolean;
  pinHint: string | null;
  staffPresets: string[];
  thresholds: Record<string, number>;
}

export interface InventoryResponse {
  items: MedicineItem[];
  layout: UnitLayout[];
  warnings: Warning[];
  totalRows: number;
  quarantined: number;
  backupCount: number;
}

export interface CellCoord {
  unit_id: string;
  row: number;
  col: number;
}

export interface BinBottleneck {
  unit_id: string;
  unit_name: string;
  row: number;
  col: number;
  code: string;
  itemCount: number;
  avgFindTimeSec: number;
  maxFindTimeSec: number;
  brands: string[];
}

export interface SaltScatterAlert {
  salt: string;
  spotCount: number;
  locations: string[];
  items: Array<{ item_id: string; brand_name: string; code: string }>;
}

export interface RelocationCandidate {
  item_id: string;
  brand_name: string;
  currentCode: string;
  unit_id: string;
  row: number;
  col: number;
  find_time_sec: number;
  reason: string;
}

export interface ShopAnalyticsResponse {
  summary: {
    totalItems: number;
    mappedCount: number;
    unassignedCount: number;
    flaggedMissingCount: number;
    slowFindCount: number;
    staleCount: number;
    missingMrpCount: number;
    avgFindTimeSec: number | null;
    scatterAlertCount: number;
  };
  slowHotspots: BinBottleneck[];
  scatterAlerts: SaltScatterAlert[];
  relocationCandidates: RelocationCandidate[];
  flaggedItems: MedicineItem[];
  staleItems: MedicineItem[];
  unassignedItems: MedicineItem[];
  warnings: Warning[];
  backupCount: number;
}

export interface AuditEntry {
  timestamp: string;
  actor: string;
  role: 'staff' | 'moderator';
  action: string;
  summary: string;
  snapshot?: string | null;
  meta?: Record<string, unknown>;
}

export interface ImportCsvResponse {
  addedCount: number;
  skippedDuplicates: number;
  added: MedicineItem[];
  warnings: Warning[];
  backupCount: number;
}