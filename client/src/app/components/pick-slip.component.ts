import { Component, computed, inject } from '@angular/core';
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  LucideAngularModule,
  Minus,
  Plus,
  ShoppingBag,
  Trash2,
} from 'lucide-angular';
import { RackFlowStore } from '../services/rackflow.store';

@Component({
  selector: 'rf-pick-slip',
  imports: [LucideAngularModule],
  template: `
    <aside class="rounded-xl border border-line bg-surface p-4">
      <header class="flex items-center justify-between gap-2 border-b border-line pb-3">
        <div class="flex items-center gap-2">
          <lucide-icon [img]="BagIcon" [size]="18" class="text-ok" />
          <div>
            <h2 class="text-sm font-bold text-fg">Single-Swoop Pick Slip</h2>
            <p class="text-[11px] text-muted">Sorted by rack walk order (no zig-zag)</p>
          </div>
        </div>
        @if (store.cartLines().length > 0) {
          <button
            type="button"
            (click)="store.clearCart()"
            class="inline-flex items-center gap-1 rounded-md border border-line px-2 py-1 text-xs text-muted hover:border-warn hover:text-warn"
          >
            <lucide-icon [img]="TrashIcon" [size]="12" /> Clear
          </button>
        }
      </header>

      @if (store.pickRoute(); as route) {
        <div class="mt-3 space-y-3">
          <div class="rounded-lg border border-line bg-bg p-2.5">
            <div class="flex items-center justify-between text-xs">
              <span class="text-muted">Picked progress</span>
              <span class="font-mono font-semibold text-ok">
                {{ pickedCount() }} / {{ route.lineCount }}
              </span>
            </div>
            <div class="mt-1.5 h-1.5 overflow-hidden rounded-full bg-surface">
              <div
                class="h-full bg-ok transition-all duration-200"
                [style.width.%]="progressPercent()"
              ></div>
            </div>
          </div>

          @for (group of route.groups; track group.unit_id) {
            <div class="space-y-2">
              <div class="flex items-baseline justify-between gap-2">
                <span class="font-mono text-xs font-bold text-amber">
                  {{ group.unit_id }} · {{ group.unit_name }}
                </span>
                <span class="truncate font-mono text-[10px] text-muted">
                  {{ group.anchor_rule }}
                </span>
              </div>

              @for (stop of group.stops; track stop.item.item_id) {
                <div
                  class="rounded-lg border border-line bg-bg p-2.5 transition"
                  [class.opacity-55]="store.pickedIds().has(stop.item.item_id)"
                >
                  <div class="flex items-start gap-2.5">
                    <button
                      type="button"
                      (click)="store.togglePicked(stop.item.item_id)"
                      class="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded border transition"
                      [class.border-ok]="store.pickedIds().has(stop.item.item_id)"
                      [class.bg-ok]="store.pickedIds().has(stop.item.item_id)"
                      [class.text-bg]="store.pickedIds().has(stop.item.item_id)"
                      [class.border-line]="!store.pickedIds().has(stop.item.item_id)"
                    >
                      @if (store.pickedIds().has(stop.item.item_id)) {
                        <lucide-icon [img]="CheckIcon" [size]="13" />
                      }
                    </button>

                    <div
                      class="min-w-0 flex-1 cursor-pointer"
                      (click)="store.focusCell(stop.item)"
                    >
                      <div class="flex flex-wrap items-center justify-between gap-1">
                        <span
                          class="text-sm font-semibold text-fg"
                          [class.line-through]="store.pickedIds().has(stop.item.item_id)"
                        >
                          {{ stop.item.brand_name }}
                        </span>
                        <span class="rf-pill-ok rounded px-1.5 py-0.5 font-mono text-[11px] font-bold">
                          {{ stop.code }}
                        </span>
                      </div>

                      @if (stop.cue?.siblings?.length) {
                        <p class="mt-0.5 truncate text-[11px] text-muted">
                          Same bin: {{ stop.cue!.siblings.join(', ') }}
                        </p>
                      }

                      <div class="mt-2 flex items-center justify-between gap-2">
                        <div class="inline-flex items-center gap-1 rounded border border-line bg-surface px-1 py-0.5">
                          <button
                            type="button"
                            (click)="store.updateCartQty(stop.item.item_id, -1); $event.stopPropagation()"
                            class="p-0.5 text-muted hover:text-fg"
                          >
                            <lucide-icon [img]="MinusIcon" [size]="12" />
                          </button>
                          <span class="min-w-[20px] text-center font-mono text-xs text-fg">
                            {{ stop.qty }}
                          </span>
                          <button
                            type="button"
                            (click)="store.updateCartQty(stop.item.item_id, 1); $event.stopPropagation()"
                            class="p-0.5 text-muted hover:text-fg"
                          >
                            <lucide-icon [img]="PlusIcon" [size]="12" />
                          </button>
                        </div>

                        <span class="font-mono text-xs text-muted">
                          @if (stop.lineTotal !== null) {
                            ₹{{ stop.lineTotal.toFixed(2) }}
                          } @else {
                            <span class="text-amber">MRP blank</span>
                          }
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              }
            </div>
          }

          @if (route.unmapped.length > 0) {
            <div class="rounded-lg border border-line bg-bg p-2.5">
              <p class="font-mono text-xs font-semibold text-warn">
                Unmapped ({{ route.unmapped.length }}) — Check Inbox / New Stock
              </p>
              @for (u of route.unmapped; track u.item.item_id) {
                <div class="mt-1 flex items-center justify-between text-xs">
                  <span class="text-fg">{{ u.item.brand_name }} × {{ u.qty }}</span>
                  <button
                    type="button"
                    (click)="store.updateCartQty(u.item.item_id, -u.qty)"
                    class="text-muted hover:text-warn"
                  >
                    Remove
                  </button>
                </div>
              }
            </div>
          }

          <footer class="border-t border-line pt-3">
            <div class="flex items-baseline justify-between">
              <span class="text-xs text-muted">Counter Estimate (non-GST)</span>
              <span class="font-mono text-lg font-bold text-fg">
                ₹{{ route.subtotalInr.toFixed(2) }}
              </span>
            </div>
            @if (route.missingMrpCount > 0) {
              <p class="mt-1 flex items-center gap-1 text-[11px] text-amber">
                <lucide-icon [img]="AlertIcon" [size]="12" />
                Partial total: {{ route.missingMrpCount }} item(s) have unread MRP.
              </p>
            }
            @if (pickedCount() === route.lineCount && route.lineCount > 0) {
              <p class="mt-2 flex items-center gap-1.5 text-xs font-semibold text-ok">
                <lucide-icon [img]="DoneIcon" [size]="14" /> All items picked! Verify strip expiry at counter.
              </p>
            }
          </footer>
        </div>
      } @else {
        <div class="py-8 text-center text-xs text-muted">
          <p class="font-medium text-fg">Pick Slip is empty</p>
          <p class="mt-1">
            Tap <span class="font-mono text-ok">+ Pick Slip</span> on medicines from a prescription to generate a single-swoop walk route.
          </p>
        </div>
      }
    </aside>
  `,
})
export class PickSlipComponent {
  readonly store = inject(RackFlowStore);

  readonly BagIcon = ShoppingBag;
  readonly TrashIcon = Trash2;
  readonly CheckIcon = Check;
  readonly PlusIcon = Plus;
  readonly MinusIcon = Minus;
  readonly AlertIcon = AlertTriangle;
  readonly DoneIcon = CheckCircle2;

  readonly pickedCount = computed(() => {
    const picked = this.store.pickedIds();
    return this.store.cartLines().filter((l) => picked.has(l.item_id)).length;
  });

  readonly progressPercent = computed(() => {
    const total = this.store.pickRoute()?.lineCount ?? 0;
    if (total === 0) return 0;
    return Math.round((this.pickedCount() / total) * 100);
  });
}