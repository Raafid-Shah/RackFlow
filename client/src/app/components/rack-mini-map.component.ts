import { Component, computed, inject, signal } from '@angular/core';
import {
  AlertTriangle,
  Clock,
  Flag,
  LucideAngularModule,
  Plus,
} from 'lucide-angular';
import { CellCoord, MedicineItem } from '../models/rackflow.models';
import { RackFlowStore } from '../services/rackflow.store';

interface CellSummary {
  unit_id: string;
  row: number;
  col: number;
  items: MedicineItem[];
  label: string;
  hasFlagged: boolean;
  hasSlow: boolean;
  routeStopNum: number | null;
  isSpotlight: boolean;
  isSelected: boolean;
}

@Component({
  selector: 'rf-rack-mini-map',
  imports: [LucideAngularModule],
  template: `
    <div class="space-y-4">
      <div class="flex flex-wrap items-center justify-between gap-2 text-xs text-muted">
        <div class="flex flex-wrap items-center gap-3">
          <span class="inline-flex items-center gap-1.5">
            <span class="h-2.5 w-2.5 rounded-sm bg-amber"></span> Spotlight
          </span>
          <span class="inline-flex items-center gap-1.5">
            <span class="h-2.5 w-2.5 rounded-sm bg-ok"></span> Pick Route Stop
          </span>
          <span class="inline-flex items-center gap-1.5">
            <span class="h-2 w-2 rounded-full bg-warn"></span> Flagged / Slow (&gt;{{ slowThreshold() }}s)
          </span>
        </div>
        @if (store.spotlightBrand(); as brand) {
          <span class="font-mono text-amber">Spotlight: {{ brand }}</span>
        }
      </div>

      <div class="grid gap-4 lg:grid-cols-1">
        @for (unit of sortedUnits(); track unit.unit_id) {
          <section class="rounded-xl border border-line bg-surface p-3 sm:p-4">
            <header class="mb-3 flex flex-wrap items-baseline justify-between gap-2">
              <div class="flex items-center gap-2">
                <span class="rounded bg-bg px-2 py-0.5 font-mono text-xs font-bold text-amber border border-line">
                  {{ unit.unit_id }}
                </span>
                <h3 class="text-sm font-semibold text-fg">{{ unit.name }}</h3>
              </div>
              <p class="font-mono text-[11px] text-muted">{{ unit.anchor_rule }}</p>
            </header>

            <div class="space-y-2">
              @for (rowCells of unitRows(unit.unit_id, unit.row_widths); track $index) {
                <div class="flex items-center gap-2">
                  <span class="w-7 shrink-0 font-mono text-[11px] text-muted">R{{ $index + 1 }}</span>
                  <div
                    class="grid flex-1 gap-1.5"
                    [style.gridTemplateColumns]="'repeat(' + rowCells.length + ', minmax(0, 1fr))'"
                  >
                    @for (cell of rowCells; track cell.col) {
                      <button
                        type="button"
                        (click)="selectCell(cell)"
                        class="relative flex min-h-[52px] flex-col items-start justify-between rounded-lg border border-line bg-bg p-1.5 text-left transition hover:border-amber focus:outline-none"
                        [class.rf-spotlight]="cell.isSpotlight"
                        [class.rf-route-cell]="!cell.isSpotlight && cell.routeStopNum !== null"
                        [class.ring-2]="cell.isSelected"
                        [class.ring-amber]="cell.isSelected"
                      >
                        <div class="flex w-full items-center justify-between gap-1">
                          <span class="font-mono text-[10px] text-muted">C{{ cell.col }}</span>
                          @if (cell.routeStopNum !== null) {
                            <span class="rounded bg-ok px-1 font-mono text-[10px] font-bold text-bg">
                              #{{ cell.routeStopNum }}
                            </span>
                          } @else if (cell.hasFlagged || cell.hasSlow) {
                            <span class="h-1.5 w-1.5 rounded-full bg-warn"></span>
                          }
                        </div>

                        <div class="w-full truncate font-mono text-xs font-semibold text-fg">
                          {{ cell.label }}
                        </div>

                        <span class="font-mono text-[10px] text-muted">
                          {{ cell.items.length }} {{ cell.items.length === 1 ? 'item' : 'items' }}
                        </span>
                      </button>
                    }
                  </div>
                </div>
              }
            </div>
          </section>
        }
      </div>

      @if (inspectedCoord(); as coord) {
        <section class="rounded-xl border border-amber bg-surface p-4">
          <div class="mb-3 flex items-center justify-between gap-2">
            <div>
              <span class="font-mono text-sm font-bold text-amber">
                {{ coord.unit_id }} · R{{ coord.row }} · C{{ coord.col }}
              </span>
              <span class="ml-2 text-xs text-muted">
                {{ inspectedItems().length }} medicine(s) in this bin
              </span>
            </div>
            <button
              type="button"
              (click)="selectedCoord.set(null)"
              class="text-xs text-muted hover:text-fg"
            >
              Close
            </button>
          </div>

          @if (inspectedItems().length === 0) {
            <p class="text-xs text-muted">Empty container.</p>
          } @else {
            <div class="space-y-2">
              @for (med of inspectedItems(); track med.item_id) {
                <div class="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-line bg-bg px-3 py-2">
                  <div class="min-w-0 flex-1">
                    <div class="flex flex-wrap items-center gap-2">
                      <span class="text-sm font-semibold text-fg">{{ med.brand_name }}</span>
                      @if (med.status === 'FLAGGED_MISSING') {
                        <span class="rf-pill-warn inline-flex items-center gap-1 rounded px-1.5 py-0.5 font-mono text-[10px]">
                          <lucide-icon [img]="AlertIcon" [size]="11" /> NOT HERE
                        </span>
                      }
                      @if (med.find_time_sec !== null && med.find_time_sec > slowThreshold()) {
                        <span class="rf-pill-amber inline-flex items-center gap-1 rounded px-1.5 py-0.5 font-mono text-[10px]">
                          <lucide-icon [img]="ClockIcon" [size]="11" /> {{ med.find_time_sec }}s
                        </span>
                      }
                    </div>
                    <p class="truncate text-xs text-muted">{{ med.salt_compound || 'No salt recorded' }}</p>
                  </div>

                  <div class="flex items-center gap-1.5">
                    <button
                      type="button"
                      (click)="store.addToCart(med)"
                      class="rf-pill-ok inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-xs font-semibold hover:opacity-90"
                    >
                      <lucide-icon [img]="PlusIcon" [size]="13" /> Pick
                    </button>
                    <button
                      type="button"
                      (click)="store.flagNotHere(med)"
                      class="rounded-md border border-line px-2 py-1 text-xs text-muted hover:border-warn hover:text-warn"
                      title="Flag Not Here"
                    >
                      <lucide-icon [img]="FlagIcon" [size]="13" />
                    </button>
                  </div>
                </div>
              }
            </div>
          }
        </section>
      }
    </div>
  `,
})
export class RackMiniMapComponent {
  readonly store = inject(RackFlowStore);
  readonly selectedCoord = signal<CellCoord | null>(null);

  readonly PlusIcon = Plus;
  readonly FlagIcon = Flag;
  readonly AlertIcon = AlertTriangle;
  readonly ClockIcon = Clock;

  readonly slowThreshold = computed(
    () => this.store.config()?.thresholds?.['SLOW_FIND_THRESHOLD_SEC'] ?? 15,
  );

  readonly sortedUnits = computed(() =>
    [...this.store.layout()].sort((a, b) => a.walk_order - b.walk_order),
  );

  readonly cellIndex = computed(() => {
    const map = new Map<string, MedicineItem[]>();
    for (const item of this.store.items()) {
      if (item.row === null || item.col === null) continue;
      const key = `${item.unit_id}|${item.row}|${item.col}`;
      const list = map.get(key);
      if (list) list.push(item);
      else map.set(key, [item]);
    }
    return map;
  });

  readonly inspectedCoord = computed(() => this.selectedCoord() ?? this.store.spotlightCell());

  readonly inspectedItems = computed(() => {
    const c = this.inspectedCoord();
    if (!c) return [];
    return this.cellIndex().get(`${c.unit_id}|${c.row}|${c.col}`) ?? [];
  });

  unitRows(unitId: string, rowWidths: number[]): CellSummary[][] {
    const idx = this.cellIndex();
    const spot = this.store.spotlightCell();
    const sel = this.selectedCoord();
    const routeKeys = this.store.routeCellKeys();
    const slowLimit = this.slowThreshold();

    return rowWidths.map((width, rIdx) => {
      const row = rIdx + 1;
      const cells: CellSummary[] = [];
      for (let col = 1; col <= width; col++) {
        const key = `${unitId}|${row}|${col}`;
        const items = idx.get(key) ?? [];
        const letters = Array.from(
          new Set(
            items
              .map((i) => i.brand_name.trim().charAt(0).toUpperCase())
              .filter(Boolean),
          ),
        ).sort();
        const label =
          letters.length === 0
            ? '—'
            : letters.length === 1
              ? letters[0]
              : `${letters[0]}–${letters[letters.length - 1]}`;

        cells.push({
          unit_id: unitId,
          row,
          col,
          items,
          label,
          hasFlagged: items.some((i) => i.status === 'FLAGGED_MISSING'),
          hasSlow: items.some((i) => i.find_time_sec !== null && i.find_time_sec > slowLimit),
          routeStopNum: routeKeys.get(key) ?? null,
          isSpotlight: spot?.unit_id === unitId && spot.row === row && spot.col === col,
          isSelected: sel?.unit_id === unitId && sel.row === row && sel.col === col,
        });
      }
      return cells;
    });
  }

  selectCell(cell: CellSummary): void {
    this.selectedCoord.set({ unit_id: cell.unit_id, row: cell.row, col: cell.col });
  }
}