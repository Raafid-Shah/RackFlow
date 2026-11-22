import { HttpClient } from '@angular/common/http';
import { Injectable, computed, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { PIN_STORAGE_KEY, STAFF_STORAGE_KEY } from '../interceptors/auth.interceptor';
import {
  AuditEntry,
  CellCoord,
  ImportCsvResponse,
  InventoryResponse,
  MedicineItem,
  PickLine,
  PickRouteResponse,
  PublicOrgConfig,
  SearchHit,
  SearchResponse,
  ShopAnalyticsResponse,
  UnitLayout,
  Warning,
} from '../models/rackflow.models';

export interface ToastMessage {
  kind: 'ok' | 'warn' | 'info';
  text: string;
}

@Injectable({ providedIn: 'root' })
export class RackFlowStore {
  private readonly http = inject(HttpClient);
  private searchTimer: ReturnType<typeof setTimeout> | null = null;
  private searchSeq = 0;
  private toastTimer: ReturnType<typeof setTimeout> | null = null;

  readonly config = signal<PublicOrgConfig | null>(null);
  readonly items = signal<MedicineItem[]>([]);
  readonly layout = signal<UnitLayout[]>([]);
  readonly warnings = signal<Warning[]>([]);
  readonly backupCount = signal<number>(0);
  readonly loadingInventory = signal<boolean>(true);
  readonly serverError = signal<string | null>(null);

  readonly analytics = signal<ShopAnalyticsResponse | null>(null);
  readonly auditEntries = signal<AuditEntry[]>([]);
  readonly loadingOps = signal<boolean>(false);
  readonly mutating = signal<boolean>(false);

  readonly query = signal<string>('');
  readonly searching = signal<boolean>(false);
  readonly searchResults = signal<SearchHit[]>([]);
  readonly searchElapsedMs = signal<number | null>(null);

  readonly spotlightCell = signal<CellCoord | null>(null);
  readonly spotlightBrand = signal<string | null>(null);

  readonly cartLines = signal<PickLine[]>([]);
  readonly pickRoute = signal<PickRouteResponse | null>(null);
  readonly pickedIds = signal<ReadonlySet<string>>(new Set());

  readonly theme = signal<'dark' | 'light'>(this.readInitialTheme());
  readonly staffName = signal<string>(this.readInitialStaff());
  readonly moderatorUnlocked = signal<boolean>(false);
  readonly toast = signal<ToastMessage | null>(null);

  readonly totalCartUnits = computed(() =>
    this.cartLines().reduce((sum, l) => sum + l.qty, 0),
  );

  readonly routeCellKeys = computed(() => {
    const keys = new Map<string, number>();
    const route = this.pickRoute();
    if (!route) return keys;
    let idx = 0;
    for (const g of route.groups) {
      for (const s of g.stops) {
        if (s.item.row !== null && s.item.col !== null) {
          const k = `${s.item.unit_id}|${s.item.row}|${s.item.col}`;
          if (!keys.has(k)) {
            idx++;
            keys.set(k, idx);
          }
        }
      }
    }
    return keys;
  });

  readonly flaggedCount = computed(
    () => this.items().filter((i) => i.status === 'FLAGGED_MISSING').length,
  );

  readonly unassignedCount = computed(
    () => this.items().filter((i) => i.status === 'UNASSIGNED' || i.row === null).length,
  );

  constructor() {
    this.init();
  }

  private readInitialTheme(): 'dark' | 'light' {
    try {
      return localStorage.getItem('rackflow-theme') === 'light' ? 'light' : 'dark';
    } catch {
      return 'dark';
    }
  }

  private readInitialStaff(): string {
    try {
      return localStorage.getItem(STAFF_STORAGE_KEY) || 'Counter Staff';
    } catch {
      return 'Counter Staff';
    }
  }

  private extractError(err: unknown, fallback: string): string {
    const msg = (err as { error?: { error?: string } } | null)?.error?.error;
    return typeof msg === 'string' && msg.trim() ? msg : fallback;
  }

  async init(): Promise<void> {
    await Promise.all([
      this.loadConfig(),
      this.refreshInventory(),
      this.refreshOpsData(),
      this.restoreModeratorSession(),
    ]);
  }

  private async restoreModeratorSession(): Promise<void> {
    try {
      const savedPin = sessionStorage.getItem(PIN_STORAGE_KEY);
      if (!savedPin) return;
      const res = await firstValueFrom(
        this.http.post<{ ok: boolean }>('/api/auth/verify', { pin: savedPin }),
      );
      if (res.ok) this.moderatorUnlocked.set(true);
    } catch {
      try {
        sessionStorage.removeItem(PIN_STORAGE_KEY);
      } catch {}
      this.moderatorUnlocked.set(false);
    }
  }

  async loadConfig(): Promise<void> {
    try {
      const cfg = await firstValueFrom(this.http.get<PublicOrgConfig>('/api/config'));
      this.config.set(cfg);
      if (cfg.staffPresets.length > 0 && !this.staffName()) {
        this.setStaffName(cfg.staffPresets[0]);
      }
    } catch {
      this.serverError.set('Cannot reach RackFlow server on /api/config.');
    }
  }

  async refreshInventory(): Promise<void> {
    this.loadingInventory.set(true);
    try {
      const res = await firstValueFrom(this.http.get<InventoryResponse>('/api/inventory'));
      this.items.set(res.items);
      this.layout.set(res.layout);
      this.warnings.set(res.warnings);
      this.backupCount.set(res.backupCount);
      this.serverError.set(null);

      if (this.query().trim()) {
        this.executeSearch(this.query());
      }
      if (this.cartLines().length > 0) {
        await this.recomputeRoute();
      }
    } catch {
      this.serverError.set('LAN server offline. Start Express on the counter PC.');
    } finally {
      this.loadingInventory.set(false);
    }
  }

  async refreshOpsData(): Promise<void> {
    this.loadingOps.set(true);
    try {
      const [analyticsRes, auditRes] = await Promise.all([
        firstValueFrom(this.http.get<ShopAnalyticsResponse>('/api/analytics')),
        firstValueFrom(this.http.get<{ entries: AuditEntry[] }>('/api/audit', { params: { limit: 60 } })),
      ]);
      this.analytics.set(analyticsRes);
      this.auditEntries.set(auditRes.entries);
      this.backupCount.set(analyticsRes.backupCount);
    } catch {
      this.notify('warn', 'Could not load analytics & audit feed.');
    } finally {
      this.loadingOps.set(false);
    }
  }

  private async syncAll(): Promise<void> {
    await Promise.all([this.refreshInventory(), this.refreshOpsData()]);
  }

  setQuery(raw: string): void {
    this.query.set(raw);
    if (this.searchTimer) clearTimeout(this.searchTimer);
    if (!raw.trim()) {
      this.searchSeq++;
      this.searchResults.set([]);
      this.searchElapsedMs.set(null);
      this.searching.set(false);
      return;
    }
    this.searching.set(true);
    this.searchTimer = setTimeout(() => this.executeSearch(raw), 110);
  }

  clearSearch(): void {
    this.setQuery('');
    this.spotlightCell.set(null);
    this.spotlightBrand.set(null);
  }

  private async executeSearch(q: string): Promise<void> {
    const seq = ++this.searchSeq;
    try {
      const res = await firstValueFrom(
        this.http.get<SearchResponse>('/api/search', { params: { q } }),
      );
      if (seq !== this.searchSeq) return;
      this.searchResults.set(res.results);
      this.searchElapsedMs.set(res.elapsedMs);

      const top = res.results[0]?.item;
      if (top && top.row !== null && top.col !== null) {
        this.spotlightCell.set({ unit_id: top.unit_id, row: top.row, col: top.col });
        this.spotlightBrand.set(top.brand_name);
      }
    } catch {
      if (seq === this.searchSeq) {
        this.notify('warn', 'Search request failed. Check shop Wi-Fi.');
      }
    } finally {
      if (seq === this.searchSeq) this.searching.set(false);
    }
  }

  focusCell(item: MedicineItem): void {
    if (item.row === null || item.col === null) return;
    this.spotlightCell.set({ unit_id: item.unit_id, row: item.row, col: item.col });
    this.spotlightBrand.set(item.brand_name);
  }

  async addToCart(item: MedicineItem): Promise<void> {
    const current = [...this.cartLines()];
    const existing = current.find((l) => l.item_id === item.item_id);
    if (existing) {
      existing.qty = Math.min(99, existing.qty + 1);
    } else {
      current.push({ item_id: item.item_id, qty: 1 });
    }
    this.cartLines.set(current);
    await this.recomputeRoute();
    this.notify('ok', `Added ${item.brand_name} to Pick Slip`);
  }

  async updateCartQty(itemId: string, delta: number): Promise<void> {
    const next = this.cartLines()
      .map((l) => (l.item_id === itemId ? { ...l, qty: l.qty + delta } : l))
      .filter((l) => l.qty > 0);
    this.cartLines.set(next);
    if (next.length === 0) {
      this.pickRoute.set(null);
      this.pickedIds.set(new Set());
      return;
    }
    await this.recomputeRoute();
  }

  clearCart(): void {
    this.cartLines.set([]);
    this.pickRoute.set(null);
    this.pickedIds.set(new Set());
  }

  togglePicked(itemId: string): void {
    const next = new Set(this.pickedIds());
    if (next.has(itemId)) next.delete(itemId);
    else next.add(itemId);
    this.pickedIds.set(next);
  }

  private async recomputeRoute(): Promise<void> {
    const lines = this.cartLines();
    if (lines.length === 0) {
      this.pickRoute.set(null);
      return;
    }
    try {
      const route = await firstValueFrom(
        this.http.post<PickRouteResponse>('/api/route', { lines }),
      );
      this.pickRoute.set(route);
    } catch {
      this.notify('warn', 'Could not compute pick route.');
    }
  }

  async flagNotHere(item: MedicineItem, note = 'Reported missing at shelf'): Promise<void> {
    try {
      await firstValueFrom(
        this.http.post(`/api/items/${encodeURIComponent(item.item_id)}/flag`, { note }),
      );
      await this.syncAll();
      this.notify('warn', `Flagged "${item.brand_name}" as Not Here for Moderator review.`);
    } catch (err) {
      this.notify('warn', this.extractError(err, 'Failed to flag item.'));
    }
  }

  async verifyItem(item: MedicineItem): Promise<boolean> {
    this.mutating.set(true);
    try {
      await firstValueFrom(
        this.http.patch(`/api/items/${encodeURIComponent(item.item_id)}`, {
          verifyNow: true,
          status: 'OK',
        }),
      );
      await this.syncAll();
      this.notify('ok', `Verified "${item.brand_name}" on shelf.`);
      return true;
    } catch (err) {
      this.notify('warn', this.extractError(err, 'Verification failed.'));
      return false;
    } finally {
      this.mutating.set(false);
    }
  }

  async createMedicine(payload: {
    brand_name: string;
    salt_compound?: string;
    unit_id?: string;
    row?: number | null;
    col?: number | null;
    mrp_inr?: number | null;
  }): Promise<boolean> {
    this.mutating.set(true);
    try {
      const res = await firstValueFrom(
        this.http.post<{ item: MedicineItem }>('/api/items', payload),
      );
      await this.syncAll();
      this.notify('ok', `Added "${res.item.brand_name}" (${res.item.item_id})`);
      return true;
    } catch (err) {
      this.notify('warn', this.extractError(err, 'Could not add medicine.'));
      return false;
    } finally {
      this.mutating.set(false);
    }
  }

  async moveItems(
    itemIds: string[],
    target: { unit_id: string; row: number | null; col: number | null },
  ): Promise<boolean> {
    this.mutating.set(true);
    try {
      await firstValueFrom(
        this.http.post('/api/mutations/move', {
          item_ids: itemIds,
          unit_id: target.unit_id,
          row: target.row,
          col: target.col,
        }),
      );
      await this.syncAll();
      const dest =
        target.unit_id === 'UNASSIGNED'
          ? 'UNASSIGNED Inbox'
          : `${target.unit_id} · R${target.row} · C${target.col}`;
      this.notify('ok', `Moved ${itemIds.length} item(s) to ${dest}`);
      return true;
    } catch (err) {
      this.notify('warn', this.extractError(err, 'Move failed.'));
      return false;
    } finally {
      this.mutating.set(false);
    }
  }

  async swapBins(from: CellCoord, to: CellCoord): Promise<boolean> {
    this.mutating.set(true);
    try {
      const res = await firstValueFrom(
        this.http.post<{ summary: string }>('/api/mutations/swap', { from, to }),
      );
      await this.syncAll();
      this.notify('ok', res.summary);
      return true;
    } catch (err) {
      this.notify('warn', this.extractError(err, 'Swap failed.'));
      return false;
    } finally {
      this.mutating.set(false);
    }
  }

  async shiftRow(payload: {
    unit_id: string;
    row: number;
    fromCol: number;
    toCol?: number;
    mode: 'promote' | 'insert_gap';
  }): Promise<boolean> {
    this.mutating.set(true);
    try {
      const res = await firstValueFrom(
        this.http.post<{ summary: string }>('/api/mutations/shift', payload),
      );
      await this.syncAll();
      this.notify('ok', res.summary);
      return true;
    } catch (err) {
      this.notify('warn', this.extractError(err, 'Row shift failed.'));
      return false;
    } finally {
      this.mutating.set(false);
    }
  }

  async importDistributorCsv(
    csvText: string,
    skipDuplicates = true,
  ): Promise<ImportCsvResponse | null> {
    this.mutating.set(true);
    try {
      const res = await firstValueFrom(
        this.http.post<ImportCsvResponse>('/api/import', { csvText, skipDuplicates }),
      );
      await this.syncAll();
      this.notify(
        'ok',
        `Imported ${res.addedCount} item(s) into Inbox (${res.skippedDuplicates} skipped)`,
      );
      return res;
    } catch (err) {
      this.notify('warn', this.extractError(err, 'CSV import failed.'));
      return null;
    } finally {
      this.mutating.set(false);
    }
  }

  async unlockModerator(pin: string): Promise<boolean> {
    try {
      const res = await firstValueFrom(
        this.http.post<{ ok: boolean }>('/api/auth/verify', { pin: pin.trim() }),
      );
      if (res.ok) {
        try {
          sessionStorage.setItem(PIN_STORAGE_KEY, pin.trim());
        } catch {}
        this.moderatorUnlocked.set(true);
        this.notify('ok', 'Moderator mode unlocked');
        return true;
      }
      return false;
    } catch {
      return false;
    }
  }

  lockModerator(): void {
    try {
      sessionStorage.removeItem(PIN_STORAGE_KEY);
    } catch {}
    this.moderatorUnlocked.set(false);
    this.notify('info', 'Moderator mode locked');
  }

  async undoLastChange(): Promise<void> {
    this.mutating.set(true);
    try {
      const res = await firstValueFrom(
        this.http.post<{ restored: string; backupCount: number }>('/api/undo', {}),
      );
      await this.syncAll();
      this.notify('ok', `Restored snapshot ${res.restored}`);
    } catch (err) {
      this.notify('warn', this.extractError(err, 'Undo failed.'));
    } finally {
      this.mutating.set(false);
    }
  }

  toggleTheme(): void {
    const next = this.theme() === 'dark' ? 'light' : 'dark';
    this.theme.set(next);
    document.documentElement.setAttribute('data-theme', next);
    try {
      localStorage.setItem('rackflow-theme', next);
    } catch {}
  }

  setStaffName(name: string): void {
    this.staffName.set(name);
    try {
      localStorage.setItem(STAFF_STORAGE_KEY, name);
    } catch {}
  }

  notify(kind: ToastMessage['kind'], text: string): void {
    this.toast.set({ kind, text });
    if (this.toastTimer) clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => this.toast.set(null), 3200);
  }
}