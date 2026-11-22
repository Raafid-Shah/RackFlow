import fs from 'fs';
import http from 'http';
import os from 'os';
import path from 'path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';

interface JsonResponse {
  status: number;
  body: Record<string, unknown>;
}

let tempDir: string;
let server: http.Server;
let baseUrl: string;

async function api(
  method: string,
  route: string,
  body?: unknown,
  headers: Record<string, string> = {},
): Promise<JsonResponse> {
  const res = await fetch(`${baseUrl}${route}`, {
    method,
    headers: {
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
      ...headers,
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const json = (await res.json()) as Record<string, unknown>;
  return { status: res.status, body: json };
}

const MOD_HEADERS = {
  'x-rackflow-pin': '1234',
  'x-rackflow-staff': 'Senior Chemist',
};

beforeAll(async () => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rackflow-api-test-'));

  fs.copyFileSync(
    path.join(__dirname, 'fixtures', 'catalog.csv'),
    path.join(tempDir, 'data.csv'),
  );
  fs.writeFileSync(
    path.join(tempDir, 'layout.json'),
    JSON.stringify({
      units: [
        {
          unit_id: 'D1',
          name: 'Counter Drawers',
          walk_order: 100,
          anchor_rule: 'Row 1 = Top Drawer | Col 1 = Leftmost',
          row_widths: [4, 4],
        },
        {
          unit_id: 'W1',
          name: 'Left Wall Rack',
          walk_order: 200,
          anchor_rule: 'Row 1 = Top Shelf | Col 1 = Closest to Counter',
          row_widths: [5, 7, 7, 3],
        },
        {
          unit_id: 'F1',
          name: 'Corner Fridge',
          walk_order: 300,
          anchor_rule: 'Row 1 = Top Shelf | Single Column',
          row_widths: [1, 1, 1],
        },
      ],
    }),
  );
  fs.writeFileSync(
    path.join(tempDir, 'org_config.json'),
    JSON.stringify({
      shopName: 'Test Pharmacy',
      moderatorPin: '1234',
      showPinHint: true,
      staffPresets: ['Counter Staff', 'Floor Helper 1'],
    }),
  );

  const app = createApp({ dataDir: tempDir });
  server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const addr = server.address();
  if (!addr || typeof addr === 'string') throw new Error('Failed to bind test server');
  baseUrl = `http://127.0.0.1:${addr.port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) =>
    server.close((err) => (err ? reject(err) : resolve())),
  );
  fs.rmSync(tempDir, { recursive: true, force: true });
});

describe('Stage 5 API — Read, Search, Route & RBAC', () => {
  it('serves /api/health and /api/config cleanly', async () => {
    const health = await api('GET', '/api/health');
    expect(health.status).toBe(200);
    expect(health.body.ok).toBe(true);

    const cfg = await api('GET', '/api/config');
    expect(cfg.status).toBe(200);
    expect(cfg.body.shopName).toBe('Test Pharmacy');
    expect(cfg.body.pinHint).toBe('1234');
  });

  it('returns enriched search hits with spatial landmarks and split-location badges', async () => {
    const res = await api('GET', '/api/search?q=fevarex');
    expect(res.status).toBe(200);
    expect(res.body.count).toBe(2);
    const results = res.body.results as Array<Record<string, unknown>>;
    const cue = results[0].cue as Record<string, unknown>;
    expect(cue.code).toBe('W1 · R2 · C1');
    expect(cue.band).toBe('Upper-Middle · Front End');
  });

  it('builds a single-swoop pick route with enriched cues and subtotal', async () => {
    const res = await api('POST', '/api/route', {
      lines: [
        { item_id: 'S-006', qty: 1 },
        { item_id: 'S-004', qty: 1 },
        { item_id: 'S-001', qty: 2 },
      ],
    });
    expect(res.status).toBe(200);
    const groups = res.body.groups as Array<{ unit_id: string }>;
    expect(groups.map((g) => g.unit_id)).toEqual(['D1', 'W1']);
    expect(res.body.subtotalInr).toBe(212.52);
  });

  it('enforces Moderator PIN on write endpoints and verifies valid PIN', async () => {
    const badAuth = await api('POST', '/api/auth/verify', { pin: '9999' });
    expect(badAuth.status).toBe(401);

    const goodAuth = await api('POST', '/api/auth/verify', { pin: '1234' });
    expect(goodAuth.status).toBe(200);

    const blockedMove = await api('POST', '/api/mutations/move', {
      item_id: 'S-001',
      unit_id: 'D1',
      row: 1,
      col: 1,
    });
    expect(blockedMove.status).toBe(401);
  });
});

describe('Stage 5 API — Staff Flag, Atomic Mutations, Import & Byte-Exact Undo', () => {
  it('allows any staff member to flag an item "Not Here?" without PIN and restores byte-exact CSV on Undo', async () => {
    const csvPath = path.join(tempDir, 'data.csv');
    const beforeBytes = fs.readFileSync(csvPath);

    const flagRes = await api(
      'POST',
      '/api/items/S-001/flag',
      { note: 'Strip empty in bin' },
      { 'x-rackflow-staff': 'Floor Helper 1' },
    );
    expect(flagRes.status).toBe(200);
    expect((flagRes.body.item as Record<string, unknown>).status).toBe('FLAGGED_MISSING');
    expect(flagRes.body.backupCount).toBe(1);

    // Moderator triggers 1-click Undo -> file MUST match original bytes identically
    const undoRes = await api('POST', '/api/undo', {}, MOD_HEADERS);
    expect(undoRes.status).toBe(200);
    expect(undoRes.body.backupCount).toBe(0);

    const afterUndoBytes = fs.readFileSync(csvPath);
    expect(Buffer.compare(beforeBytes, afterUndoBytes)).toBe(0);

    // Calling Undo with no snapshots left returns 409
    const emptyUndo = await api('POST', '/api/undo', {}, MOD_HEADERS);
    expect(emptyUndo.status).toBe(409);
  });

  it('moves, swaps containers, and promotes Col 2 -> Col 1 cleanly', async () => {
    // 1. Move S-007 (UNASSIGNED) into W1 · R2 · C3
    const moveRes = await api(
      'POST',
      '/api/mutations/move',
      { item_id: 'S-007', unit_id: 'W1', row: 2, col: 3 },
      MOD_HEADERS,
    );
    expect(moveRes.status).toBe(200);

    // 2. Promote W1 · R2 · C3 -> C1 (ripples C1->C2 and C2->C3)
    const shiftRes = await api(
      'POST',
      '/api/mutations/shift',
      { unit_id: 'W1', row: 2, fromCol: 3, toCol: 1, mode: 'promote' },
      MOD_HEADERS,
    );
    expect(shiftRes.status).toBe(200);

    const invAfterShift = await api('GET', '/api/inventory');
    const items = invAfterShift.body.items as Array<{
      item_id: string;
      row: number;
      col: number;
    }>;
    expect(items.find((i) => i.item_id === 'S-007')?.col).toBe(1); // promoted!
    expect(items.find((i) => i.item_id === 'S-001')?.col).toBe(2); // shifted 1 -> 2
    expect(items.find((i) => i.item_id === 'S-008')?.col).toBe(3); // shifted 2 -> 3

    // 3. Swap W1 · R2 · C1 (S-007) <-> F1 · R2 · C1 (S-005)
    const swapRes = await api(
      'POST',
      '/api/mutations/swap',
      {
        from: { unit_id: 'W1', row: 2, col: 1 },
        to: { unit_id: 'F1', row: 2, col: 1 },
      },
      MOD_HEADERS,
    );
    expect(swapRes.status).toBe(200);
    expect(swapRes.body.swappedCountA).toBe(1);
    expect(swapRes.body.swappedCountB).toBe(1);
  });

  it('imports a distributor CSV with header aliases into the Lazy-Slotting Inbox and logs audit entries', async () => {
    const distributorCsv = [
      'name,composition,mrp',
      'Dolo 650 Distributor,Paracetamol (650mg),32.50',
      'Fevarex 650,Paracetamol,33.76', // different strength_form is blank -> imported unless exact match
      'Dolo 650 Distributor,Paracetamol (650mg),32.50', // duplicate inside same CSV -> skipped
    ].join('\n');

    const importRes = await api(
      'POST',
      '/api/import',
      { csvText: distributorCsv, skipDuplicates: true },
      MOD_HEADERS,
    );
    expect(importRes.status).toBe(201);
    expect(importRes.body.addedCount).toBe(2);
    expect(importRes.body.skippedDuplicates).toBe(1);

    const added = importRes.body.added as Array<{ unit_id: string; status: string }>;
    expect(added.every((a) => a.unit_id === 'UNASSIGNED' && a.status === 'UNASSIGNED')).toBe(true);

    // Analytics & Audit Log reflect all changes
    const analytics = await api('GET', '/api/analytics');
    expect(analytics.status).toBe(200);
    expect((analytics.body.summary as Record<string, number>).unassignedCount).toBe(2);

    const auditRes = await api('GET', '/api/audit?limit=10');
    expect(auditRes.status).toBe(200);
    const entries = auditRes.body.entries as Array<{ action: string }>;
    expect(entries[0].action).toBe('IMPORT_CSV');
    expect(entries.some((e) => e.action === 'UNDO_RESTORE')).toBe(true);
    expect(entries.some((e) => e.action === 'FLAG_MISSING')).toBe(true);
  });
});