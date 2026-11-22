import { THRESHOLDS } from '../config/thresholds';
import { formatLocationCode, isMapped } from './spatialCues';
import { MedicineItem, UnitLayout } from './types';

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

export interface ShopAnalytics {
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
}

export function isStaleVerified(
  lastVerified: string | null,
  referenceDate: Date = new Date(),
): boolean {
  if (!lastVerified) return false;
  const parsed = new Date(`${lastVerified}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return false;
  const refUtc = Date.UTC(
    referenceDate.getUTCFullYear(),
    referenceDate.getUTCMonth(),
    referenceDate.getUTCDate(),
  );
  const ageDays = (refUtc - parsed.getTime()) / (1000 * 60 * 60 * 24);
  return ageDays > THRESHOLDS.STALE_DATA_DAYS;
}

export function isSlowFind(findTimeSec: number | null): boolean {
  return findTimeSec !== null && findTimeSec > THRESHOLDS.SLOW_FIND_THRESHOLD_SEC;
}

export function extractPrimarySalts(saltCompound: string): string[] {
  if (!saltCompound.trim()) return [];
  return saltCompound
    .split('+')
    .map((part) =>
      part
        .replace(/\([^)]*\)/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9\s-]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim(),
    )
    .filter((s) => s.length >= 3);
}

export function computeAnalytics(
  items: readonly MedicineItem[],
  layout: readonly UnitLayout[],
  referenceDate: Date = new Date(),
): ShopAnalytics {
  const unitById = new Map<string, UnitLayout>(layout.map((u) => [u.unit_id, u]));

  let mappedCount = 0;
  let slowFindCount = 0;
  let missingMrpCount = 0;
  let findSum = 0;
  let findCount = 0;

  const flaggedItems: MedicineItem[] = [];
  const staleItems: MedicineItem[] = [];
  const unassignedItems: MedicineItem[] = [];
  const relocationCandidates: RelocationCandidate[] = [];

  const binMap = new Map<string, MedicineItem[]>();
  const saltMap = new Map<string, Array<{ item_id: string; brand_name: string; code: string }>>();

  for (const item of items) {
    if (item.mrp_inr === null) missingMrpCount++;
    if (item.status === 'FLAGGED_MISSING') flaggedItems.push(item);

    const mapped = isMapped(item);
    if (mapped) {
      mappedCount++;
    } else {
      unassignedItems.push(item);
    }

    if (isStaleVerified(item.last_verified, referenceDate)) {
      staleItems.push(item);
    }

    if (item.find_time_sec !== null) {
      findSum += item.find_time_sec;
      findCount++;
      if (isSlowFind(item.find_time_sec)) {
        slowFindCount++;
        if (mapped && item.row !== null && item.col !== null && item.col >= 4) {
          relocationCandidates.push({
            item_id: item.item_id,
            brand_name: item.brand_name,
            currentCode: formatLocationCode(item.unit_id, item.row, item.col),
            unit_id: item.unit_id,
            row: item.row,
            col: item.col,
            find_time_sec: item.find_time_sec,
            reason: `Timed at ${item.find_time_sec.toFixed(1)}s in deep Col ${item.col}; promote closer to Col 1`,
          });
        }
      }
    }

    if (mapped && item.row !== null && item.col !== null) {
      const key = `${item.unit_id}|${item.row}|${item.col}`;
      const list = binMap.get(key);
      if (list) list.push(item);
      else binMap.set(key, [item]);

      const code = formatLocationCode(item.unit_id, item.row, item.col);
      for (const salt of extractPrimarySalts(item.salt_compound)) {
        const bucket = saltMap.get(salt);
        const ref = { item_id: item.item_id, brand_name: item.brand_name, code };
        if (bucket) bucket.push(ref);
        else saltMap.set(salt, [ref]);
      }
    }
  }

  const slowHotspots: BinBottleneck[] = [];
  for (const meds of binMap.values()) {
    const times = meds
      .map((m) => m.find_time_sec)
      .filter((t): t is number => t !== null);
    if (times.length === 0) continue;
    const max = Math.max(...times);
    if (max <= THRESHOLDS.SLOW_FIND_THRESHOLD_SEC) continue;
    const avg = times.reduce((a, b) => a + b, 0) / times.length;
    const first = meds[0];
    slowHotspots.push({
      unit_id: first.unit_id,
      unit_name: unitById.get(first.unit_id)?.name ?? first.unit_id,
      row: first.row!,
      col: first.col!,
      code: formatLocationCode(first.unit_id, first.row!, first.col!),
      itemCount: meds.length,
      avgFindTimeSec: Math.round(avg * 10) / 10,
      maxFindTimeSec: Math.round(max * 10) / 10,
      brands: meds.map((m) => m.brand_name),
    });
  }
  slowHotspots.sort((a, b) => b.maxFindTimeSec - a.maxFindTimeSec || a.code.localeCompare(b.code));

  const scatterAlerts: SaltScatterAlert[] = [];
  for (const [salt, refs] of saltMap.entries()) {
    const uniqueLocs = Array.from(new Set(refs.map((r) => r.code))).sort();
    if (uniqueLocs.length >= THRESHOLDS.SCATTER_MIN_SPOTS) {
      scatterAlerts.push({
        salt,
        spotCount: uniqueLocs.length,
        locations: uniqueLocs,
        items: refs,
      });
    }
  }
  scatterAlerts.sort((a, b) => b.spotCount - a.spotCount || a.salt.localeCompare(b.salt));

  relocationCandidates.sort((a, b) => b.find_time_sec - a.find_time_sec);

  return {
    summary: {
      totalItems: items.length,
      mappedCount,
      unassignedCount: unassignedItems.length,
      flaggedMissingCount: flaggedItems.length,
      slowFindCount,
      staleCount: staleItems.length,
      missingMrpCount,
      avgFindTimeSec: findCount > 0 ? Math.round((findSum / findCount) * 10) / 10 : null,
      scatterAlertCount: scatterAlerts.length,
    },
    slowHotspots,
    scatterAlerts,
    relocationCandidates,
    flaggedItems,
    staleItems,
    unassignedItems,
  };
}