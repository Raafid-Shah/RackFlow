import { CsvRecord, parseCsv } from './csvCodec';
import {
  ITEM_STATUSES,
  ItemStatus,
  LoadResult,
  MedicineItem,
  UNASSIGNED_UNIT,
  Warning,
  WarningCode,
  WarningSeverity,
} from './types';

export const MAX_GRID_INDEX = 200;

interface Parsed<T> {
  ok: boolean;
  value: T | null;
}

function parseGridIndex(raw: string): Parsed<number> {
  if (raw === '') return { ok: true, value: null };
  if (!/^\+?\d+(\.0+)?$/.test(raw)) return { ok: false, value: null };
  const n = Number(raw);
  if (!Number.isSafeInteger(n) || n < 1 || n > MAX_GRID_INDEX) return { ok: false, value: null };
  return { ok: true, value: n };
}

function parseAmount(raw: string): Parsed<number> {
  if (raw === '') return { ok: true, value: null };
  const cleaned = raw.replace(/^(?:₹|rs\.?|inr)\s*/i, '').replace(/,/g, '');
  if (!/^(?:\d+(?:\.\d*)?|\.\d+)$/.test(cleaned)) return { ok: false, value: null };
  const n = Number(cleaned);
  if (!Number.isFinite(n)) return { ok: false, value: null };
  return { ok: true, value: n };
}

function parseIsoDate(raw: string): Parsed<string> {
  if (raw === '') return { ok: true, value: null };
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
  if (!m) return { ok: false, value: null };
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) {
    return { ok: false, value: null };
  }
  return { ok: true, value: raw };
}

function normalizeHeader(h: string): string {
  return h.trim().toLowerCase().replace(/[\s-]+/g, '_');
}

function pad3(n: number): string {
  return String(n).padStart(3, '0');
}

interface Draft {
  item: MedicineItem;
  explicitId: string;
  line: number;
}

export function loadItemsFromCsv(text: string): LoadResult {
  const warnings: Warning[] = [];
  const empty: LoadResult = { items: [], warnings, totalRows: 0, quarantined: 0 };

  const warn = (
    code: WarningCode,
    severity: WarningSeverity,
    line: number,
    message: string,
    extra: Partial<Pick<Warning, 'item_id' | 'field' | 'rawValue'>> = {},
  ): void => {
    warnings.push({ code, severity, line, message, ...extra });
  };

  if (typeof text !== 'string' || text.trim() === '') return empty;

  let records: CsvRecord[];
  try {
    records = parseCsv(text);
  } catch (err) {
    warn('ROW_PARSE_ERROR', 'error', 0, `CSV could not be parsed: ${String(err)}`);
    return empty;
  }

  if (records.length === 0) return empty;
  const header = records[0];
  const rows = records.slice(1);

  const index = new Map<string, number>();
  header.fields.forEach((h, i) => {
    const key = normalizeHeader(h);
    if (key !== '' && !index.has(key)) index.set(key, i);
  });

  if (!index.has('brand_name')) {
    warn(
      'HEADER_MISSING_BRAND',
      'error',
      header.line,
      'Header has no "brand_name" column; no rows can be loaded',
      { field: 'brand_name' },
    );
    return { items: [], warnings, totalRows: rows.length, quarantined: rows.length };
  }

  const drafts: Draft[] = [];
  let totalRows = 0;
  let quarantined = 0;

  for (const rec of rows) {
    if (rec.fields.every((f) => f.trim() === '')) continue;
    totalRows++;

    try {
      const get = (key: string): string => {
        const i = index.get(key);
        if (i === undefined || i >= rec.fields.length) return '';
        return rec.fields[i].trim();
      };

      const line = rec.line;
      const explicitId = get('item_id') || get('id');
      const idCtx = explicitId ? { item_id: explicitId } : {};

      if (rec.fields.length > header.fields.length) {
        const extra = rec.fields.slice(header.fields.length);
        if (extra.some((f) => f.trim() !== '')) {
          warn(
            'EXTRA_COLUMNS',
            'warn',
            line,
            `Row has ${rec.fields.length} fields but header has ${header.fields.length}; extra values ignored`,
            idCtx,
          );
        }
      }

      const brand = get('brand_name');
      if (brand === '') {
        quarantined++;
        warn('MISSING_BRAND', 'error', line, 'Row quarantined: brand_name is empty', {
          ...idCtx,
          field: 'brand_name',
        });
        continue;
      }

      const unitRaw = get('unit_id').toUpperCase();
      const unit_id = unitRaw === '' ? UNASSIGNED_UNIT : unitRaw;
      const rowRaw = get('row');
      const colRaw = get('col');
      const rowP = parseGridIndex(rowRaw);
      const colP = parseGridIndex(colRaw);
      let row: number | null = null;
      let col: number | null = null;

      if (rowP.ok && colP.ok) {
        if ((rowP.value === null) !== (colP.value === null)) {
          warn(
            'PARTIAL_LOCATION',
            'warn',
            line,
            'Only one of row/col is set; location treated as unmapped',
            { ...idCtx, field: 'row/col' },
          );
        } else {
          row = rowP.value;
          col = colP.value;
        }
      } else {
        if (!rowP.ok) {
          warn(
            'BAD_ROW',
            'warn',
            line,
            `Invalid row "${rowRaw}" (must be a whole number 1-${MAX_GRID_INDEX}); location treated as unmapped`,
            { ...idCtx, field: 'row', rawValue: rowRaw },
          );
        }
        if (!colP.ok) {
          warn(
            'BAD_COL',
            'warn',
            line,
            `Invalid col "${colRaw}" (must be a whole number 1-${MAX_GRID_INDEX}); location treated as unmapped`,
            { ...idCtx, field: 'col', rawValue: colRaw },
          );
        }
      }

      const mrpRaw = get('mrp_inr');
      const mrpP = parseAmount(mrpRaw);
      if (!mrpP.ok) {
        warn('BAD_MRP', 'warn', line, `Invalid mrp_inr "${mrpRaw}"; stored as empty`, {
          ...idCtx,
          field: 'mrp_inr',
          rawValue: mrpRaw,
        });
      }

      const findRaw = get('find_time_sec');
      const findP = parseAmount(findRaw);
      if (!findP.ok) {
        warn('BAD_FIND_TIME', 'warn', line, `Invalid find_time_sec "${findRaw}"; stored as empty`, {
          ...idCtx,
          field: 'find_time_sec',
          rawValue: findRaw,
        });
      }

      const verifiedRaw = get('last_verified');
      const verifiedP = parseIsoDate(verifiedRaw);
      if (!verifiedP.ok) {
        warn(
          'BAD_LAST_VERIFIED',
          'warn',
          line,
          `Invalid last_verified "${verifiedRaw}" (expected YYYY-MM-DD); stored as empty`,
          { ...idCtx, field: 'last_verified', rawValue: verifiedRaw },
        );
      }

      const observed = get('observed_at');
      if (observed !== '' && !/^(?:[01]?\d|2[0-3]):[0-5]\d$/.test(observed)) {
        warn(
          'BAD_OBSERVED_AT',
          'warn',
          line,
          `observed_at "${observed}" is not HH:MM (kept as written)`,
          { ...idCtx, field: 'observed_at', rawValue: observed },
        );
      }

      const statusRaw = get('status').toUpperCase().replace(/\s+/g, '_');
      const defaultStatus: ItemStatus = unit_id === UNASSIGNED_UNIT ? 'UNASSIGNED' : 'OK';
      let status: ItemStatus = defaultStatus;
      if (statusRaw !== '') {
        const match = ITEM_STATUSES.find((s) => s === statusRaw);
        if (match) {
          status = match;
        } else {
          warn(
            'BAD_STATUS',
            'warn',
            line,
            `Unknown status "${get('status')}"; defaulted to ${defaultStatus}`,
            { ...idCtx, field: 'status', rawValue: get('status') },
          );
        }
      }

      const tags = get('tags')
        .split(/[,;|]/)
        .map((t) => t.trim())
        .filter((t) => t !== '');

      drafts.push({
        explicitId,
        line,
        item: {
          item_id: explicitId,
          brand_name: brand,
          salt_compound: get('salt_compound'),
          strength_form: get('strength_form'),
          category: get('category'),
          tags,
          unit_id,
          row,
          col,
          mrp_inr: mrpP.value,
          find_time_sec: findP.value,
          observed_at: observed,
          last_verified: verifiedP.value,
          status,
          notes: get('notes'),
        },
      });
    } catch (err) {
      quarantined++;
      warn(
        'ROW_PARSE_ERROR',
        'error',
        rec.line,
        `Row quarantined after unexpected error: ${String(err)}`,
      );
    }
  }

  const used = new Set<string>(drafts.map((d) => d.explicitId).filter((id) => id !== ''));
  const seen = new Set<string>();
  let counter = 1;
  const nextId = (): string => {
    let id = `MED-${pad3(counter)}`;
    while (used.has(id)) {
      counter++;
      id = `MED-${pad3(counter)}`;
    }
    used.add(id);
    counter++;
    return id;
  };

  const items: MedicineItem[] = [];
  for (const d of drafts) {
    if (d.explicitId === '') {
      d.item.item_id = nextId();
    } else if (seen.has(d.explicitId)) {
      const fresh = nextId();
      warn(
        'DUPLICATE_ID',
        'warn',
        d.line,
        `Duplicate item_id "${d.explicitId}"; reassigned as ${fresh}`,
        { item_id: fresh, field: 'item_id', rawValue: d.explicitId },
      );
      d.item.item_id = fresh;
    } else {
      seen.add(d.explicitId);
    }
    items.push(d.item);
  }

  warnings.sort((a, b) => a.line - b.line);
  return { items, warnings, totalRows, quarantined };
}