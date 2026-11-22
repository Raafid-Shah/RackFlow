import {
  LocationCue,
  MedicineItem,
  NeighborLandmark,
  PickLine,
  PickRoute,
  RouteGroup,
  RouteStop,
  UNASSIGNED_UNIT,
  UnitLayout,
} from './types';

export type ContainerIndex = Map<string, MedicineItem[]>;

export function isMapped(item: MedicineItem): boolean {
  return item.unit_id !== UNASSIGNED_UNIT && item.row !== null && item.col !== null;
}

export function formatLocationCode(unitId: string, row: number, col: number): string {
  return `${unitId} · R${row} · C${col}`;
}

export function itemCode(item: MedicineItem): string | null {
  if (!isMapped(item) || item.row === null || item.col === null) return null;
  return formatLocationCode(item.unit_id, item.row, item.col);
}

export function containerKey(unitId: string, row: number, col: number): string {
  return `${unitId}|${row}|${col}`;
}

export function buildContainerIndex(items: readonly MedicineItem[]): ContainerIndex {
  const index: ContainerIndex = new Map();
  for (const it of items) {
    if (!isMapped(it) || it.row === null || it.col === null) continue;
    const key = containerKey(it.unit_id, it.row, it.col);
    const list = index.get(key);
    if (list) list.push(it);
    else index.set(key, [it]);
  }
  return index;
}

export function relativeBand(row: number, col: number, rowWidth: number, totalRows: number): string {
  const vertical = (): string | null => {
    if (totalRows <= 1) return null;
    if (totalRows === 2) return row <= 1 ? 'Top' : 'Bottom';
    if (totalRows === 3) return ['Top', 'Middle', 'Bottom'][Math.min(2, Math.max(0, row - 1))];
    const idx = Math.min(3, Math.max(0, Math.floor(((row - 1) / totalRows) * 4)));
    return ['Top', 'Upper-Middle', 'Lower-Middle', 'Bottom'][idx];
  };

  const horizontal = (): string | null => {
    if (rowWidth <= 1) return null;
    if (rowWidth === 2) return col <= 1 ? 'Front End' : 'Far End';
    const idx = Math.min(2, Math.max(0, Math.floor(((col - 1) / rowWidth) * 3)));
    return ['Front End', 'Middle', 'Far End'][idx];
  };

  const parts = [vertical(), horizontal()].filter((p): p is string => p !== null);
  return parts.length > 0 ? parts.join(' · ') : 'Single Slot';
}

function distinctBrands(
  items: readonly MedicineItem[],
  excludeBrand: string | null,
  limit: number,
): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  const skip = excludeBrand === null ? null : excludeBrand.toLowerCase();

  for (const it of items) {
    const key = it.brand_name.toLowerCase();
    if (key === skip || seen.has(key)) continue;
    seen.add(key);
    out.push(it.brand_name);
    if (out.length >= limit) break;
  }
  return out;
}

function neighbor(
  containers: ContainerIndex,
  unitId: string,
  row: number,
  col: number,
): NeighborLandmark | null {
  if (col < 1) return null;
  const items = containers.get(containerKey(unitId, row, col));
  if (!items || items.length === 0) return null;
  const brands = distinctBrands(items, null, 3);
  return brands.length > 0 ? { col, brands } : null;
}

export function describeLocation(
  item: MedicineItem,
  containers: ContainerIndex,
  units: readonly UnitLayout[],
): LocationCue | null {
  const { row, col } = item;
  if (!isMapped(item) || row === null || col === null) return null;
  const unit = units.find((u) => u.unit_id === item.unit_id);
  const totalRows = unit ? unit.row_widths.length : row;
  const rowWidth = unit ? (unit.row_widths[row - 1] ?? col) : col;
  const here = containers.get(containerKey(item.unit_id, row, col)) ?? [];

  return {
    code: formatLocationCode(item.unit_id, row, col),
    unit_name: unit ? unit.name : item.unit_id,
    anchor_rule: unit ? unit.anchor_rule : '',
    band: relativeBand(row, col, rowWidth, totalRows),
    siblings: distinctBrands(here, item.brand_name, 3),
    left: neighbor(containers, item.unit_id, row, col - 1),
    right: neighbor(containers, item.unit_id, row, col + 1),
  };
}

function cmp<T extends string | number>(a: T, b: T): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function sanitizeQty(raw: unknown): number {
  const n = Math.floor(Number(raw));
  if (!Number.isFinite(n) || n < 1) return 1;
  return Math.min(n, 999);
}

export function buildPickRoute(
  lines: readonly PickLine[],
  items: readonly MedicineItem[],
  units: readonly UnitLayout[],
): PickRoute {
  const byId = new Map<string, MedicineItem>(items.map((i) => [i.item_id, i]));
  const unitById = new Map<string, UnitLayout>(units.map((u) => [u.unit_id, u]));
  const qtyById = new Map<string, number>();
  const unknownIds: string[] = [];

  for (const line of lines) {
    const id = String(line?.item_id ?? '').trim();
    if (id === '') continue;
    if (!byId.has(id)) {
      if (!unknownIds.includes(id)) unknownIds.push(id);
      continue;
    }
    qtyById.set(id, Math.min(999, (qtyById.get(id) ?? 0) + sanitizeQty(line.qty)));
  }

  let subtotalPaise = 0;
  let missingMrpCount = 0;
  const mapped: RouteStop[] = [];
  const unmapped: RouteStop[] = [];

  for (const [id, qty] of qtyById) {
    const item = byId.get(id);
    if (!item) continue;
    let lineTotal: number | null = null;
    if (item.mrp_inr === null) {
      missingMrpCount++;
    } else {
      const paise = Math.round(item.mrp_inr * 100) * qty;
      subtotalPaise += paise;
      lineTotal = paise / 100;
    }
    const stop: RouteStop = { item, qty, code: itemCode(item), lineTotal };
    (stop.code === null ? unmapped : mapped).push(stop);
  }

  const walk = (unitId: string): number =>
    unitById.get(unitId)?.walk_order ?? Number.MAX_SAFE_INTEGER;

  mapped.sort(
    (a, b) =>
      cmp(walk(a.item.unit_id), walk(b.item.unit_id)) ||
      cmp(a.item.unit_id, b.item.unit_id) ||
      cmp(a.item.col ?? 0, b.item.col ?? 0) ||
      cmp(a.item.row ?? 0, b.item.row ?? 0) ||
      cmp(a.item.brand_name, b.item.brand_name) ||
      cmp(a.item.item_id, b.item.item_id),
  );
  unmapped.sort(
    (a, b) => cmp(a.item.brand_name, b.item.brand_name) || cmp(a.item.item_id, b.item.item_id),
  );

  const groups: RouteGroup[] = [];
  for (const stop of mapped) {
    const last = groups[groups.length - 1];
    if (last && last.unit_id === stop.item.unit_id) {
      last.stops.push(stop);
    } else {
      const unit = unitById.get(stop.item.unit_id);
      groups.push({
        unit_id: stop.item.unit_id,
        unit_name: unit ? unit.name : stop.item.unit_id,
        anchor_rule: unit ? unit.anchor_rule : '',
        stops: [stop],
      });
    }
  }

  return {
    groups,
    unmapped,
    unknownIds,
    subtotalInr: subtotalPaise / 100,
    missingMrpCount,
    lineCount: qtyById.size,
  };
}