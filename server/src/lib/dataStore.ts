import fs from 'fs';
import path from 'path';
import { THRESHOLDS } from '../config/thresholds';
import { serializeCsv } from './csvCodec';
import {
  CSV_COLUMNS,
  LoadResult,
  MedicineItem,
  UNASSIGNED_UNIT,
  UnitLayout,
  Warning,
} from './types';
import { MAX_GRID_INDEX, loadItemsFromCsv } from './validator';

export const DEFAULT_DATA_DIR = path.resolve(__dirname, '..', '..', '..', 'data');

export interface LoadedData extends LoadResult {
  layout: UnitLayout[];
}

function writeFileAtomic(target: string, data: string | Buffer): void {
  const tmp = `${target}.tmp`;
  const fd = fs.openSync(tmp, 'w');
  try {
    fs.writeFileSync(fd, data);
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  fs.renameSync(tmp, target);
}

export function itemsToCsv(items: readonly MedicineItem[]): string {
  const rows: string[][] = [[...CSV_COLUMNS]];
  for (const it of items) {
    rows.push([
      it.item_id,
      it.brand_name,
      it.salt_compound,
      it.strength_form,
      it.category,
      it.tags.join(', '),
      it.unit_id,
      it.row === null ? '' : String(it.row),
      it.col === null ? '' : String(it.col),
      it.mrp_inr === null ? '' : String(it.mrp_inr),
      it.find_time_sec === null ? '' : String(it.find_time_sec),
      it.observed_at,
      it.last_verified ?? '',
      it.status,
      it.notes,
    ]);
  }
  return serializeCsv(rows);
}

export function parseLayoutJson(raw: string | null): { units: UnitLayout[]; warnings: Warning[] } {
  const warnings: Warning[] = [];
  if (raw === null || raw.trim() === '') return { units: [], warnings };

  const invalid = (message: string): { units: UnitLayout[]; warnings: Warning[] } => {
    warnings.push({ code: 'LAYOUT_INVALID', severity: 'warn', line: 0, message });
    return { units: [], warnings };
  };

  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return invalid('layout.json is not valid JSON; layout will be inferred from data.csv');
  }

  const unitsRaw = (data as { units?: unknown } | null)?.units;
  if (!Array.isArray(unitsRaw)) {
    return invalid('layout.json has no "units" array; layout will be inferred');
  }

  const units: UnitLayout[] = [];
  const seen = new Set<string>();

  unitsRaw.forEach((u: unknown, i: number) => {
    const o = (u ?? {}) as Record<string, unknown>;
    const id = typeof o.unit_id === 'string' ? o.unit_id.trim().toUpperCase() : '';
    if (id === '' || id === UNASSIGNED_UNIT) {
      warnings.push({
        code: 'LAYOUT_INVALID',
        severity: 'warn',
        line: 0,
        message: `layout.json unit #${i + 1} skipped: missing or reserved unit_id`,
      });
      return;
    }
    if (seen.has(id)) {
      warnings.push({
        code: 'LAYOUT_INVALID',
        severity: 'warn',
        line: 0,
        message: `layout.json unit "${id}" is duplicated; later copy skipped`,
      });
      return;
    }
    seen.add(id);

    let widths: number[] = [];
    let fixed = false;
    if (Array.isArray(o.row_widths)) {
      widths = o.row_widths.map((w: unknown) => {
        if (typeof w === 'number' && Number.isInteger(w) && w >= 1 && w <= MAX_GRID_INDEX) return w;
        fixed = true;
        return 1;
      });
      if (widths.length > MAX_GRID_INDEX) {
        widths = widths.slice(0, MAX_GRID_INDEX);
        fixed = true;
      }
    } else {
      fixed = true;
    }

    if (fixed) {
      warnings.push({
        code: 'LAYOUT_INVALID',
        severity: 'warn',
        line: 0,
        message: `layout.json unit "${id}" had invalid row_widths; invalid entries replaced with 1`,
      });
    }

    units.push({
      unit_id: id,
      name: typeof o.name === 'string' && o.name.trim() !== '' ? o.name.trim() : id,
      walk_order:
        typeof o.walk_order === 'number' && Number.isFinite(o.walk_order)
          ? o.walk_order
          : (i + 1) * 100,
      anchor_rule: typeof o.anchor_rule === 'string' ? o.anchor_rule : '',
      row_widths: widths,
    });
  });

  return { units, warnings };
}

export function inferLayout(
  base: readonly UnitLayout[],
  items: readonly MedicineItem[],
): { units: UnitLayout[]; warnings: Warning[] } {
  const units: UnitLayout[] = base.map((u) => ({ ...u, row_widths: [...u.row_widths] }));
  const before = new Map<string, number[]>(units.map((u) => [u.unit_id, [...u.row_widths]]));
  const byId = new Map<string, UnitLayout>(units.map((u) => [u.unit_id, u]));
  const created = new Set<string>();

  for (const it of items) {
    if (it.unit_id === UNASSIGNED_UNIT || it.row === null || it.col === null) continue;
    let unit = byId.get(it.unit_id);
    if (!unit) {
      const maxWalk = units.reduce((m, u) => Math.max(m, u.walk_order), 0);
      unit = {
        unit_id: it.unit_id,
        name: it.unit_id,
        walk_order: maxWalk + 100,
        anchor_rule: 'Auto-inferred from data.csv',
        row_widths: [],
      };
      units.push(unit);
      byId.set(unit.unit_id, unit);
      created.add(unit.unit_id);
    }
    while (unit.row_widths.length < it.row) unit.row_widths.push(1);
    if (unit.row_widths[it.row - 1] < it.col) unit.row_widths[it.row - 1] = it.col;
  }

  const warnings: Warning[] = [];
  for (const u of units) {
    if (created.has(u.unit_id)) {
      warnings.push({
        code: 'UNIT_INFERRED',
        severity: 'info',
        line: 0,
        message: `Unit "${u.unit_id}" is not in layout.json; created in memory from data.csv`,
      });
      continue;
    }
    const prev = before.get(u.unit_id) ?? [];
    const changes: string[] = [];
    u.row_widths.forEach((w, r) => {
      if (r >= prev.length) changes.push(`row ${r + 1} added (${w} cols)`);
      else if (w > prev[r]) changes.push(`row ${r + 1} widened ${prev[r]}→${w} cols`);
    });
    if (changes.length > 0) {
      warnings.push({
        code: 'LAYOUT_EXPANDED',
        severity: 'info',
        line: 0,
        message: `Unit "${u.unit_id}" expanded in memory to fit data.csv: ${changes.join(', ')}`,
      });
    }
  }

  return { units, warnings };
}

export class DataStore {
  constructor(readonly dataDir: string = DEFAULT_DATA_DIR) {}

  get csvPath(): string {
    return path.join(this.dataDir, 'data.csv');
  }

  get layoutPath(): string {
    return path.join(this.dataDir, 'layout.json');
  }

  get backupDir(): string {
    return path.join(this.dataDir, 'backups');
  }

  readCsvText(): string | null {
    return fs.existsSync(this.csvPath) ? fs.readFileSync(this.csvPath, 'utf8') : null;
  }

  load(): LoadedData {
    const warnings: Warning[] = [];
    let csv: LoadResult = { items: [], warnings: [], totalRows: 0, quarantined: 0 };

    try {
      const text = this.readCsvText();
      if (text === null) {
        warnings.push({
          code: 'FILE_MISSING',
          severity: 'warn',
          line: 0,
          message: `data.csv not found at ${this.csvPath}`,
        });
      } else {
        csv = loadItemsFromCsv(text);
      }
    } catch (err) {
      warnings.push({
        code: 'FILE_UNREADABLE',
        severity: 'error',
        line: 0,
        message: `data.csv could not be read: ${String(err)}`,
      });
    }

    let layoutRaw: string | null = null;
    try {
      layoutRaw = fs.existsSync(this.layoutPath) ? fs.readFileSync(this.layoutPath, 'utf8') : null;
    } catch (err) {
      warnings.push({
        code: 'LAYOUT_INVALID',
        severity: 'warn',
        line: 0,
        message: `layout.json could not be read: ${String(err)}`,
      });
    }

    const parsed = parseLayoutJson(layoutRaw);
    const inferred = inferLayout(parsed.units, csv.items);
    return {
      items: csv.items,
      totalRows: csv.totalRows,
      quarantined: csv.quarantined,
      layout: inferred.units,
      warnings: [...warnings, ...csv.warnings, ...parsed.warnings, ...inferred.warnings],
    };
  }

  listBackups(): string[] {
    if (!fs.existsSync(this.backupDir)) return [];
    return fs
      .readdirSync(this.backupDir)
      .filter((n) => /^data_.+\.csv$/.test(n))
      .sort();
  }

  snapshot(): string | null {
    if (!fs.existsSync(this.csvPath)) return null;
    fs.mkdirSync(this.backupDir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    let name = `data_${stamp}.csv`;
    let n = 0;
    while (fs.existsSync(path.join(this.backupDir, name))) {
      n++;
      name = `data_${stamp}_${n}.csv`;
    }
    fs.copyFileSync(this.csvPath, path.join(this.backupDir, name));
    const all = this.listBackups();
    const excess = all.length - Math.max(1, THRESHOLDS.UNDO_HISTORY_LIMIT);
    for (let i = 0; i < excess; i++) fs.unlinkSync(path.join(this.backupDir, all[i]));
    return name;
  }

  writeCsvText(text: string): void {
    fs.mkdirSync(this.dataDir, { recursive: true });
    writeFileAtomic(this.csvPath, text);
  }

  writeItems(items: readonly MedicineItem[]): { snapshot: string | null } {
    const snapshot = this.snapshot();
    this.writeCsvText(itemsToCsv(items));
    return { snapshot };
  }
  
  writeLayout(units: readonly UnitLayout[]): void {
    fs.mkdirSync(this.dataDir, { recursive: true });
    writeFileAtomic(this.layoutPath, JSON.stringify({ units }, null, 2) + '\n');
  }
  
  writeOrgConfig(config: Record<string, unknown>): void {
    fs.mkdirSync(this.dataDir, { recursive: true });
    writeFileAtomic(
      path.join(this.dataDir, 'org_config.json'),
      JSON.stringify(config, null, 2) + '\n',
    );
  }
  
  restoreLatestBackup(): string | null {
    const all = this.listBackups();
    if (all.length === 0) return null;
    const latest = all[all.length - 1];
    const file = path.join(this.backupDir, latest);
    const bytes = fs.readFileSync(file);
    fs.mkdirSync(this.dataDir, { recursive: true });
    writeFileAtomic(this.csvPath, bytes);
    fs.unlinkSync(file);
    return latest;
  }
}