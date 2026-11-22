import express, { Express, NextFunction, Request, Response } from 'express';
import fs from 'node:fs';
import os from 'os';
import path from 'node:path';
import { THRESHOLDS } from './config/thresholds';
import { computeAnalytics, isSlowFind, isStaleVerified } from './lib/analytics';
import { AuditLog } from './lib/auditLog';
import {
  createModeratorGuard,
  loadOrgConfig,
  readActorName,
  toPublicOrgConfig,
  verifyModeratorPin,
} from './lib/authAdapter';
import { DataStore, DEFAULT_DATA_DIR, LoadedData } from './lib/dataStore';
import {
  createItem,
  flagItemMissing,
  importDistributorCsv,
  moveItemsToCell,
  MutationError,
  shiftRowColumns,
  swapContainers,
  updateItem,
  validateLayoutUpdate,
} from './lib/mutations';
import { buildSearchIndex, SearchIndex, searchItems } from './lib/searchEngine';
import {
  buildContainerIndex,
  buildPickRoute,
  ContainerIndex,
  describeLocation,
  isMapped,
} from './lib/spatialCues';
import { PickLine } from './lib/types';
import {
  AuthManager,
  hashPin,
  validateNewPinStrength,
  verifyPinAgainstConfig,
} from './lib/auth';

export interface AppOptions {
  dataDir?: string;
  clientDistDir?: string;
}

interface CachedState {
  stamp: string;
  data: LoadedData;
  searchIndex: SearchIndex;
  containers: ContainerIndex;
}
interface RawOrgConfig {
  shopName?: string;
  staffPresets?: string[];
  moderatorPin?: string;
  moderatorPinHash?: string;
  pinHint?: string | null;
  [key: string]: unknown;
}

export function getLanUrls(port: number): string[] {
  const urls: string[] = [];
  const nets = os.networkInterfaces();
  for (const entries of Object.values(nets)) {
    for (const net of entries ?? []) {
      if (net.family === 'IPv4' && !net.internal) {
        urls.push(`http://${net.address}:${port}`);
      }
    }
  }
  return urls;
}

function fileMtime(filePath: string): number {
  try {
    return fs.statSync(filePath).mtimeMs;
  } catch {
    return 0;
  }
}

export function createApp(options: AppOptions = {}): Express {
  const dataDir = options.dataDir ?? DEFAULT_DATA_DIR;
  const clientDistDir =
    options.clientDistDir ??
    path.resolve(__dirname, '..', '..', 'client', 'dist', 'rackflow-client', 'browser');

  const store = new DataStore(dataDir);
  const audit = new AuditLog(dataDir);
  const requireModerator = (req: Request, res: Response, next: NextFunction): void => {
    const session = auth.validateToken(readBearerToken(req));
    if (!session) {
      res.status(401).json({ error: 'Moderator session required. Please unlock with your PIN.' });
      return;
    }
    next();
  };

  let cache: CachedState | null = null;

  const getState = (forceReload = false): CachedState => {
    const stamp = `${fileMtime(store.csvPath)}:${fileMtime(store.layoutPath)}`;
    if (!forceReload && cache && cache.stamp === stamp) return cache;
    const data = store.load();
    cache = {
      stamp,
      data,
      searchIndex: buildSearchIndex(data.items),
      containers: buildContainerIndex(data.items),
    };
    return cache;
  };

  const app = express();
  app.use(express.json({ limit: '5mb' }));

  // --- Public & Counter Endpoints ---

  app.get('/api/health', (_req: Request, res: Response) => {
    const state = getState();
    const mappedCount = state.data.items.filter(isMapped).length;
    res.json({
      ok: true,
      dataDir,
      thresholds: THRESHOLDS,
      stats: {
        totalItems: state.data.items.length,
        mappedCount,
        unassignedCount: state.data.items.length - mappedCount,
        quarantined: state.data.quarantined,
        warningCount: state.data.warnings.length,
      },
      backupCount: store.listBackups().length,
    });
  });

  app.get('/api/config', (_req: Request, res: Response) => {
    const raw = readRawOrgConfig();
    const usingDefaultPin = !raw.moderatorPinHash;
    res.json({
      shopName: raw.shopName ?? 'RackFlow Pharmacy',
      staffPresets: raw.staffPresets ?? ['Counter Staff'],
      usingDefaultPin,
      pinHint: usingDefaultPin ? (raw.pinHint ?? null) : null,
      thresholds: THRESHOLDS,
    });
  });

  app.post('/api/auth/verify', (req: Request, res: Response) => {
    const ip = readClientIp(req);
    const lock = auth.checkLockout(ip);
    if (lock.locked) {
      res.setHeader('Retry-After', String(lock.retryAfterSec));
      res.status(429).json({
        error: `Too many failed attempts. Try again in ${lock.retryAfterSec}s.`,
        retryAfterSec: lock.retryAfterSec,
      });
      return;
    }

    const pin = typeof req.body?.pin === 'string' ? req.body.pin : '';
    const raw = readRawOrgConfig();

    if (!verifyPinAgainstConfig(pin, raw)) {
      const fail = auth.recordFailure(ip);
      if (fail.locked) {
        res.setHeader('Retry-After', String(fail.retryAfterSec));
        res.status(429).json({
          error: `Too many failed attempts. Locked for ${Math.ceil(fail.retryAfterSec / 60)} min.`,
          retryAfterSec: fail.retryAfterSec,
        });
        return;
      }
      res.status(401).json({
        error: `Incorrect PIN. ${fail.remaining} attempt(s) remaining before lockout.`,
        remainingAttempts: fail.remaining,
      });
      return;
    }

    auth.clearFailures(ip);
    const session = auth.createSession(readActorName(req));
    res.json({
      ok: true,
      token: session.token,
      expiresAt: new Date(session.expiresAt).toISOString(),
      usingDefaultPin: !raw.moderatorPinHash,
    });
  });

  app.post('/api/auth/logout', (req: Request, res: Response) => {
    auth.revokeToken(readBearerToken(req));
    res.json({ ok: true });
  });

  app.post('/api/auth/change-pin', requireModerator, (req: Request, res: Response) => {
    const ip = readClientIp(req);
    const lock = auth.checkLockout(ip);
    if (lock.locked) {
      res.setHeader('Retry-After', String(lock.retryAfterSec));
      res.status(429).json({
        error: `Locked due to failed attempts. Try again in ${lock.retryAfterSec}s.`,
        retryAfterSec: lock.retryAfterSec,
      });
      return;
    }

    const currentPin = typeof req.body?.currentPin === 'string' ? req.body.currentPin : '';
    const newPin = typeof req.body?.newPin === 'string' ? req.body.newPin : '';
    const raw = readRawOrgConfig();

    if (!verifyPinAgainstConfig(currentPin, raw)) {
      const fail = auth.recordFailure(ip);
      res.status(fail.locked ? 429 : 401).json({
        error: fail.locked
          ? `Too many failed attempts. Try again in ${fail.retryAfterSec}s.`
          : `Current PIN is incorrect (${fail.remaining} attempt(s) left).`,
      });
      return;
    }

    const strengthError = validateNewPinStrength(newPin, currentPin);
    if (strengthError) {
      res.status(400).json({ error: strengthError });
      return;
    }

    auth.clearFailures(ip);

    const nextConfig: Record<string, unknown> = {
      ...raw,
      moderatorPinHash: hashPin(newPin),
      pinUpdatedAt: new Date().toISOString(),
    };
    delete nextConfig['moderatorPin'];
    delete nextConfig['pinHint'];

    store.writeOrgConfig(nextConfig);

    auth.revokeAllSessions();
    const freshSession = auth.createSession(readActorName(req));

    audit.append({
      actor: readActorName(req),
      role: 'moderator',
      action: 'CHANGE_PIN',
      summary: 'Rotated Moderator PIN (scrypt hash saved, all prior sessions revoked)',
    });

    res.json({
      ok: true,
      token: freshSession.token,
      expiresAt: new Date(freshSession.expiresAt).toISOString(),
    });
  });

  app.get('/api/inventory', (_req: Request, res: Response) => {
    const state = getState();
    res.json({
      items: state.data.items,
      layout: state.data.layout,
      warnings: state.data.warnings,
      totalRows: state.data.totalRows,
      quarantined: state.data.quarantined,
      backupCount: store.listBackups().length,
    });
  });
  app.get('/api/auth/session', (req: Request, res: Response) => {
    const session = auth.validateToken(readBearerToken(req));
    res.json({
      authenticated: session !== null,
      expiresAt: session ? new Date(session.expiresAt).toISOString() : null,
    });
  });

  app.get('/api/search', (req: Request, res: Response) => {
    const q = typeof req.query.q === 'string' ? req.query.q : '';
    const state = getState();
    const t0 = performance.now();
    const hits = searchItems(state.searchIndex, q);
    const elapsedMs = Math.round((performance.now() - t0) * 100) / 100;

    const results = hits.map((hit) => ({
      ...hit,
      cue: describeLocation(hit.item, state.containers, state.data.layout),
      isSlowFind: isSlowFind(hit.item.find_time_sec),
      isStale: isStaleVerified(hit.item.last_verified),
    }));

    res.json({ query: q, count: results.length, elapsedMs, results });
  });

  app.post('/api/route', (req: Request, res: Response) => {
    const rawLines = Array.isArray(req.body?.lines) ? (req.body.lines as PickLine[]) : [];
    const state = getState();
    const route = buildPickRoute(rawLines, state.data.items, state.data.layout);

    // Enrich each stop with spatial cues so mobile pickers see neighbor landmarks
    const enrichedGroups = route.groups.map((group) => ({
      ...group,
      stops: group.stops.map((stop) => ({
        ...stop,
        cue: describeLocation(stop.item, state.containers, state.data.layout),
        isSlowFind: isSlowFind(stop.item.find_time_sec),
      })),
    }));

    res.json({
      ...route,
      groups: enrichedGroups,
    });
  });

  app.get('/api/analytics', (_req: Request, res: Response) => {
    const state = getState();
    const report = computeAnalytics(state.data.items, state.data.layout);
    res.json({
      ...report,
      warnings: state.data.warnings,
      backupCount: store.listBackups().length,
    });
  });

  app.get('/api/audit', (req: Request, res: Response) => {
    const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 50));
    res.json({ entries: audit.readRecent(limit) });
  });

  // --- Staff Action (No Moderator PIN required: anyone can flag drift) ---

  app.post('/api/items/:id/flag', (req: Request, res: Response) => {
    const state = getState();
    const note = typeof req.body?.note === 'string' ? req.body.note : undefined;
    const { items, updated } = flagItemMissing(state.data.items, req.params.id, note);
    const { snapshot } = store.writeItems(items);
    const next = getState(true);

    audit.append({
      actor: readActorName(req),
      role: 'staff',
      action: 'FLAG_MISSING',
      summary: `Flagged "${updated.brand_name}" (${updated.item_id}) as Not Here`,
      snapshot,
      meta: { item_id: updated.item_id, note: note ?? '' },
    });

    res.json({
      item: updated,
      backupCount: store.listBackups().length,
      layout: next.data.layout,
    });
  });

  const auth = new AuthManager();

  const readRawOrgConfig = (): RawOrgConfig => {
    const configPath = path.join(dataDir, 'org_config.json');
    if (!fs.existsSync(configPath)) return {};
    try {
      return JSON.parse(fs.readFileSync(configPath, 'utf8')) as RawOrgConfig;
    } catch {
      return {};
    }
  };

  function readClientIp(req: Request): string {
    return req.ip || req.socket.remoteAddress || 'unknown';
  }

  function readBearerToken(req: Request): string | undefined {
    const header = req.header('authorization') ?? '';
    if (!header.toLowerCase().startsWith('bearer ')) return undefined;
    const token = header.slice(7).trim();
    return token.length > 0 ? token : undefined;
  }

  // --- Moderator Endpoints (PIN-gated) ---

  app.post('/api/items', requireModerator, (req: Request, res: Response) => {
    const state = getState();
    const { items, created } = createItem(state.data.items, req.body ?? {});
    const { snapshot } = store.writeItems(items);
    const next = getState(true);

    audit.append({
      actor: readActorName(req),
      role: 'moderator',
      action: 'CREATE_ITEM',
      summary: `Added "${created.brand_name}" (${created.item_id}) at ${created.unit_id}`,
      snapshot,
      meta: { item_id: created.item_id },
    });

    res.status(201).json({
      item: created,
      layout: next.data.layout,
      backupCount: store.listBackups().length,
    });
  });

  app.patch('/api/items/:id', requireModerator, (req: Request, res: Response) => {
    const state = getState();
    const { items, updated } = updateItem(state.data.items, req.params.id, req.body ?? {});
    const { snapshot } = store.writeItems(items);
    const next = getState(true);

    audit.append({
      actor: readActorName(req),
      role: 'moderator',
      action: req.body?.verifyNow ? 'VERIFY_ITEM' : 'UPDATE_ITEM',
      summary: `Updated "${updated.brand_name}" (${updated.item_id})`,
      snapshot,
      meta: { item_id: updated.item_id },
    });

    res.json({
      item: updated,
      layout: next.data.layout,
      backupCount: store.listBackups().length,
    });
  });

  app.post('/api/mutations/move', requireModerator, (req: Request, res: Response) => {
    const state = getState();
    const ids: string[] = Array.isArray(req.body?.item_ids)
      ? req.body.item_ids
      : typeof req.body?.item_id === 'string'
        ? [req.body.item_id]
        : [];
    const target = {
      unit_id: String(req.body?.unit_id ?? ''),
      row: req.body?.row === undefined ? null : req.body.row,
      col: req.body?.col === undefined ? null : req.body.col,
    };

    const { items, moved } = moveItemsToCell(state.data.items, ids, target);
    const { snapshot } = store.writeItems(items);
    const next = getState(true);

    audit.append({
      actor: readActorName(req),
      role: 'moderator',
      action: 'MOVE_ITEM',
      summary: `Moved ${moved.length} item(s) to ${target.unit_id}${target.row ? ` · R${target.row} · C${target.col}` : ''}`,
      snapshot,
      meta: { item_ids: moved.map((m) => m.item_id), target },
    });

    res.json({
      moved,
      layout: next.data.layout,
      backupCount: store.listBackups().length,
    });
  });

  app.post('/api/mutations/swap', requireModerator, (req: Request, res: Response) => {
    const state = getState();
    const { items, swappedCountA, swappedCountB, summary } = swapContainers(
      state.data.items,
      req.body?.from,
      req.body?.to,
    );
    const { snapshot } = store.writeItems(items);
    const next = getState(true);

    audit.append({
      actor: readActorName(req),
      role: 'moderator',
      action: 'SWAP_CONTAINERS',
      summary,
      snapshot,
      meta: { from: req.body?.from, to: req.body?.to, swappedCountA, swappedCountB },
    });

    res.json({
      swappedCountA,
      swappedCountB,
      summary,
      layout: next.data.layout,
      backupCount: store.listBackups().length,
    });
  });

  app.post('/api/mutations/shift', requireModerator, (req: Request, res: Response) => {
    const state = getState();
    const { items, affectedCount, summary } = shiftRowColumns(
      state.data.items,
      {
        unit_id: String(req.body?.unit_id ?? ''),
        row: Number(req.body?.row),
        fromCol: Number(req.body?.fromCol),
        toCol: req.body?.toCol !== undefined ? Number(req.body.toCol) : undefined,
        mode: req.body?.mode === 'insert_gap' ? 'insert_gap' : 'promote',
      },
      state.data.layout,
    );
    const { snapshot } = store.writeItems(items);
    const next = getState(true);

    audit.append({
      actor: readActorName(req),
      role: 'moderator',
      action: 'SHIFT_ROW',
      summary,
      snapshot,
      meta: { affectedCount, ...req.body },
    });

    res.json({
      affectedCount,
      summary,
      layout: next.data.layout,
      backupCount: store.listBackups().length,
    });
  });

  app.put('/api/layout', requireModerator, (req: Request, res: Response) => {
    const state = getState();
    const validated = validateLayoutUpdate(req.body?.units, state.data.items);
    store.writeLayout(validated);
    const next = getState(true);

    const orderSummary = validated.map((u) => `${u.unit_id}(${u.walk_order})`).join(' → ');
    audit.append({
      actor: readActorName(req),
      role: 'moderator',
      action: 'UPDATE_LAYOUT',
      summary: `Updated shop layout: ${orderSummary}`,
      meta: { units: validated.map((u) => ({ unit_id: u.unit_id, walk_order: u.walk_order, row_widths: u.row_widths })) },
    });

    res.json({
      layout: next.data.layout,
      orderSummary,
    });
  });

  app.post('/api/import', requireModerator, (req: Request, res: Response) => {
    const csvText = typeof req.body?.csvText === 'string' ? req.body.csvText : '';
    const skipDuplicates = req.body?.skipDuplicates !== false;
    const state = getState();
    const imported = importDistributorCsv(state.data.items, csvText, skipDuplicates);

    let snapshot: string | null = null;
    if (imported.added.length > 0) {
      snapshot = store.writeItems(imported.items).snapshot;
      getState(true);

      audit.append({
        actor: readActorName(req),
        role: 'moderator',
        action: 'IMPORT_CSV',
        summary: `Imported ${imported.added.length} medicine(s) (${imported.skippedDuplicates} duplicate(s) skipped)`,
        snapshot,
        meta: { addedCount: imported.added.length, skippedDuplicates: imported.skippedDuplicates },
      });
    }

    res.status(201).json({
      addedCount: imported.added.length,
      skippedDuplicates: imported.skippedDuplicates,
      added: imported.added,
      warnings: imported.warnings,
      backupCount: store.listBackups().length,
    });
  });

  app.post('/api/undo', requireModerator, (req: Request, res: Response) => {
    const restored = store.restoreLatestBackup();
    if (!restored) {
      res.status(409).json({ error: 'No backup snapshot available to undo' });
      return;
    }
    const next = getState(true);

    audit.append({
      actor: readActorName(req),
      role: 'moderator',
      action: 'UNDO_RESTORE',
      summary: `Restored backup snapshot ${restored}`,
      snapshot: restored,
    });

    res.json({
      restored,
      itemCount: next.data.items.length,
      backupCount: store.listBackups().length,
    });
  });

  // --- Production Angular SPA Static Bundle ---

  if (fs.existsSync(clientDistDir)) {
    app.use(express.static(clientDistDir));
    app.get('*', (req: Request, res: Response, next: NextFunction) => {
      if (req.path.startsWith('/api/')) {
        next();
        return;
      }
      res.sendFile(path.join(clientDistDir, 'index.html'));
    });
  } else {
    console.warn(`[RackFlow] Client bundle not found at ${clientDistDir} — run "npm run build" first.`);
  }

  // --- Centralized Error Handler (never crashes LAN server) ---

  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof MutationError) {
      res.status(err.statusCode).json({ error: err.message });
      return;
    }
    res.status(500).json({ error: 'Internal server error', detail: String(err) });
  });

  return app;
}