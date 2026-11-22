import { Component, ElementRef, HostListener, ViewChild, inject } from '@angular/core';
import {
  AlertTriangle,
  Clock,
  Flag,
  Layers,
  LucideAngularModule,
  MapPin,
  Plus,
  Search,
  X,
} from 'lucide-angular';
import { SearchHit } from '../models/rackflow.models';
import { RackFlowStore } from '../services/rackflow.store';

@Component({
  selector: 'rf-search-board',
  imports: [LucideAngularModule],
  template: `
    <div class="space-y-4">
      <div class="relative">
        <span class="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-amber">
          <lucide-icon [img]="SearchIcon" [size]="20" />
        </span>
        <input
          #searchInput
          type="search"
          autocomplete="off"
          spellcheck="false"
          [value]="store.query()"
          (input)="onQueryInput($event)"
          placeholder="Search brand, salt, or typo (press / to focus)..."
          class="w-full rounded-xl border border-line bg-surface py-3.5 pl-11 pr-20 text-base text-fg placeholder:text-muted focus:border-amber focus:outline-none"
        />
        @if (store.query()) {
          <button
            type="button"
            (click)="clearAndFocus()"
            class="absolute right-3 top-1/2 -translate-y-1/2 rounded-md border border-line bg-bg px-2 py-1 text-xs text-muted hover:text-fg"
          >
            <lucide-icon [img]="XIcon" [size]="14" />
          </button>
        } @else {
          <kbd
            class="pointer-events-none absolute right-3.5 top-1/2 hidden -translate-y-1/2 rounded border border-line bg-bg px-1.5 py-0.5 font-mono text-[11px] text-muted sm:inline"
          >
            /
          </kbd>
        }
      </div>

      @if (!store.query().trim()) {
        <div class="space-y-3">
          <div class="flex flex-wrap items-center gap-2 text-xs">
            <span class="text-muted">Quick jump:</span>
            @for (sample of quickSamples; track sample) {
              <button
                type="button"
                (click)="store.setQuery(sample)"
                class="rounded-md border border-line bg-surface px-2.5 py-1 font-mono text-xs text-fg hover:border-amber hover:text-amber"
              >
                {{ sample }}
              </button>
            }
          </div>

          <div class="rounded-xl border border-line bg-surface p-5 text-sm text-muted">
            <p class="font-semibold text-fg">Ready for counter lookup</p>
            <p class="mt-1">
              Type a brand prefix (<span class="font-mono text-amber">crocin</span>), active salt
              (<span class="font-mono text-amber">amoxycillin</span>, <span class="font-mono text-amber">telmisartan</span>),
              or 1-letter typo (<span class="font-mono text-amber">crocn</span>). Tap any card to spotlight its bin on the Rack Map or add it to the single-swoop Pick Slip.
            </p>
          </div>
        </div>
      } @else {
        <div class="flex items-center justify-between text-xs text-muted">
          <span>
            {{ store.searchResults().length }} match(es)
            @if (store.searchElapsedMs() !== null) {
              <span class="font-mono">· {{ store.searchElapsedMs() }} ms</span>
            }
          </span>
          @if (store.searching()) {
            <span class="font-mono text-amber">Scanning racks…</span>
          }
        </div>

        @if (!store.searching() && store.searchResults().length === 0) {
          <div class="rounded-xl border border-line bg-surface p-6 text-center">
            <p class="text-sm font-semibold text-fg">No safe match found for "{{ store.query() }}"</p>
            <p class="mt-1 text-xs text-muted">
              Fuzzy matching is strictly gated at
              <span class="font-mono text-amber">{{ store.config()?.thresholds?.['FUZZY_MATCH_THRESHOLD'] ?? 0.75 }}</span>
              to prevent look-alike drug confusion. Try searching by salt compound instead.
            </p>
          </div>
        }

        <div class="space-y-2.5">
          @for (hit of store.searchResults(); track hit.item.item_id) {
            <article
              (click)="store.focusCell(hit.item)"
              class="cursor-pointer rounded-xl border border-line bg-surface p-3.5 transition hover:border-amber"
              [class.border-amber]="isSpotlight(hit)"
            >
              <div class="flex flex-wrap items-start justify-between gap-3">
                <div class="min-w-0 flex-1">
                  <div class="flex flex-wrap items-center gap-2">
                    <h3 class="text-base font-bold text-fg">{{ hit.item.brand_name }}</h3>
                    <span class="font-mono text-[11px] text-muted">{{ hit.item.item_id }}</span>

                    @if (hit.isApproximate) {
                      <span class="rf-pill-amber inline-flex items-center gap-1 rounded px-1.5 py-0.5 font-mono text-[10px] font-semibold">
                        <lucide-icon [img]="AlertIcon" [size]="11" />
                        APPROX {{ (hit.score * 100).toFixed(0) }}% — VERIFY STRIP
                      </span>
                    }

                    @if (hit.item.status === 'FLAGGED_MISSING') {
                      <span class="rf-pill-warn inline-flex items-center gap-1 rounded px-1.5 py-0.5 font-mono text-[10px] font-semibold">
                        <lucide-icon [img]="FlagIcon" [size]="11" /> FLAGGED NOT HERE
                      </span>
                    }

                    @if (hit.isSlowFind) {
                      <span class="rf-pill-amber inline-flex items-center gap-1 rounded px-1.5 py-0.5 font-mono text-[10px]">
                        <lucide-icon [img]="ClockIcon" [size]="11" /> {{ hit.item.find_time_sec }}s
                      </span>
                    }

                    @if (hit.isStale) {
                      <span class="rf-pill-warn rounded px-1.5 py-0.5 font-mono text-[10px]">
                        STALE LOC
                      </span>
                    }
                  </div>

                  <p class="mt-0.5 text-xs text-muted">
                    {{ hit.item.salt_compound || 'Salt not recorded' }}
                  </p>
                </div>

                <div class="flex flex-col items-end gap-1">
                  @if (hit.cue; as cue) {
                    <div class="rf-pill-amber inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 font-mono text-sm font-bold tracking-wide">
                      <lucide-icon [img]="MapPinIcon" [size]="15" />
                      {{ cue.code }}
                    </div>
                    <span class="font-mono text-[11px] text-muted">
                      {{ cue.unit_name }} · {{ cue.band }}
                    </span>
                  } @else {
                    <span class="rf-pill-warn rounded-lg px-2.5 py-1 font-mono text-xs font-bold">
                      UNASSIGNED
                    </span>
                  }
                </div>
              </div>

              @if (hit.cue; as cue) {
                <div class="mt-3 grid gap-2 rounded-lg border border-line bg-bg px-3 py-2 text-xs sm:grid-cols-3">
                  <div>
                    <span class="font-mono text-[10px] uppercase text-muted">Left (C{{ (hit.item.col ?? 1) - 1 }})</span>
                    <p class="truncate text-fg">{{ cue.left?.brands?.join(', ') || 'Edge of rack' }}</p>
                  </div>
                  <div>
                    <span class="font-mono text-[10px] uppercase text-amber">Same Bin</span>
                    <p class="truncate text-fg">{{ cue.siblings.join(', ') || 'Only item here' }}</p>
                  </div>
                  <div>
                    <span class="font-mono text-[10px] uppercase text-muted">Right (C{{ (hit.item.col ?? 1) + 1 }})</span>
                    <p class="truncate text-fg">{{ cue.right?.brands?.join(', ') || 'Edge of rack' }}</p>
                  </div>
                </div>
              }

              @if (hit.alsoStoredAt.length > 0) {
                <div class="mt-2 flex flex-wrap items-center gap-1.5 text-xs">
                  <lucide-icon [img]="LayersIcon" [size]="13" class="text-amber" />
                  <span class="text-muted">Also stored at:</span>
                  @for (alt of hit.alsoStoredAt; track alt) {
                    <span class="rounded border border-line bg-bg px-1.5 py-0.5 font-mono text-[11px] text-amber">
                      {{ alt }}
                    </span>
                  }
                </div>
              }

              <div class="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-line pt-2.5">
                <div class="font-mono text-xs text-muted">
                  @if (hit.item.mrp_inr !== null) {
                    <span>MRP <strong class="text-fg">₹{{ hit.item.mrp_inr.toFixed(2) }}</strong></span>
                  } @else {
                    <span class="text-amber">MRP unread</span>
                  }
                  @if (hit.item.last_verified) {
                    <span class="ml-2">· Verified {{ hit.item.last_verified }}</span>
                  }
                </div>

                <div class="flex items-center gap-2" (click)="$event.stopPropagation()">
                  <button
                    type="button"
                    (click)="store.flagNotHere(hit.item)"
                    class="inline-flex items-center gap-1 rounded-lg border border-line bg-bg px-2.5 py-1.5 text-xs text-muted hover:border-warn hover:text-warn"
                  >
                    <lucide-icon [img]="FlagIcon" [size]="13" /> Not Here?
                  </button>
                  <button
                    type="button"
                    (click)="store.addToCart(hit.item)"
                    class="rf-pill-ok inline-flex items-center gap-1 rounded-lg px-3 py-1.5 text-xs font-semibold hover:opacity-90"
                  >
                    <lucide-icon [img]="PlusIcon" [size]="14" /> Pick Slip
                  </button>
                </div>
              </div>
            </article>
          }
        </div>
      }
    </div>
  `,
})
export class SearchBoardComponent {
  readonly store = inject(RackFlowStore);
  @ViewChild('searchInput') searchInput?: ElementRef<HTMLInputElement>;

  readonly SearchIcon = Search;
  readonly XIcon = X;
  readonly PlusIcon = Plus;
  readonly FlagIcon = Flag;
  readonly MapPinIcon = MapPin;
  readonly AlertIcon = AlertTriangle;
  readonly ClockIcon = Clock;
  readonly LayersIcon = Layers;

  readonly quickSamples = ['crocin', 'amoxycillin', 'paracetamol', 'insulin', 'telmisartan', 'crocn'];

  @HostListener('window:keydown', ['$event'])
  onKeydown(event: KeyboardEvent): void {
    const tag = (event.target as HTMLElement | null)?.tagName;
    if (event.key === '/' && tag !== 'INPUT' && tag !== 'TEXTAREA' && tag !== 'SELECT') {
      event.preventDefault();
      this.searchInput?.nativeElement.focus();
    }
  }

  onQueryInput(event: Event): void {
    const val = (event.target as HTMLInputElement).value;
    this.store.setQuery(val);
  }

  clearAndFocus(): void {
    this.store.clearSearch();
    this.searchInput?.nativeElement.focus();
  }

  isSpotlight(hit: SearchHit): boolean {
    const spot = this.store.spotlightCell();
    return (
      spot !== null &&
      spot.unit_id === hit.item.unit_id &&
      spot.row === hit.item.row &&
      spot.col === hit.item.col
    );
  }
}