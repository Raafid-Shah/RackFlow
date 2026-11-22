import { Component, OnInit, computed, effect, inject, output, signal } from '@angular/core';
import {
  Activity,
  AlertTriangle,
  ArrowDown,
  ArrowLeftRight,
  ArrowRight,
  ArrowUp,
  CheckCircle2,
  Clock,
  Flag,
  History,
  Inbox,
  Layers,
  LayoutGrid,
  Lock,
  LucideAngularModule,
  Minus,
  Plus,
  RefreshCw,
  Save,
  Trash2,
  Undo2,
  Upload,
  Wrench,
} from 'lucide-angular';
import {
  CellCoord,
  ImportCsvResponse,
  MedicineItem,
  RelocationCandidate,
  UnitLayout,
} from '../models/rackflow.models';
import { RackFlowStore } from '../services/rackflow.store';

type OpsSubTab = 'radar' | 'mutate' | 'layout' | 'inbox' | 'audit';

interface UnitOccupancy {
  totalItems: number;
  maxRow: number;
  maxColByRow: Map<number, number>;
}

@Component({
  selector: 'rf-moderator-ops',
  imports: [LucideAngularModule],
  template: `
    <div class="space-y-4">
      @if (!store.moderatorUnlocked()) {
        <div class="rf-pill-amber flex flex-wrap items-center justify-between gap-3 rounded-xl p-3.5 text-xs">
          <div class="flex items-center gap-2">
            <lucide-icon [img]="LockIcon" [size]="16" />
            <span>
              <strong>Read-Only Ops Preview:</strong> Unlock Moderator PIN to execute moves, swaps, shifts, layout edits, imports, or Undo.
            </span>
          </div>
          <button
            type="button"
            (click)="requestUnlock.emit()"
            class="rounded-lg bg-amber px-3 py-1.5 font-semibold text-bg hover:opacity-90"
          >
            Unlock Mod PIN
          </button>
        </div>
      }

      <div class="flex flex-wrap items-center justify-between gap-2">
        <div class="flex flex-wrap gap-1.5">
          <button
            type="button"
            (click)="subTab.set('radar')"
            class="inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-semibold transition"
            [class.rf-pill-amber]="subTab() === 'radar'"
            [class.border-line]="subTab() !== 'radar'"
            [class.text-muted]="subTab() !== 'radar'"
          >
            <lucide-icon [img]="RadarIcon" [size]="14" /> Bottleneck Radar
          </button>

          <button
            type="button"
            (click)="subTab.set('mutate')"
            class="inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-semibold transition"
            [class.rf-pill-amber]="subTab() === 'mutate'"
            [class.border-line]="subTab() !== 'mutate'"
            [class.text-muted]="subTab() !== 'mutate'"
          >
            <lucide-icon [img]="WrenchIcon" [size]="14" /> Rack Mutations
          </button>

          <button
            type="button"
            (click)="openLayoutTab()"
            class="inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-semibold transition"
            [class.rf-pill-amber]="subTab() === 'layout'"
            [class.border-line]="subTab() !== 'layout'"
            [class.text-muted]="subTab() !== 'layout'"
          >
            <lucide-icon [img]="LayoutIcon" [size]="14" />
            Shop Layout
            @if (layoutDirty()) {
              <span class="h-1.5 w-1.5 rounded-full bg-amber"></span>
            }
          </button>

          <button
            type="button"
            (click)="subTab.set('inbox')"
            class="inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-semibold transition"
            [class.rf-pill-amber]="subTab() === 'inbox'"
            [class.border-line]="subTab() !== 'inbox'"
            [class.text-muted]="subTab() !== 'inbox'"
          >
            <lucide-icon [img]="InboxIcon" [size]="14" />
            Inbox &amp; CSV Import
            @if (store.unassignedCount() > 0) {
              <span class="rounded-full bg-amber px-1.5 font-mono text-[10px] text-bg">
                {{ store.unassignedCount() }}
              </span>
            }
          </button>

          <button
            type="button"
            (click)="subTab.set('audit')"
            class="inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-semibold transition"
            [class.rf-pill-amber]="subTab() === 'audit'"
            [class.border-line]="subTab() !== 'audit'"
            [class.text-muted]="subTab() !== 'audit'"
          >
            <lucide-icon [img]="HistoryIcon" [size]="14" />
            Audit &amp; Undo ({{ store.auditEntries().length }})
          </button>
        </div>

        <button
          type="button"
          (click)="store.refreshOpsData()"
          class="inline-flex items-center gap-1 rounded-lg border border-line bg-surface px-2.5 py-1.5 text-xs text-muted hover:text-fg"
        >
          <lucide-icon [img]="RefreshIcon" [size]="13" /> Refresh
        </button>
      </div>

      @if (subTab() === 'radar') {
        @if (store.analytics(); as report) {
          <div class="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            <div class="rounded-xl border border-line bg-surface p-3">
              <p class="text-[11px] text-muted">Avg Find Time</p>
              <p class="mt-1 font-mono text-lg font-bold text-fg">
                {{ report.summary.avgFindTimeSec !== null ? report.summary.avgFindTimeSec + 's' : '—' }}
              </p>
            </div>
            <div class="rounded-xl border border-line bg-surface p-3">
              <p class="text-[11px] text-muted">Slow (&gt;{{ slowThreshold() }}s)</p>
              <p class="mt-1 font-mono text-lg font-bold text-amber">
                {{ report.summary.slowFindCount }}
              </p>
            </div>
            <div class="rounded-xl border border-line bg-surface p-3">
              <p class="text-[11px] text-muted">Flagged Missing</p>
              <p class="mt-1 font-mono text-lg font-bold text-warn">
                {{ report.summary.flaggedMissingCount }}
              </p>
            </div>
            <div class="rounded-xl border border-line bg-surface p-3">
              <p class="text-[11px] text-muted">Salt Scatters</p>
              <p class="mt-1 font-mono text-lg font-bold text-amber">
                {{ report.summary.scatterAlertCount }}
              </p>
            </div>
            <div class="rounded-xl border border-line bg-surface p-3">
              <p class="text-[11px] text-muted">Unslotted Inbox</p>
              <p class="mt-1 font-mono text-lg font-bold text-fg">
                {{ report.summary.unassignedCount }}
              </p>
            </div>
            <div class="rounded-xl border border-line bg-surface p-3">
              <p class="text-[11px] text-muted">Unread MRPs</p>
              <p class="mt-1 font-mono text-lg font-bold text-muted">
                {{ report.summary.missingMrpCount }}
              </p>
            </div>
          </div>

          <div class="grid gap-4 lg:grid-cols-2">
            <section class="rounded-xl border border-line bg-surface p-4">
              <header class="mb-3 flex items-center justify-between">
                <h3 class="flex items-center gap-2 text-sm font-bold text-fg">
                  <lucide-icon [img]="FlagIcon" [size]="15" class="text-warn" />
                  Flagged "Not Here?" Queue ({{ report.flaggedItems.length }})
                </h3>
              </header>

              @if (report.flaggedItems.length === 0) {
                <p class="text-xs text-muted">Zero missing-shelf flags right now.</p>
              } @else {
                <div class="space-y-2">
                  @for (item of report.flaggedItems; track item.item_id) {
                    <div class="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-line bg-bg p-2.5">
                      <div class="min-w-0 flex-1">
                        <p class="text-sm font-semibold text-fg">
                          {{ item.brand_name }}
                          <span class="ml-1 font-mono text-xs text-amber">
                            {{ item.unit_id }} · R{{ item.row }} · C{{ item.col }}
                          </span>
                        </p>
                        @if (item.notes) {
                          <p class="truncate text-xs text-muted">{{ item.notes }}</p>
                        }
                      </div>
                      <div class="flex items-center gap-1.5">
                        <button
                          type="button"
                          (click)="handleVerify(item)"
                          [disabled]="store.mutating()"
                          class="rf-pill-ok inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-xs font-semibold hover:opacity-90"
                        >
                          <lucide-icon [img]="CheckIcon" [size]="12" /> Verified Here
                        </button>
                        <button
                          type="button"
                          (click)="jumpToMove(item)"
                          class="rounded-md border border-line px-2 py-1 text-xs text-muted hover:border-amber hover:text-amber"
                        >
                          Move
                        </button>
                      </div>
                    </div>
                  }
                </div>
              }
            </section>

            <section class="rounded-xl border border-line bg-surface p-4">
              <header class="mb-3 flex items-center justify-between">
                <h3 class="flex items-center gap-2 text-sm font-bold text-fg">
                  <lucide-icon [img]="ClockIcon" [size]="15" class="text-amber" />
                  Deep-Column Relocation Candidates ({{ report.relocationCandidates.length }})
                </h3>
                <span class="font-mono text-[11px] text-muted">Col &ge; 4 &amp; Slow</span>
              </header>

              @if (report.relocationCandidates.length === 0) {
                <p class="text-xs text-muted">No slow high-column bottlenecks detected.</p>
              } @else {
                <div class="max-h-72 space-y-2 overflow-y-auto pr-1">
                  @for (cand of report.relocationCandidates; track cand.item_id) {
                    <div class="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-line bg-bg p-2.5">
                      <div class="min-w-0 flex-1">
                        <div class="flex flex-wrap items-center gap-2">
                          <span class="text-sm font-semibold text-fg">{{ cand.brand_name }}</span>
                          <span class="rf-pill-amber rounded px-1.5 py-0.5 font-mono text-[10px]">
                            {{ cand.currentCode }} · {{ cand.find_time_sec }}s
                          </span>
                        </div>
                        <p class="mt-0.5 text-[11px] text-muted">{{ cand.reason }}</p>
                      </div>
                      <button
                        type="button"
                        (click)="promoteCandidate(cand)"
                        [disabled]="store.mutating()"
                        class="rf-pill-ok inline-flex items-center gap-1 rounded-md px-2.5 py-1 font-mono text-xs font-semibold hover:opacity-90"
                      >
                        C{{ cand.col }} <lucide-icon [img]="ArrowRightIcon" [size]="12" /> C1
                      </button>
                    </div>
                  }
                </div>
              }
            </section>

            <section class="rounded-xl border border-line bg-surface p-4">
              <h3 class="mb-3 flex items-center gap-2 text-sm font-bold text-fg">
                <lucide-icon [img]="LayersIcon" [size]="15" class="text-amber" />
                Cross-Rack Salt Scatter Alerts ({{ report.scatterAlerts.length }})
              </h3>
              @if (report.scatterAlerts.length === 0) {
                <p class="text-xs text-muted">No scattered active salts above threshold.</p>
              } @else {
                <div class="max-h-64 space-y-2 overflow-y-auto pr-1">
                  @for (cluster of report.scatterAlerts; track cluster.salt) {
                    <div class="rounded-lg border border-line bg-bg p-2.5">
                      <div class="flex items-center justify-between gap-2">
                        <span class="text-xs font-bold uppercase tracking-wide text-amber">
                          {{ cluster.salt }}
                        </span>
                        <span class="font-mono text-[11px] text-muted">
                          {{ cluster.spotCount }} bins
                        </span>
                      </div>
                      <div class="mt-1.5 flex flex-wrap gap-1.5">
                        @for (entry of cluster.items; track entry.item_id) {
                          <span class="rounded border border-line bg-surface px-2 py-0.5 text-[11px] text-fg">
                            {{ entry.brand_name }}
                            <span class="font-mono text-amber">({{ entry.code }})</span>
                          </span>
                        }
                      </div>
                    </div>
                  }
                </div>
              }
            </section>

            <section class="rounded-xl border border-line bg-surface p-4">
              <h3 class="mb-3 flex items-center gap-2 text-sm font-bold text-fg">
                <lucide-icon [img]="AlertIcon" [size]="15" class="text-amber" />
                Slowest Shelf Bins &amp; CSV Health
              </h3>
              <div class="max-h-40 space-y-1.5 overflow-y-auto pr-1">
                @for (bin of report.slowHotspots.slice(0, 6); track bin.code) {
                  <div class="flex items-center justify-between rounded-lg border border-line bg-bg px-3 py-1.5 text-xs">
                    <span class="font-mono font-bold text-amber">{{ bin.code }}</span>
                    <span class="mx-2 flex-1 truncate text-muted">{{ bin.brands.join(', ') }}</span>
                    <span class="font-mono text-warn">max {{ bin.maxFindTimeSec }}s</span>
                  </div>
                }
              </div>

              <div class="mt-3 border-t border-line pt-2.5">
                <p class="text-xs font-semibold text-fg">
                  CSV Loader Warnings: {{ report.warnings.length }}
                </p>
                @if (report.warnings.length === 0) {
                  <p class="mt-0.5 text-[11px] text-ok">All rows in data.csv passed validation cleanly.</p>
                } @else {
                  <ul class="mt-1 max-h-24 space-y-1 overflow-y-auto font-mono text-[11px] text-amber">
                    @for (w of report.warnings.slice(0, 10); track $index) {
                      <li>[L{{ w.line }}] {{ w.code }}: {{ w.message }}</li>
                    }
                  </ul>
                }
              </div>
            </section>
          </div>
        } @else {
          <p class="text-sm text-muted">Loading shop analytics…</p>
        }
      }

      @if (subTab() === 'mutate') {
        <div class="grid gap-4 lg:grid-cols-2">
          <section class="rounded-xl border border-line bg-surface p-4">
            <h3 class="text-sm font-bold text-fg">1. Move Single Medicine</h3>
            <p class="mt-0.5 text-xs text-muted">
              Reassign any medicine to a valid jagged bin (or back to UNASSIGNED). Auto-snapshots before writing.
            </p>

            <form (submit)="submitMove($event)" class="mt-3 space-y-3">
              <div>
                <label class="block text-[11px] text-muted">Medicine</label>
                <select
                  [value]="moveItemId()"
                  (change)="moveItemId.set(asStr($event))"
                  class="mt-1 w-full rounded-lg border border-line bg-bg px-2.5 py-2 text-xs text-fg focus:border-amber focus:outline-none"
                >
                  <option value="">Select medicine…</option>
                  @for (m of sortedItems(); track m.item_id) {
                    <option [value]="m.item_id">
                      {{ m.brand_name }} ({{ m.row ? m.unit_id + ' R' + m.row + '·C' + m.col : 'UNASSIGNED' }})
                    </option>
                  }
                </select>
              </div>

              <div class="grid grid-cols-3 gap-2">
                <div>
                  <label class="block text-[11px] text-muted">Unit</label>
                  <select
                    [value]="moveUnit()"
                    (change)="onMoveUnitChange(asStr($event))"
                    class="mt-1 w-full rounded-lg border border-line bg-bg px-2 py-2 font-mono text-xs text-fg"
                  >
                    @for (u of store.layout(); track u.unit_id) {
                      <option [value]="u.unit_id">{{ u.unit_id }} · {{ u.name }}</option>
                    }
                    <option value="UNASSIGNED">UNASSIGNED</option>
                  </select>
                </div>

                @if (moveUnit() !== 'UNASSIGNED') {
                  <div>
                    <label class="block text-[11px] text-muted">Row</label>
                    <select
                      [value]="moveRow()"
                      (change)="onMoveRowChange(asNum($event))"
                      class="mt-1 w-full rounded-lg border border-line bg-bg px-2 py-2 font-mono text-xs text-fg"
                    >
                      @for (r of rowsFor(moveUnit()); track r) {
                        <option [value]="r">Row {{ r }}</option>
                      }
                    </select>
                  </div>
                  <div>
                    <label class="block text-[11px] text-muted">Col</label>
                    <select
                      [value]="moveCol()"
                      (change)="moveCol.set(asNum($event))"
                      class="mt-1 w-full rounded-lg border border-line bg-bg px-2 py-2 font-mono text-xs text-fg"
                    >
                      @for (c of colsFor(moveUnit(), moveRow()); track c) {
                        <option [value]="c">Col {{ c }}</option>
                      }
                    </select>
                  </div>
                }
              </div>

              <button
                type="submit"
                [disabled]="!moveItemId() || store.mutating()"
                class="w-full rounded-lg bg-amber py-2 text-xs font-bold text-bg hover:opacity-90 disabled:opacity-40"
              >
                Execute Atomic Move
              </button>
            </form>
          </section>

          <section class="rounded-xl border border-line bg-surface p-4">
            <h3 class="flex items-center gap-1.5 text-sm font-bold text-fg">
              <lucide-icon [img]="SwapIcon" [size]="15" class="text-amber" />
              2. Atomic Container Swap
            </h3>
            <p class="mt-0.5 text-xs text-muted">
              Exchange every medicine between Bin A and Bin B in one atomic write.
            </p>

            <form (submit)="submitSwap($event)" class="mt-3 space-y-3">
              <div class="rounded-lg border border-line bg-bg p-2.5">
                <p class="font-mono text-[11px] font-bold text-amber">Bin A</p>
                <div class="mt-1.5 grid grid-cols-3 gap-2">
                  <select
                    [value]="swapAUnit()"
                    (change)="onSwapAUnitChange(asStr($event))"
                    class="rounded border border-line bg-surface px-2 py-1.5 font-mono text-xs text-fg"
                  >
                    @for (u of store.layout(); track u.unit_id) {
                      <option [value]="u.unit_id">{{ u.unit_id }}</option>
                    }
                  </select>
                  <select
                    [value]="swapARow()"
                    (change)="onSwapARowChange(asNum($event))"
                    class="rounded border border-line bg-surface px-2 py-1.5 font-mono text-xs text-fg"
                  >
                    @for (r of rowsFor(swapAUnit()); track r) {
                      <option [value]="r">R{{ r }}</option>
                    }
                  </select>
                  <select
                    [value]="swapACol()"
                    (change)="swapACol.set(asNum($event))"
                    class="rounded border border-line bg-surface px-2 py-1.5 font-mono text-xs text-fg"
                  >
                    @for (c of colsFor(swapAUnit(), swapARow()); track c) {
                      <option [value]="c">C{{ c }}</option>
                    }
                  </select>
                </div>
                <p class="mt-1.5 truncate text-[11px] text-muted">
                  Contents: {{ binPreview(swapAUnit(), swapARow(), swapACol()) }}
                </p>
              </div>

              <div class="rounded-lg border border-line bg-bg p-2.5">
                <p class="font-mono text-[11px] font-bold text-ok">Bin B</p>
                <div class="mt-1.5 grid grid-cols-3 gap-2">
                  <select
                    [value]="swapBUnit()"
                    (change)="onSwapBUnitChange(asStr($event))"
                    class="rounded border border-line bg-surface px-2 py-1.5 font-mono text-xs text-fg"
                  >
                    @for (u of store.layout(); track u.unit_id) {
                      <option [value]="u.unit_id">{{ u.unit_id }}</option>
                    }
                  </select>
                  <select
                    [value]="swapBRow()"
                    (change)="onSwapBRowChange(asNum($event))"
                    class="rounded border border-line bg-surface px-2 py-1.5 font-mono text-xs text-fg"
                  >
                    @for (r of rowsFor(swapBUnit()); track r) {
                      <option [value]="r">R{{ r }}</option>
                    }
                  </select>
                  <select
                    [value]="swapBCol()"
                    (change)="swapBCol.set(asNum($event))"
                    class="rounded border border-line bg-surface px-2 py-1.5 font-mono text-xs text-fg"
                  >
                    @for (c of colsFor(swapBUnit(), swapBRow()); track c) {
                      <option [value]="c">C{{ c }}</option>
                    }
                  </select>
                </div>
                <p class="mt-1.5 truncate text-[11px] text-muted">
                  Contents: {{ binPreview(swapBUnit(), swapBRow(), swapBCol()) }}
                </p>
              </div>

              <button
                type="submit"
                [disabled]="store.mutating()"
                class="w-full rounded-lg bg-amber py-2 text-xs font-bold text-bg hover:opacity-90 disabled:opacity-40"
              >
                Swap Containers Atomically
              </button>
            </form>
          </section>

          <section class="rounded-xl border border-line bg-surface p-4">
            <h3 class="text-sm font-bold text-fg">3. Row Shift (Col K → Col 1 / Insert Gap)</h3>
            <p class="mt-0.5 text-xs text-muted">
              Promote a busy column closer to the counter and ripple neighboring columns cleanly without losing order.
            </p>

            <form (submit)="submitShift($event)" class="mt-3 space-y-3">
              <div class="grid grid-cols-2 gap-2">
                <div>
                  <label class="block text-[11px] text-muted">Unit</label>
                  <select
                    [value]="shiftUnit()"
                    (change)="onShiftUnitChange(asStr($event))"
                    class="mt-1 w-full rounded-lg border border-line bg-bg px-2 py-2 font-mono text-xs text-fg"
                  >
                    @for (u of store.layout(); track u.unit_id) {
                      <option [value]="u.unit_id">{{ u.unit_id }} · {{ u.name }}</option>
                    }
                  </select>
                </div>
                <div>
                  <label class="block text-[11px] text-muted">Row</label>
                  <select
                    [value]="shiftRowNum()"
                    (change)="onShiftRowChange(asNum($event))"
                    class="mt-1 w-full rounded-lg border border-line bg-bg px-2 py-2 font-mono text-xs text-fg"
                  >
                    @for (r of rowsFor(shiftUnit()); track r) {
                      <option [value]="r">Row {{ r }}</option>
                    }
                  </select>
                </div>
              </div>

              <div class="grid grid-cols-3 gap-2">
                <div>
                  <label class="block text-[11px] text-muted">Mode</label>
                  <select
                    [value]="shiftMode()"
                    (change)="shiftMode.set(asStr($event) === 'insert_gap' ? 'insert_gap' : 'promote')"
                    class="mt-1 w-full rounded-lg border border-line bg-bg px-2 py-2 text-xs text-fg"
                  >
                    <option value="promote">Promote (Ripple)</option>
                    <option value="insert_gap">Insert Gap (+1)</option>
                  </select>
                </div>
                <div>
                  <label class="block text-[11px] text-muted">From Col</label>
                  <select
                    [value]="shiftFromCol()"
                    (change)="shiftFromCol.set(asNum($event))"
                    class="mt-1 w-full rounded-lg border border-line bg-bg px-2 py-2 font-mono text-xs text-fg"
                  >
                    @for (c of colsFor(shiftUnit(), shiftRowNum()); track c) {
                      <option [value]="c">C{{ c }}</option>
                    }
                  </select>
                </div>
                @if (shiftMode() === 'promote') {
                  <div>
                    <label class="block text-[11px] text-muted">Target Col</label>
                    <select
                      [value]="shiftToCol()"
                      (change)="shiftToCol.set(asNum($event))"
                      class="mt-1 w-full rounded-lg border border-line bg-bg px-2 py-2 font-mono text-xs text-fg"
                    >
                      @for (c of colsFor(shiftUnit(), shiftRowNum()); track c) {
                        <option [value]="c">C{{ c }}</option>
                      }
                    </select>
                  </div>
                }
              </div>

              <button
                type="submit"
                [disabled]="store.mutating()"
                class="w-full rounded-lg bg-amber py-2 text-xs font-bold text-bg hover:opacity-90 disabled:opacity-40"
              >
                Run Row Shift
              </button>
            </form>
          </section>

          <section class="rounded-xl border border-line bg-surface p-4">
            <h3 class="flex items-center gap-1.5 text-sm font-bold text-fg">
              <lucide-icon [img]="PlusIcon" [size]="15" class="text-ok" />
              4. Quick Add New Medicine
            </h3>
            <p class="mt-0.5 text-xs text-muted">
              Add a single newly arrived strip directly to a shelf or into the Lazy-Slotting Inbox.
            </p>

            <form (submit)="submitCreate($event)" class="mt-3 space-y-2.5">
              <input
                type="text"
                [value]="newBrand()"
                (input)="newBrand.set(asStr($event))"
                placeholder="Brand name (required, e.g. Dolo 650 Tablet)"
                class="w-full rounded-lg border border-line bg-bg px-3 py-2 text-xs text-fg focus:border-amber focus:outline-none"
              />
              <div class="grid grid-cols-3 gap-2">
                <input
                  type="text"
                  [value]="newSalt()"
                  (input)="newSalt.set(asStr($event))"
                  placeholder="Salt compound"
                  class="col-span-2 rounded-lg border border-line bg-bg px-3 py-2 text-xs text-fg focus:border-amber focus:outline-none"
                />
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  [value]="newMrp()"
                  (input)="newMrp.set(asStr($event))"
                  placeholder="MRP ₹"
                  class="rounded-lg border border-line bg-bg px-3 py-2 font-mono text-xs text-fg focus:border-amber focus:outline-none"
                />
              </div>

              <div class="grid grid-cols-3 gap-2">
                <select
                  [value]="newUnit()"
                  (change)="onNewUnitChange(asStr($event))"
                  class="rounded-lg border border-line bg-bg px-2 py-2 font-mono text-xs text-fg"
                >
                  <option value="UNASSIGNED">Inbox (Unslotted)</option>
                  @for (u of store.layout(); track u.unit_id) {
                    <option [value]="u.unit_id">{{ u.unit_id }}</option>
                  }
                </select>
                @if (newUnit() !== 'UNASSIGNED') {
                  <select
                    [value]="newRow()"
                    (change)="onNewRowChange(asNum($event))"
                    class="rounded-lg border border-line bg-bg px-2 py-2 font-mono text-xs text-fg"
                  >
                    @for (r of rowsFor(newUnit()); track r) {
                      <option [value]="r">R{{ r }}</option>
                    }
                  </select>
                  <select
                    [value]="newCol()"
                    (change)="newCol.set(asNum($event))"
                    class="rounded-lg border border-line bg-bg px-2 py-2 font-mono text-xs text-fg"
                  >
                    @for (c of colsFor(newUnit(), newRow()); track c) {
                      <option [value]="c">C{{ c }}</option>
                    }
                  </select>
                }
              </div>

              <button
                type="submit"
                [disabled]="!newBrand().trim() || store.mutating()"
                class="rf-pill-ok w-full rounded-lg py-2 text-xs font-bold hover:opacity-90 disabled:opacity-40"
              >
                Add Medicine
              </button>
            </form>
          </section>
        </div>
      }

      @if (subTab() === 'layout') {
        <div class="space-y-4">
          <section class="rounded-xl border border-line bg-surface p-4">
            <div class="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h3 class="text-sm font-bold text-fg">Single-Swoop Walk Order &amp; Jagged Shelf Editor</h3>
                <p class="mt-0.5 text-xs text-muted">
                  Reorder racks to match physical counter proximity. Changes write atomically to <span class="font-mono">data/layout.json</span> and re-route Pick Slips immediately.
                </p>
              </div>

              <div class="flex items-center gap-2">
                <button
                  type="button"
                  (click)="resetLayoutDraft()"
                  [disabled]="!layoutDirty() || store.mutating()"
                  class="rounded-lg border border-line bg-bg px-3 py-1.5 text-xs text-muted hover:text-fg disabled:opacity-40"
                >
                  Discard
                </button>
                <button
                  type="button"
                  (click)="submitLayout()"
                  [disabled]="!layoutDirty() || store.mutating()"
                  class="inline-flex items-center gap-1.5 rounded-lg bg-amber px-3.5 py-1.5 text-xs font-bold text-bg hover:opacity-90 disabled:opacity-40"
                >
                  <lucide-icon [img]="SaveIcon" [size]="14" /> Save Layout
                </button>
              </div>
            </div>

            <div class="mt-3 rounded-lg border border-line bg-bg px-3 py-2.5">
              <p class="font-mono text-[10px] uppercase tracking-wider text-muted">Live Pick-Slip Swoop Order</p>
              <div class="mt-1.5 flex flex-wrap items-center gap-1.5">
                @for (u of layoutDraft(); track u.unit_id; let idx = $index; let last = $last) {
                  <span class="rf-pill-ok rounded px-2 py-0.5 font-mono text-xs font-semibold">
                    {{ idx + 1 }}. {{ u.unit_id }} · {{ u.name }}
                  </span>
                  @if (!last) {
                    <lucide-icon [img]="ArrowRightIcon" [size]="13" class="text-muted" />
                  }
                }
              </div>
            </div>

            <p class="mt-2.5 text-[11px] text-muted">
              Note: 1-Click Undo restores <span class="font-mono">data/data.csv</span> inventory snapshots only. Layout edits are occupancy-checked and written directly to <span class="font-mono">data/layout.json</span>.
            </p>
          </section>

          <div class="space-y-3">
            @for (unit of layoutDraft(); track unit.unit_id; let idx = $index) {
              <section class="rounded-xl border border-line bg-surface p-4">
                <div class="flex flex-wrap items-center justify-between gap-2 border-b border-line pb-3">
                  <div class="flex flex-wrap items-center gap-2">
                    <span class="rounded border border-amber bg-bg px-2 py-0.5 font-mono text-xs font-bold text-amber">
                      {{ unit.unit_id }}
                    </span>
                    <span class="font-mono text-xs text-muted">walk_order: {{ (idx + 1) * 100 }}</span>
                    <span class="rounded border border-line bg-bg px-2 py-0.5 font-mono text-[11px] text-muted">
                      {{ unitItemCount(unit.unit_id) }} slotted
                    </span>
                  </div>

                  <div class="flex items-center gap-1.5">
                    <button
                      type="button"
                      (click)="moveUnitOrder(idx, -1)"
                      [disabled]="idx === 0"
                      class="rounded-md border border-line bg-bg p-1.5 text-muted hover:border-amber hover:text-amber disabled:opacity-30"
                      title="Move closer to counter"
                    >
                      <lucide-icon [img]="ArrowUpIcon" [size]="14" />
                    </button>
                    <button
                      type="button"
                      (click)="moveUnitOrder(idx, 1)"
                      [disabled]="idx === layoutDraft().length - 1"
                      class="rounded-md border border-line bg-bg p-1.5 text-muted hover:border-amber hover:text-amber disabled:opacity-30"
                      title="Move farther from counter"
                    >
                      <lucide-icon [img]="ArrowDownIcon" [size]="14" />
                    </button>
                    <button
                      type="button"
                      (click)="removeDraftUnit(idx)"
                      [disabled]="unitItemCount(unit.unit_id) > 0 || layoutDraft().length <= 1"
                      class="rounded-md border border-line bg-bg p-1.5 text-muted hover:border-warn hover:text-warn disabled:opacity-30"
                      [title]="unitItemCount(unit.unit_id) > 0 ? 'Move medicines out of this unit first' : 'Delete unit'"
                    >
                      <lucide-icon [img]="TrashIcon" [size]="14" />
                    </button>
                  </div>
                </div>

                <div class="mt-3 grid gap-2.5 sm:grid-cols-2">
                  <div>
                    <label class="block text-[11px] text-muted">Display Name</label>
                    <input
                      type="text"
                      [value]="unit.name"
                      (input)="updateDraftUnitField(idx, 'name', asStr($event))"
                      class="mt-1 w-full rounded-lg border border-line bg-bg px-2.5 py-1.5 text-xs text-fg focus:border-amber focus:outline-none"
                    />
                  </div>
                  <div>
                    <label class="block text-[11px] text-muted">Anchor Rule (shown to floor helpers)</label>
                    <input
                      type="text"
                      [value]="unit.anchor_rule"
                      (input)="updateDraftUnitField(idx, 'anchor_rule', asStr($event))"
                      class="mt-1 w-full rounded-lg border border-line bg-bg px-2.5 py-1.5 font-mono text-xs text-fg focus:border-amber focus:outline-none"
                    />
                  </div>
                </div>

                <div class="mt-3 space-y-2">
                  <div class="flex items-center justify-between">
                    <span class="text-[11px] font-semibold text-muted">Shelf Rows (Jagged Column Widths)</span>
                    <div class="flex items-center gap-1.5">
                      <button
                        type="button"
                        (click)="removeDraftRow(idx)"
                        [disabled]="!canRemoveLastRow(unit)"
                        class="inline-flex items-center gap-1 rounded border border-line bg-bg px-2 py-1 text-[11px] text-muted hover:border-warn hover:text-warn disabled:opacity-30"
                      >
                        <lucide-icon [img]="MinusIcon" [size]="11" /> Row
                      </button>
                      <button
                        type="button"
                        (click)="addDraftRow(idx)"
                        class="inline-flex items-center gap-1 rounded border border-line bg-bg px-2 py-1 text-[11px] text-muted hover:border-ok hover:text-ok"
                      >
                        <lucide-icon [img]="PlusIcon" [size]="11" /> Row
                      </button>
                    </div>
                  </div>

                  <div class="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                    @for (width of unit.row_widths; track $index; let rIdx = $index) {
                      <div class="flex items-center justify-between gap-2 rounded-lg border border-line bg-bg px-2.5 py-1.5">
                        <div>
                          <span class="font-mono text-xs font-bold text-fg">Row {{ rIdx + 1 }}</span>
                          @if (maxOccupiedCol(unit.unit_id, rIdx + 1) > 0) {
                            <span class="ml-1.5 font-mono text-[10px] text-amber">
                              used ≤ C{{ maxOccupiedCol(unit.unit_id, rIdx + 1) }}
                            </span>
                          }
                        </div>

                        <div class="inline-flex items-center gap-1.5">
                          <button
                            type="button"
                            (click)="adjustRowWidth(idx, rIdx, -1)"
                            [disabled]="width <= Math.max(1, maxOccupiedCol(unit.unit_id, rIdx + 1))"
                            class="rounded border border-line bg-surface p-1 text-muted hover:text-fg disabled:opacity-30"
                          >
                            <lucide-icon [img]="MinusIcon" [size]="11" />
                          </button>
                          <span class="min-w-[44px] text-center font-mono text-xs text-fg">
                            {{ width }} col{{ width === 1 ? '' : 's' }}
                          </span>
                          <button
                            type="button"
                            (click)="adjustRowWidth(idx, rIdx, 1)"
                            class="rounded border border-line bg-surface p-1 text-muted hover:text-fg"
                          >
                            <lucide-icon [img]="PlusIcon" [size]="11" />
                          </button>
                        </div>
                      </div>
                    }
                  </div>
                </div>
              </section>
            }
          </div>

          <section class="rounded-xl border border-line bg-surface p-4">
            <h4 class="flex items-center gap-1.5 text-xs font-bold text-fg">
              <lucide-icon [img]="PlusIcon" [size]="14" class="text-ok" />
              Add New Storage Unit
            </h4>
            <form (submit)="addDraftUnit($event)" class="mt-2.5 grid gap-2 sm:grid-cols-4">
              <input
                type="text"
                [value]="addUnitId()"
                (input)="addUnitId.set(asStr($event))"
                placeholder="ID (e.g. W2)"
                class="rounded-lg border border-line bg-bg px-2.5 py-1.5 font-mono text-xs uppercase text-fg focus:border-amber focus:outline-none"
              />
              <input
                type="text"
                [value]="addUnitName()"
                (input)="addUnitName.set(asStr($event))"
                placeholder="Name (e.g. Right Wall Rack)"
                class="rounded-lg border border-line bg-bg px-2.5 py-1.5 text-xs text-fg focus:border-amber focus:outline-none"
              />
              <input
                type="text"
                [value]="addUnitAnchor()"
                (input)="addUnitAnchor.set(asStr($event))"
                placeholder="Anchor rule"
                class="rounded-lg border border-line bg-bg px-2.5 py-1.5 text-xs text-fg focus:border-amber focus:outline-none"
              />
              <button
                type="submit"
                [disabled]="!addUnitId().trim()"
                class="rf-pill-ok rounded-lg px-3 py-1.5 text-xs font-bold hover:opacity-90 disabled:opacity-40"
              >
                Add to Draft
              </button>
            </form>
          </section>
        </div>
      }

      @if (subTab() === 'inbox') {
        <div class="grid gap-4 lg:grid-cols-12">
          <section class="rounded-xl border border-line bg-surface p-4 lg:col-span-5">
            <h3 class="flex items-center gap-1.5 text-sm font-bold text-fg">
              <lucide-icon [img]="UploadIcon" [size]="15" class="text-amber" />
              Distributor CSV Import
            </h3>
            <p class="mt-0.5 text-xs text-muted">
              Accepts <span class="font-mono">brand_name / name</span>, <span class="font-mono">salt_compound / composition</span>, and <span class="font-mono">mrp_inr / mrp</span>. Rows without coordinates enter the Lazy-Slotting Inbox.
            </p>

            <div class="mt-3 space-y-3">
              <label class="flex cursor-pointer items-center justify-center gap-2 rounded-lg border border-dashed border-line bg-bg px-3 py-3 text-xs text-muted hover:border-amber hover:text-amber">
                <lucide-icon [img]="UploadIcon" [size]="15" />
                <span>Load local .csv file (100% offline)</span>
                <input
                  type="file"
                  accept=".csv,text/csv"
                  (change)="onCsvFilePicked($event)"
                  class="hidden"
                />
              </label>

              <textarea
                rows="6"
                [value]="csvDraft()"
                (input)="csvDraft.set(asStr($event))"
                placeholder="name,composition,mrp&#10;Dolo 650 Tablet,Paracetamol (650mg),33.76&#10;Pan-D Capsule,Pantoprazole (40mg) + Domperidone (30mg),199.00"
                class="w-full rounded-lg border border-line bg-bg p-2.5 font-mono text-xs text-fg focus:border-amber focus:outline-none"
              ></textarea>

              <button
                type="button"
                (click)="submitImport()"
                [disabled]="!csvDraft().trim() || store.mutating()"
                class="w-full rounded-lg bg-amber py-2 text-xs font-bold text-bg hover:opacity-90 disabled:opacity-40"
              >
                Import into Lazy-Slotting Inbox
              </button>

              @if (lastImport(); as res) {
                <div class="rf-pill-ok rounded-lg p-2.5 text-xs">
                  Imported <strong>{{ res.addedCount }}</strong> item(s), skipped <strong>{{ res.skippedDuplicates }}</strong> duplicate(s).
                </div>
              }
            </div>
          </section>

          <section class="rounded-xl border border-line bg-surface p-4 lg:col-span-7">
            <h3 class="mb-3 flex items-center gap-1.5 text-sm font-bold text-fg">
              <lucide-icon [img]="InboxIcon" [size]="15" class="text-amber" />
              Lazy-Slotting Inbox ({{ unassignedItems().length }} Waiting)
            </h3>

            @if (unassignedItems().length === 0) {
              <p class="py-6 text-center text-xs text-muted">
                All medicines are slotted on physical racks. Import a distributor CSV on the left to test lazy slotting.
              </p>
            } @else {
              <div class="max-h-[420px] space-y-2.5 overflow-y-auto pr-1">
                @for (item of unassignedItems(); track item.item_id) {
                  <div class="rounded-lg border border-line bg-bg p-3">
                    <div class="flex flex-wrap items-baseline justify-between gap-2">
                      <div>
                        <span class="text-sm font-semibold text-fg">{{ item.brand_name }}</span>
                        <span class="ml-1.5 font-mono text-[11px] text-muted">{{ item.item_id }}</span>
                      </div>
                      @if (item.mrp_inr !== null) {
                        <span class="font-mono text-xs text-muted">₹{{ item.mrp_inr.toFixed(2) }}</span>
                      }
                    </div>
                    <p class="mt-0.5 text-xs text-muted">{{ item.salt_compound || 'No salt recorded' }}</p>

                    <div class="mt-2.5 flex flex-wrap items-center gap-2">
                      <select
                        [value]="inboxTarget(item.item_id).unit_id"
                        (change)="setInboxUnit(item.item_id, asStr($event))"
                        class="rounded border border-line bg-surface px-2 py-1 font-mono text-xs text-fg"
                      >
                        @for (u of store.layout(); track u.unit_id) {
                          <option [value]="u.unit_id">{{ u.unit_id }}</option>
                        }
                      </select>
                      <select
                        [value]="inboxTarget(item.item_id).row"
                        (change)="setInboxRow(item.item_id, asNum($event))"
                        class="rounded border border-line bg-surface px-2 py-1 font-mono text-xs text-fg"
                      >
                        @for (r of rowsFor(inboxTarget(item.item_id).unit_id); track r) {
                          <option [value]="r">R{{ r }}</option>
                        }
                      </select>
                      <select
                        [value]="inboxTarget(item.item_id).col"
                        (change)="setInboxCol(item.item_id, asNum($event))"
                        class="rounded border border-line bg-surface px-2 py-1 font-mono text-xs text-fg"
                      >
                        @for (c of colsFor(inboxTarget(item.item_id).unit_id, inboxTarget(item.item_id).row); track c) {
                          <option [value]="c">C{{ c }}</option>
                        }
                      </select>
                      <button
                        type="button"
                        (click)="slotInboxItem(item.item_id)"
                        [disabled]="store.mutating()"
                        class="rf-pill-ok ml-auto rounded-md px-3 py-1 text-xs font-semibold hover:opacity-90"
                      >
                        Slot Now
                      </button>
                    </div>
                  </div>
                }
              </div>
            }
          </section>
        </div>
      }

      @if (subTab() === 'audit') {
        <section class="rounded-xl border border-line bg-surface p-4">
          <div class="mb-3 flex flex-wrap items-center justify-between gap-2">
            <div>
              <h3 class="text-sm font-bold text-fg">Audit Log &amp; Snapshot Recovery</h3>
              <p class="text-xs text-muted">
                Every CSV mutation writes a byte-exact snapshot before replacing <span class="font-mono">data/data.csv</span>.
              </p>
            </div>
            <button
              type="button"
              (click)="handleUndo()"
              [disabled]="store.backupCount() === 0 || store.mutating()"
              class="rf-pill-amber inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 font-mono text-xs font-bold hover:opacity-90 disabled:opacity-40"
            >
              <lucide-icon [img]="UndoIcon" [size]="14" />
              1-Click Undo ({{ store.backupCount() }} snapshot{{ store.backupCount() === 1 ? '' : 's' }})
            </button>
          </div>

          @if (store.auditEntries().length === 0) {
            <p class="py-6 text-center text-xs text-muted">
              No mutations recorded yet. Flag an item, reorder a rack, or import a CSV to see entries here.
            </p>
          } @else {
            <div class="max-h-[420px] space-y-2 overflow-y-auto pr-1">
              @for (entry of store.auditEntries(); track $index) {
                <div class="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-line bg-bg px-3 py-2 text-xs">
                  <div class="min-w-0 flex-1">
                    <div class="flex flex-wrap items-center gap-2">
                      <span
                        class="rounded px-1.5 py-0.5 font-mono text-[10px] font-bold"
                        [class.rf-pill-ok]="entry.role === 'moderator'"
                        [class.rf-pill-amber]="entry.role === 'staff'"
                      >
                        {{ entry.action }}
                      </span>
                      <span class="font-semibold text-fg">{{ entry.summary }}</span>
                    </div>
                    <p class="mt-0.5 font-mono text-[11px] text-muted">
                      {{ entry.actor }} ({{ entry.role }})
                      @if (entry.snapshot) {
                        <span> · backup: {{ entry.snapshot }}</span>
                      }
                    </p>
                  </div>
                  <span class="font-mono text-[11px] text-muted">
                    {{ formatTime(entry.timestamp) }}
                  </span>
                </div>
              }
            </div>
          }
        </section>
      }
    </div>
  `,
})
export class ModeratorOpsComponent implements OnInit {
  readonly store = inject(RackFlowStore);
  readonly requestUnlock = output<void>();
  readonly Math = Math;

  readonly subTab = signal<OpsSubTab>('radar');

  readonly moveItemId = signal<string>('');
  readonly moveUnit = signal<string>('W1');
  readonly moveRow = signal<number>(1);
  readonly moveCol = signal<number>(1);

  readonly swapAUnit = signal<string>('W1');
  readonly swapARow = signal<number>(1);
  readonly swapACol = signal<number>(1);
  readonly swapBUnit = signal<string>('W1');
  readonly swapBRow = signal<number>(1);
  readonly swapBCol = signal<number>(2);

  readonly shiftUnit = signal<string>('W1');
  readonly shiftRowNum = signal<number>(2);
  readonly shiftMode = signal<'promote' | 'insert_gap'>('promote');
  readonly shiftFromCol = signal<number>(4);
  readonly shiftToCol = signal<number>(1);

  readonly newBrand = signal<string>('');
  readonly newSalt = signal<string>('');
  readonly newMrp = signal<string>('');
  readonly newUnit = signal<string>('UNASSIGNED');
  readonly newRow = signal<number>(1);
  readonly newCol = signal<number>(1);

  readonly layoutDraft = signal<UnitLayout[]>([]);
  readonly layoutDirty = signal<boolean>(false);
  readonly addUnitId = signal<string>('');
  readonly addUnitName = signal<string>('');
  readonly addUnitAnchor = signal<string>('');

  readonly csvDraft = signal<string>('');
  readonly lastImport = signal<ImportCsvResponse | null>(null);
  private readonly inboxTargets = signal<Record<string, CellCoord>>({});

  readonly RadarIcon = Activity;
  readonly WrenchIcon = Wrench;
  readonly LayoutIcon = LayoutGrid;
  readonly InboxIcon = Inbox;
  readonly HistoryIcon = History;
  readonly RefreshIcon = RefreshCw;
  readonly FlagIcon = Flag;
  readonly CheckIcon = CheckCircle2;
  readonly ClockIcon = Clock;
  readonly ArrowRightIcon = ArrowRight;
  readonly ArrowUpIcon = ArrowUp;
  readonly ArrowDownIcon = ArrowDown;
  readonly LayersIcon = Layers;
  readonly AlertIcon = AlertTriangle;
  readonly SwapIcon = ArrowLeftRight;
  readonly PlusIcon = Plus;
  readonly MinusIcon = Minus;
  readonly SaveIcon = Save;
  readonly TrashIcon = Trash2;
  readonly UploadIcon = Upload;
  readonly UndoIcon = Undo2;
  readonly LockIcon = Lock;

  readonly slowThreshold = computed(
    () => this.store.config()?.thresholds?.['SLOW_FIND_THRESHOLD_SEC'] ?? 15,
  );

  readonly sortedItems = computed(() =>
    [...this.store.items()].sort((a, b) => a.brand_name.localeCompare(b.brand_name)),
  );

  readonly unassignedItems = computed(() =>
    this.store.items().filter((i) => i.status === 'UNASSIGNED' || i.row === null || i.col === null),
  );

  readonly occupancyByUnit = computed(() => {
    const map = new Map<string, UnitOccupancy>();
    for (const item of this.store.items()) {
      if (item.unit_id === 'UNASSIGNED' || item.row === null || item.col === null) continue;
      let occ = map.get(item.unit_id);
      if (!occ) {
        occ = { totalItems: 0, maxRow: 0, maxColByRow: new Map() };
        map.set(item.unit_id, occ);
      }
      occ.totalItems++;
      if (item.row > occ.maxRow) occ.maxRow = item.row;
      const prevCol = occ.maxColByRow.get(item.row) ?? 0;
      if (item.col > prevCol) occ.maxColByRow.set(item.row, item.col);
    }
    return map;
  });

  constructor() {
    effect(() => {
      const live = this.store.layout();
      if (!this.layoutDirty()) {
        this.layoutDraft.set(this.cloneSortedLayout(live));
      }
    });
  }

  ngOnInit(): void {
    this.store.refreshOpsData();
  }

  private cloneSortedLayout(units: readonly UnitLayout[]): UnitLayout[] {
    return [...units]
      .sort((a, b) => a.walk_order - b.walk_order || a.unit_id.localeCompare(b.unit_id))
      .map((u) => ({ ...u, row_widths: [...u.row_widths] }));
  }

  private ensureUnlocked(): boolean {
    if (this.store.moderatorUnlocked()) return true;
    this.requestUnlock.emit();
    return false;
  }

  asStr(event: Event): string {
    return (event.target as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement).value;
  }

  asNum(event: Event): number {
    return Number((event.target as HTMLSelectElement).value) || 1;
  }

  rowsFor(unitId: string): number[] {
    const unit = this.store.layout().find((u) => u.unit_id === unitId);
    const count = unit ? unit.row_widths.length : 1;
    return Array.from({ length: Math.max(1, count) }, (_, i) => i + 1);
  }

  colsFor(unitId: string, row: number): number[] {
    const unit = this.store.layout().find((u) => u.unit_id === unitId);
    const width = unit ? (unit.row_widths[row - 1] ?? 1) : 1;
    return Array.from({ length: Math.max(1, width) }, (_, i) => i + 1);
  }

  binPreview(unitId: string, row: number, col: number): string {
    const brands = this.store
      .items()
      .filter((i) => i.unit_id === unitId && i.row === row && i.col === col)
      .map((i) => i.brand_name);
    return brands.length > 0 ? brands.join(', ') : '(empty bin)';
  }

  openLayoutTab(): void {
    if (!this.layoutDirty()) {
      this.layoutDraft.set(this.cloneSortedLayout(this.store.layout()));
    }
    this.subTab.set('layout');
  }

  resetLayoutDraft(): void {
    this.layoutDraft.set(this.cloneSortedLayout(this.store.layout()));
    this.layoutDirty.set(false);
  }

  unitItemCount(unitId: string): number {
    return this.occupancyByUnit().get(unitId)?.totalItems ?? 0;
  }

  maxOccupiedCol(unitId: string, row: number): number {
    return this.occupancyByUnit().get(unitId)?.maxColByRow.get(row) ?? 0;
  }

  canRemoveLastRow(unit: UnitLayout): boolean {
    if (unit.row_widths.length <= 1) return false;
    const maxRow = this.occupancyByUnit().get(unit.unit_id)?.maxRow ?? 0;
    return unit.row_widths.length > maxRow;
  }

  moveUnitOrder(index: number, delta: -1 | 1): void {
    const target = index + delta;
    const list = this.layoutDraft().map((u) => ({ ...u, row_widths: [...u.row_widths] }));
    if (target < 0 || target >= list.length) return;
    [list[index], list[target]] = [list[target], list[index]];
    list.forEach((u, i) => (u.walk_order = (i + 1) * 100));
    this.layoutDraft.set(list);
    this.layoutDirty.set(true);
  }

  updateDraftUnitField(index: number, field: 'name' | 'anchor_rule', value: string): void {
    const list = this.layoutDraft().map((u, i) =>
      i === index ? { ...u, [field]: value } : u,
    );
    this.layoutDraft.set(list);
    this.layoutDirty.set(true);
  }

  adjustRowWidth(unitIndex: number, rowIndex: number, delta: -1 | 1): void {
    const list = this.layoutDraft().map((u, i) => {
      if (i !== unitIndex) return u;
      const widths = [...u.row_widths];
      const minWidth = Math.max(1, this.maxOccupiedCol(u.unit_id, rowIndex + 1));
      widths[rowIndex] = Math.min(200, Math.max(minWidth, widths[rowIndex] + delta));
      return { ...u, row_widths: widths };
    });
    this.layoutDraft.set(list);
    this.layoutDirty.set(true);
  }

  addDraftRow(unitIndex: number): void {
    const list = this.layoutDraft().map((u, i) => {
      if (i !== unitIndex) return u;
      const lastWidth = u.row_widths[u.row_widths.length - 1] ?? 1;
      return { ...u, row_widths: [...u.row_widths, lastWidth] };
    });
    this.layoutDraft.set(list);
    this.layoutDirty.set(true);
  }

  removeDraftRow(unitIndex: number): void {
    const list = this.layoutDraft().map((u, i) => {
      if (i !== unitIndex || !this.canRemoveLastRow(u)) return u;
      return { ...u, row_widths: u.row_widths.slice(0, -1) };
    });
    this.layoutDraft.set(list);
    this.layoutDirty.set(true);
  }

  removeDraftUnit(unitIndex: number): void {
    const target = this.layoutDraft()[unitIndex];
    if (!target || this.unitItemCount(target.unit_id) > 0 || this.layoutDraft().length <= 1) return;
    const next = this.layoutDraft()
      .filter((_, i) => i !== unitIndex)
      .map((u, i) => ({ ...u, walk_order: (i + 1) * 100 }));
    this.layoutDraft.set(next);
    this.layoutDirty.set(true);
  }

  addDraftUnit(event: Event): void {
    event.preventDefault();
    const id = this.addUnitId().trim().toUpperCase();
    if (!id || id === 'UNASSIGNED' || !/^[A-Z0-9_-]{1,12}$/.test(id)) {
      this.store.notify('warn', 'Unit ID must be 1–12 letters/numbers (e.g. W2, C1).');
      return;
    }
    if (this.layoutDraft().some((u) => u.unit_id === id)) {
      this.store.notify('warn', `Unit "${id}" already exists in layout.`);
      return;
    }

    const next = [
      ...this.layoutDraft(),
      {
        unit_id: id,
        name: this.addUnitName().trim() || id,
        walk_order: (this.layoutDraft().length + 1) * 100,
        anchor_rule: this.addUnitAnchor().trim() || 'Row 1 = Top Shelf | Col 1 = Closest to Counter',
        row_widths: [4],
      },
    ];
    this.layoutDraft.set(next);
    this.layoutDirty.set(true);
    this.addUnitId.set('');
    this.addUnitName.set('');
    this.addUnitAnchor.set('');
  }

  async submitLayout(): Promise<void> {
    if (!this.ensureUnlocked()) return;
    const normalized = this.layoutDraft().map((u, i) => ({
      ...u,
      walk_order: (i + 1) * 100,
    }));
    const ok = await this.store.saveLayout(normalized);
    if (ok) {
      this.layoutDirty.set(false);
    }
  }

  onMoveUnitChange(u: string): void {
    this.moveUnit.set(u);
    this.moveRow.set(1);
    this.moveCol.set(1);
  }

  onMoveRowChange(r: number): void {
    this.moveRow.set(r);
    this.moveCol.set(1);
  }

  onSwapAUnitChange(u: string): void {
    this.swapAUnit.set(u);
    this.swapARow.set(1);
    this.swapACol.set(1);
  }

  onSwapARowChange(r: number): void {
    this.swapARow.set(r);
    this.swapACol.set(1);
  }

  onSwapBUnitChange(u: string): void {
    this.swapBUnit.set(u);
    this.swapBRow.set(1);
    this.swapBCol.set(1);
  }

  onSwapBRowChange(r: number): void {
    this.swapBRow.set(r);
    this.swapBCol.set(1);
  }

  onShiftUnitChange(u: string): void {
    this.shiftUnit.set(u);
    this.shiftRowNum.set(1);
    this.shiftFromCol.set(1);
    this.shiftToCol.set(1);
  }

  onShiftRowChange(r: number): void {
    this.shiftRowNum.set(r);
    this.shiftFromCol.set(1);
    this.shiftToCol.set(1);
  }

  onNewUnitChange(u: string): void {
    this.newUnit.set(u);
    this.newRow.set(1);
    this.newCol.set(1);
  }

  onNewRowChange(r: number): void {
    this.newRow.set(r);
    this.newCol.set(1);
  }

  jumpToMove(item: MedicineItem): void {
    this.moveItemId.set(item.item_id);
    if (item.unit_id && item.unit_id !== 'UNASSIGNED' && item.row && item.col) {
      this.moveUnit.set(item.unit_id);
      this.moveRow.set(item.row);
      this.moveCol.set(item.col);
    }
    this.subTab.set('mutate');
  }

  async handleVerify(item: MedicineItem): Promise<void> {
    if (!this.ensureUnlocked()) return;
    await this.store.verifyItem(item);
  }

  async promoteCandidate(cand: RelocationCandidate): Promise<void> {
    if (!this.ensureUnlocked()) return;
    await this.store.shiftRow({
      unit_id: cand.unit_id,
      row: cand.row,
      fromCol: cand.col,
      toCol: 1,
      mode: 'promote',
    });
  }

  async submitMove(event: Event): Promise<void> {
    event.preventDefault();
    if (!this.ensureUnlocked() || !this.moveItemId()) return;
    const isUnassigned = this.moveUnit() === 'UNASSIGNED';
    await this.store.moveItems([this.moveItemId()], {
      unit_id: this.moveUnit(),
      row: isUnassigned ? null : this.moveRow(),
      col: isUnassigned ? null : this.moveCol(),
    });
  }

  async submitSwap(event: Event): Promise<void> {
    event.preventDefault();
    if (!this.ensureUnlocked()) return;
    await this.store.swapBins(
      { unit_id: this.swapAUnit(), row: this.swapARow(), col: this.swapACol() },
      { unit_id: this.swapBUnit(), row: this.swapBRow(), col: this.swapBCol() },
    );
  }

  async submitShift(event: Event): Promise<void> {
    event.preventDefault();
    if (!this.ensureUnlocked()) return;
    await this.store.shiftRow({
      unit_id: this.shiftUnit(),
      row: this.shiftRowNum(),
      fromCol: this.shiftFromCol(),
      toCol: this.shiftMode() === 'promote' ? this.shiftToCol() : undefined,
      mode: this.shiftMode(),
    });
  }

  async submitCreate(event: Event): Promise<void> {
    event.preventDefault();
    if (!this.ensureUnlocked() || !this.newBrand().trim()) return;
    const isUnassigned = this.newUnit() === 'UNASSIGNED';
    const mrpVal = this.newMrp().trim() === '' ? null : Number(this.newMrp());
    const ok = await this.store.createMedicine({
      brand_name: this.newBrand().trim(),
      salt_compound: this.newSalt().trim(),
      mrp_inr: mrpVal,
      unit_id: this.newUnit(),
      row: isUnassigned ? null : this.newRow(),
      col: isUnassigned ? null : this.newCol(),
    });
    if (ok) {
      this.newBrand.set('');
      this.newSalt.set('');
      this.newMrp.set('');
    }
  }

  async onCsvFilePicked(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    const text = await file.text();
    this.csvDraft.set(text);
    input.value = '';
  }

  async submitImport(): Promise<void> {
    if (!this.ensureUnlocked() || !this.csvDraft().trim()) return;
    const res = await this.store.importDistributorCsv(this.csvDraft(), true);
    if (res) {
      this.lastImport.set(res);
      if (res.addedCount > 0) this.csvDraft.set('');
    }
  }

  inboxTarget(itemId: string): CellCoord {
    const existing = this.inboxTargets()[itemId];
    if (existing) return existing;
    const defaultUnit = this.store.layout()[0]?.unit_id ?? 'W1';
    return { unit_id: defaultUnit, row: 1, col: 1 };
  }

  setInboxUnit(itemId: string, unit_id: string): void {
    this.inboxTargets.update((m) => ({ ...m, [itemId]: { unit_id, row: 1, col: 1 } }));
  }

  setInboxRow(itemId: string, row: number): void {
    const cur = this.inboxTarget(itemId);
    this.inboxTargets.update((m) => ({ ...m, [itemId]: { ...cur, row, col: 1 } }));
  }

  setInboxCol(itemId: string, col: number): void {
    const cur = this.inboxTarget(itemId);
    this.inboxTargets.update((m) => ({ ...m, [itemId]: { ...cur, col } }));
  }

  async slotInboxItem(itemId: string): Promise<void> {
    if (!this.ensureUnlocked()) return;
    const target = this.inboxTarget(itemId);
    await this.store.moveItems([itemId], target);
  }

  async handleUndo(): Promise<void> {
    if (!this.ensureUnlocked()) return;
    await this.store.undoLastChange();
  }

  formatTime(iso: string): string {
    try {
      return new Date(iso).toLocaleTimeString([], {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      });
    } catch {
      return iso;
    }
  }
}