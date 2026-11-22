import { parseCsv, serializeCsv } from './csvCodec';
import { formatLocationCode } from './spatialCues';
import {
  ITEM_STATUSES,
  ItemStatus,
  MedicineItem,
  UNASSIGNED_UNIT,
  UnitLayout,
  Warning,
} from './types';
import { loadItemsFromCsv, MAX_GRID_INDEX } from './validator';

export class MutationError extends Error {
  constructor(
    message: string,
    readonly statusCode = 400,
  ) {
    super(message);
    this.name = 'MutationError';
  }
}

export function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function validateCoord(
  unit_id: string,
  row: number | null,
  col: number | null,
): { unit_id: string; row: number | null; col: number | null } {
  const unit = unit_id.trim().toUpperCase();
  if (unit === '' || unit === UNASSIGNED_UNIT) {
    return { unit_id: UNASSIGNED_UNIT, row: null, col: null };
  }
  if (
    row === null ||
    col === null ||
    !Number.isInteger(row) ||
    !Number.isInteger(col) ||
    row < 1 ||
    row > MAX_GRID_INDEX ||
    col < 1 ||
    col > MAX_GRID_INDEX
  ) {
    throw new MutationError(
      `Invalid shelf coordinate (${unit}, row=${String(row)}, col=${String(col)}); expected integers 1-${MAX_GRID_INDEX}`,
    );
  }
  return { unit_id: unit, row, col };
}

function nextMedicineId(items: readonly MedicineItem[]): string {
  const used = new Set(items.map((i) => i.item_id));
  let n = items.length + 1;
  let candidate = `MED-${String(n).padStart(3, '0')}`;
  while (used.has(candidate)) {
    n++;
    candidate = `MED-${String(n).padStart(3, '0')}`;
  }
  return candidate;
}

export function flagItemMissing(
  items: readonly MedicineItem[],
  itemId: string,
  note?: string,
): { items: MedicineItem[]; updated: MedicineItem } {
  const idx = items.findIndex((i) => i.item_id === itemId);
  if (idx === -1) throw new MutationError(`Medicine "${itemId}" not found`, 404);

  const existing = items[idx];
  const trimmedNote = note?.trim();
  const updated: MedicineItem = {
    ...existing,
    status: 'FLAGGED_MISSING',
    notes: trimmedNote
      ? existing.notes
        ? `${existing.notes} | Flagged: ${trimmedNote}`
        : `Flagged: ${trimmedNote}`
      : existing.notes,
  };

  const next = [...items];
  next[idx] = updated;
  return { items: next, updated };
}

export interface CreateItemInput {
  brand_name: string;
  salt_compound?: string;
  strength_form?: string;
  category?: string;
  tags?: string[];
  unit_id?: string;
  row?: number | null;
  col?: number | null;
  mrp_inr?: number | null;
  find_time_sec?: number | null;
  notes?: string;
}

export function createItem(
  items: readonly MedicineItem[],
  input: CreateItemInput,
): { items: MedicineItem[]; created: MedicineItem } {
  const brand = String(input.brand_name ?? '').trim();
  if (!brand) throw new MutationError('brand_name is required');

  const loc = validateCoord(
    input.unit_id ?? UNASSIGNED_UNIT,
    input.row ?? null,
    input.col ?? null,
  );
  const mrp =
    input.mrp_inr === undefined || input.mrp_inr === null
      ? null
      : Number(input.mrp_inr);
  if (mrp !== null && (!Number.isFinite(mrp) || mrp < 0)) {
    throw new MutationError('mrp_inr must be a non-negative number or null');
  }

  const findTime =
    input.find_time_sec === undefined || input.find_time_sec === null
      ? null
      : Number(input.find_time_sec);
  if (findTime !== null && (!Number.isFinite(findTime) || findTime < 0)) {
    throw new MutationError('find_time_sec must be a non-negative number or null');
  }

  const now = new Date();
  const hhmm = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;

  const created: MedicineItem = {
    item_id: nextMedicineId(items),
    brand_name: brand,
    salt_compound: String(input.salt_compound ?? '').trim(),
    strength_form: String(input.strength_form ?? '').trim(),
    category: String(input.category ?? '').trim(),
    tags: Array.isArray(input.tags)
      ? input.tags.map((t) => String(t).trim()).filter(Boolean)
      : [],
    unit_id: loc.unit_id,
    row: loc.row,
    col: loc.col,
    mrp_inr: mrp === null ? null : Math.round(mrp * 100) / 100,
    find_time_sec: findTime === null ? null : Math.round(findTime * 10) / 10,
    observed_at: hhmm,
    last_verified: loc.unit_id === UNASSIGNED_UNIT ? null : todayIso(),
    status: loc.unit_id === UNASSIGNED_UNIT ? 'UNASSIGNED' : 'OK',
    notes: String(input.notes ?? '').trim(),
  };

  return { items: [...items, created], created };
}

export interface UpdateItemInput {
  brand_name?: string;
  salt_compound?: string;
  strength_form?: string;
  category?: string;
  tags?: string[];
  unit_id?: string;
  row?: number | null;
  col?: number | null;
  mrp_inr?: number | null;
  find_time_sec?: number | null;
  status?: ItemStatus;
  notes?: string;
  verifyNow?: boolean;
}

export function updateItem(
  items: readonly MedicineItem[],
  itemId: string,
  patch: UpdateItemInput,
): { items: MedicineItem[]; updated: MedicineItem } {
  const idx = items.findIndex((i) => i.item_id === itemId);
  if (idx === -1) throw new MutationError(`Medicine "${itemId}" not found`, 404);

  const cur = items[idx];

  const brand_name =
    patch.brand_name !== undefined ? patch.brand_name.trim() : cur.brand_name;
  if (!brand_name) throw new MutationError('brand_name cannot be empty');

  const locationTouched =
    patch.unit_id !== undefined || patch.row !== undefined || patch.col !== undefined;
  const loc = locationTouched
    ? validateCoord(
        patch.unit_id ?? cur.unit_id,
        patch.row !== undefined ? patch.row : cur.row,
        patch.col !== undefined ? patch.col : cur.col,
      )
    : { unit_id: cur.unit_id, row: cur.row, col: cur.col };

  let mrp_inr = cur.mrp_inr;
  if (patch.mrp_inr !== undefined) {
    if (patch.mrp_inr === null) {
      mrp_inr = null;
    } else {
      const n = Number(patch.mrp_inr);
      if (!Number.isFinite(n) || n < 0) throw new MutationError('Invalid mrp_inr');
      mrp_inr = Math.round(n * 100) / 100;
    }
  }

  let find_time_sec = cur.find_time_sec;
  if (patch.find_time_sec !== undefined) {
    if (patch.find_time_sec === null) {
      find_time_sec = null;
    } else {
      const n = Number(patch.find_time_sec);
      if (!Number.isFinite(n) || n < 0) throw new MutationError('Invalid find_time_sec');
      find_time_sec = Math.round(n * 10) / 10;
    }
  }

  let status: ItemStatus = cur.status;
  if (patch.status !== undefined) {
    if (!ITEM_STATUSES.includes(patch.status)) {
      throw new MutationError(`Invalid status "${String(patch.status)}"`);
    }
    status = patch.status;
  } else if (loc.unit_id === UNASSIGNED_UNIT) {
    status = 'UNASSIGNED';
  } else if (locationTouched || patch.verifyNow) {
    status = 'OK';
  }

  const last_verified =
    patch.verifyNow || (locationTouched && loc.unit_id !== UNASSIGNED_UNIT)
      ? todayIso()
      : cur.last_verified;

  const updated: MedicineItem = {
    ...cur,
    brand_name,
    salt_compound:
      patch.salt_compound !== undefined ? patch.salt_compound.trim() : cur.salt_compound,
    strength_form:
      patch.strength_form !== undefined ? patch.strength_form.trim() : cur.strength_form,
    category: patch.category !== undefined ? patch.category.trim() : cur.category,
    tags:
      patch.tags !== undefined
        ? patch.tags.map((t) => String(t).trim()).filter(Boolean)
        : cur.tags,
    unit_id: loc.unit_id,
    row: loc.row,
    col: loc.col,
    mrp_inr,
    find_time_sec,
    status,
    last_verified,
    notes: patch.notes !== undefined ? patch.notes.trim() : cur.notes,
  };

  const next = [...items];
  next[idx] = updated;
  return { items: next, updated };
}

export function moveItemsToCell(
  items: readonly MedicineItem[],
  itemIds: readonly string[],
  target: { unit_id: string; row: number | null; col: number | null },
): { items: MedicineItem[]; moved: MedicineItem[] } {
  if (!Array.isArray(itemIds) || itemIds.length === 0) {
    throw new MutationError('Provide at least one item_id to move');
  }
  const loc = validateCoord(target.unit_id, target.row, target.col);
  const idSet = new Set(itemIds.map((id) => id.trim()).filter(Boolean));
  const today = todayIso();

  const moved: MedicineItem[] = [];
  const next = items.map((item) => {
    if (!idSet.has(item.item_id)) return item;
    const updated: MedicineItem = {
      ...item,
      unit_id: loc.unit_id,
      row: loc.row,
      col: loc.col,
      status: loc.unit_id === UNASSIGNED_UNIT ? 'UNASSIGNED' : 'OK',
      last_verified: loc.unit_id === UNASSIGNED_UNIT ? item.last_verified : today,
    };
    moved.push(updated);
    return updated;
  });

  if (moved.length === 0) {
    throw new MutationError('None of the requested item_ids were found', 404);
  }
  return { items: next, moved };
}

export interface ContainerRef {
  unit_id: string;
  row: number;
  col: number;
}

export function swapContainers(
  items: readonly MedicineItem[],
  a: ContainerRef,
  b: ContainerRef,
): { items: MedicineItem[]; swappedCountA: number; swappedCountB: number; summary: string } {
  const locA = validateCoord(a.unit_id, a.row, a.col);
  const locB = validateCoord(b.unit_id, b.row, b.col);
  if (locA.unit_id === UNASSIGNED_UNIT || locB.unit_id === UNASSIGNED_UNIT) {
    throw new MutationError('Cannot swap UNASSIGNED items; both containers must be mapped');
  }
  if (
    locA.unit_id === locB.unit_id &&
    locA.row === locB.row &&
    locA.col === locB.col
  ) {
    throw new MutationError('Source and target containers are identical');
  }

  let swappedCountA = 0;
  let swappedCountB = 0;
  const today = todayIso();

  const next = items.map((item) => {
    if (
      item.unit_id === locA.unit_id &&
      item.row === locA.row &&
      item.col === locA.col
    ) {
      swappedCountA++;
      return {
        ...item,
        unit_id: locB.unit_id,
        row: locB.row,
        col: locB.col,
        status: 'OK' as ItemStatus,
        last_verified: today,
      };
    }
    if (
      item.unit_id === locB.unit_id &&
      item.row === locB.row &&
      item.col === locB.col
    ) {
      swappedCountB++;
      return {
        ...item,
        unit_id: locA.unit_id,
        row: locA.row,
        col: locA.col,
        status: 'OK' as ItemStatus,
        last_verified: today,
      };
    }
    return item;
  });

  if (swappedCountA === 0 && swappedCountB === 0) {
    throw new MutationError('Both containers are empty; nothing to swap');
  }

  const codeA = formatLocationCode(locA.unit_id, locA.row!, locA.col!);
  const codeB = formatLocationCode(locB.unit_id, locB.row!, locB.col!);
  return {
    items: next,
    swappedCountA,
    swappedCountB,
    summary: `Swapped ${codeA} (${swappedCountA}) ↔ ${codeB} (${swappedCountB})`,
  };
}

export interface ShiftRowInput {
  unit_id: string;
  row: number;
  fromCol: number;
  /** 'promote': moves fromCol -> toCol (default 1) and ripples columns between them right by +1.
   *  'insert_gap': shifts all items with col >= fromCol right by +1 to open space. */
  mode?: 'promote' | 'insert_gap';
  toCol?: number;
}

export function shiftRowColumns(
  items: readonly MedicineItem[],
  input: ShiftRowInput,
  layout: readonly UnitLayout[],
): { items: MedicineItem[]; affectedCount: number; summary: string } {
  const unit = input.unit_id.trim().toUpperCase();
  const mode = input.mode ?? 'promote';
  const row = input.row;
  const fromCol = input.fromCol;

  validateCoord(unit, row, fromCol);

  const unitDef = layout.find((u) => u.unit_id === unit);
  const currentMaxCol = Math.max(
    unitDef?.row_widths[row - 1] ?? 0,
    ...items
      .filter((i) => i.unit_id === unit && i.row === row && i.col !== null)
      .map((i) => i.col!),
  );

  const today = todayIso();
  let affectedCount = 0;

  if (mode === 'insert_gap') {
    if (currentMaxCol + 1 > MAX_GRID_INDEX) {
      throw new MutationError(`Row cannot expand past MAX_GRID_INDEX (${MAX_GRID_INDEX})`);
    }
    const next = items.map((item) => {
      if (item.unit_id === unit && item.row === row && item.col !== null && item.col >= fromCol) {
        affectedCount++;
        return { ...item, col: item.col + 1, last_verified: today };
      }
      return item;
    });
    if (affectedCount === 0) {
      throw new MutationError(`No items at or after ${unit} · R${row} · C${fromCol} to shift`);
    }
    return {
      items: next,
      affectedCount,
      summary: `Inserted gap at ${unit} · R${row} · C${fromCol} (shifted ${affectedCount} item(s) right)`,
    };
  }

  // Default: 'promote' (e.g. Col K -> Col 1, rippling Col 1..K-1 right by +1)
  const toCol = input.toCol ?? 1;
  validateCoord(unit, row, toCol);
  if (fromCol === toCol) {
    throw new MutationError('fromCol and toCol must be different');
  }

  const next = items.map((item) => {
    if (item.unit_id !== unit || item.row !== row || item.col === null) return item;

    if (item.col === fromCol) {
      affectedCount++;
      return { ...item, col: toCol, status: 'OK' as ItemStatus, last_verified: today };
    }
    if (toCol < fromCol && item.col >= toCol && item.col < fromCol) {
      affectedCount++;
      return { ...item, col: item.col + 1, last_verified: today };
    }
    if (toCol > fromCol && item.col > fromCol && item.col <= toCol) {
      affectedCount++;
      return { ...item, col: item.col - 1, last_verified: today };
    }
    return item;
  });

  if (affectedCount === 0) {
    throw new MutationError(`No items found in ${unit} · R${row} across C${fromCol}..C${toCol}`);
  }

  return {
    items: next,
    affectedCount,
    summary: `Shifted ${unit} · R${row} · C${fromCol} → C${toCol} (${affectedCount} item(s) updated)`,
  };
}

const HEADER_ALIASES: Record<string, string> = {
  name: 'brand_name',
  medicine_name: 'brand_name',
  drug_name: 'brand_name',
  composition: 'salt_compound',
  salt: 'salt_compound',
  mrp: 'mrp_inr',
  price: 'mrp_inr',
  id: 'item_id',
};

export interface ImportResult {
  items: MedicineItem[];
  added: MedicineItem[];
  skippedDuplicates: number;
  warnings: Warning[];
}

/**
 * Imports a Distributor CSV (supporting aliases like `name,composition`)
 * into the Lazy-Slotting Inbox (`UNASSIGNED`) unless valid rack coords are present.
 */
export function importDistributorCsv(
  existing: readonly MedicineItem[],
  csvText: string,
  skipDuplicates = true,
): ImportResult {
  const records = parseCsv(csvText);
  if (records.length < 2) {
    throw new MutationError('CSV must contain a header row and at least one medicine row');
  }

  const normalizedHeader = records[0].fields.map((h) => {
    const key = h.trim().toLowerCase().replace(/[\s-]+/g, '_');
    return HEADER_ALIASES[key] ?? key;
  });

  const rewritten = serializeCsv([normalizedHeader, ...records.slice(1).map((r) => r.fields)]);
  const parsed = loadItemsFromCsv(rewritten);

  const existingKeys = new Set(
    existing.map((i) => `${i.brand_name.toLowerCase()}|${i.strength_form.toLowerCase()}`),
  );
  const usedIds = new Set(existing.map((i) => i.item_id));
  let idCounter = existing.length + 1;

  const allocId = (preferred: string): string => {
    if (preferred && !usedIds.has(preferred)) {
      usedIds.add(preferred);
      return preferred;
    }
    let next = `MED-${String(idCounter).padStart(3, '0')}`;
    while (usedIds.has(next)) {
      idCounter++;
      next = `MED-${String(idCounter).padStart(3, '0')}`;
    }
    usedIds.add(next);
    idCounter++;
    return next;
  };

  const added: MedicineItem[] = [];
  let skippedDuplicates = 0;

  for (const incoming of parsed.items) {
    const key = `${incoming.brand_name.toLowerCase()}|${incoming.strength_form.toLowerCase()}`;
    if (skipDuplicates && existingKeys.has(key)) {
      skippedDuplicates++;
      continue;
    }
    existingKeys.add(key);

    // Imported rows without coordinates go straight to Lazy-Slotting Inbox
    const isUnmapped = incoming.unit_id === UNASSIGNED_UNIT || incoming.row === null || incoming.col === null;
    added.push({
      ...incoming,
      item_id: allocId(incoming.item_id),
      unit_id: isUnmapped ? UNASSIGNED_UNIT : incoming.unit_id,
      row: isUnmapped ? null : incoming.row,
      col: isUnmapped ? null : incoming.col,
      status: isUnmapped ? 'UNASSIGNED' : incoming.status,
    });
  }

  return {
    items: [...existing, ...added],
    added,
    skippedDuplicates,
    warnings: parsed.warnings,
  };
}