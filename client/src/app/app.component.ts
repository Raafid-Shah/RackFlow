import { Component, inject, signal } from '@angular/core';
import {
  AlertTriangle,
  LayoutGrid,
  Lock,
  LucideAngularModule,
  Moon,
  RefreshCw,
  Search,
  SlidersHorizontal,
  Sun,
  Undo2,
  Unlock,
  X,
} from 'lucide-angular';
import { ModeratorOpsComponent } from './components/moderator-ops.component';
import { PickSlipComponent } from './components/pick-slip.component';
import { RackMiniMapComponent } from './components/rack-mini-map.component';
import { SearchBoardComponent } from './components/search-board.component';
import { RackFlowStore } from './services/rackflow.store';

type WorkspaceTab = 'lookup' | 'map' | 'ops';

@Component({
  selector: 'rf-root',
  imports: [
    LucideAngularModule,
    SearchBoardComponent,
    PickSlipComponent,
    RackMiniMapComponent,
    ModeratorOpsComponent,
  ],
  template: `
    <div class="min-h-screen bg-bg text-fg">
      <header class="sticky top-0 z-30 border-b border-line bg-surface/95 backdrop-blur">
        <div class="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3 px-4 py-3">
          <div class="flex items-center gap-3">
            <div class="flex h-9 w-9 items-center justify-center rounded-lg border border-amber bg-bg font-mono text-sm font-bold text-amber">
              RF
            </div>
            <div>
              <div class="flex items-center gap-2">
                <h1 class="text-base font-bold leading-tight text-fg">
                  {{ store.config()?.shopName || 'RackFlow' }}
                </h1>
                <span class="rf-pill-ok rounded px-1.5 py-0.5 font-mono text-[10px] font-semibold">
                  LAN · {{ store.items().length }} SKUs
                </span>
              </div>
              <p class="text-[11px] text-muted">
                Offline Shelf Finder &amp; Single-Swoop Batch Router
              </p>
            </div>
          </div>

          <div class="flex flex-wrap items-center gap-2">
            <select
              aria-label="Active staff"
              [value]="store.staffName()"
              (change)="onStaffChange($event)"
              class="rounded-lg border border-line bg-bg px-2.5 py-1.5 text-xs text-fg focus:border-amber focus:outline-none"
            >
              @for (preset of store.config()?.staffPresets ?? ['Counter Staff']; track preset) {
                <option [value]="preset">{{ preset }}</option>
              }
            </select>

            @if (store.moderatorUnlocked() && store.backupCount() > 0) {
              <button
                type="button"
                (click)="store.undoLastChange()"
                class="rf-pill-amber inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 font-mono text-xs font-semibold hover:opacity-90"
              >
                <lucide-icon [img]="UndoIcon" [size]="13" /> Undo ({{ store.backupCount() }})
              </button>
            }

            @if (store.moderatorUnlocked()) {
              <button
                type="button"
                (click)="store.lockModerator()"
                class="rf-pill-ok inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-semibold"
              >
                <lucide-icon [img]="UnlockIcon" [size]="13" /> Mod
              </button>
            } @else {
              <button
                type="button"
                (click)="openPinModal()"
                class="inline-flex items-center gap-1 rounded-lg border border-line bg-bg px-2.5 py-1.5 text-xs text-muted hover:border-amber hover:text-amber"
              >
                <lucide-icon [img]="LockIcon" [size]="13" /> Mod PIN
              </button>
            }

            <button
              type="button"
              (click)="store.refreshInventory()"
              class="rounded-lg border border-line bg-bg p-1.5 text-muted hover:text-fg"
              title="Reload data.csv"
            >
              <lucide-icon [img]="RefreshIcon" [size]="15" />
            </button>

            <button
              type="button"
              (click)="store.toggleTheme()"
              class="rounded-lg border border-line bg-bg p-1.5 text-muted hover:text-amber"
              title="Switch dark/light theme"
            >
              @if (store.theme() === 'dark') {
                <lucide-icon [img]="SunIcon" [size]="15" />
              } @else {
                <lucide-icon [img]="MoonIcon" [size]="15" />
              }
            </button>
          </div>
        </div>

        <nav class="mx-auto flex max-w-7xl items-center gap-1 overflow-x-auto px-4 pb-2">
          <button
            type="button"
            (click)="activeTab.set('lookup')"
            class="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition"
            [class.rf-pill-amber]="activeTab() === 'lookup'"
            [class.text-muted]="activeTab() !== 'lookup'"
          >
            <lucide-icon [img]="SearchIcon" [size]="14" />
            Lookup &amp; Pick Slip
            @if (store.totalCartUnits() > 0) {
              <span class="rounded-full bg-ok px-1.5 font-mono text-[10px] text-bg">
                {{ store.totalCartUnits() }}
              </span>
            }
          </button>

          <button
            type="button"
            (click)="activeTab.set('map')"
            class="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition"
            [class.rf-pill-amber]="activeTab() === 'map'"
            [class.text-muted]="activeTab() !== 'map'"
          >
            <lucide-icon [img]="GridIcon" [size]="14" />
            Jagged Rack Map
          </button>

          <button
            type="button"
            (click)="activeTab.set('ops')"
            class="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition"
            [class.rf-pill-amber]="activeTab() === 'ops'"
            [class.text-muted]="activeTab() !== 'ops'"
          >
            <lucide-icon [img]="OpsIcon" [size]="14" />
            Moderator Ops
            @if (store.flaggedCount() + store.unassignedCount() > 0) {
              <span class="rounded-full bg-warn px-1.5 font-mono text-[10px] text-white">
                {{ store.flaggedCount() + store.unassignedCount() }}
              </span>
            }
          </button>
        </nav>
      </header>

      <main class="mx-auto max-w-7xl px-4 py-5">
        @if (store.serverError(); as err) {
          <div class="rf-pill-warn mb-4 flex items-center gap-2 rounded-xl p-3 text-sm">
            <lucide-icon [img]="AlertIcon" [size]="16" /> {{ err }}
          </div>
        }

        @if (activeTab() === 'lookup') {
          <div class="grid gap-5 lg:grid-cols-12">
            <div class="space-y-5 lg:col-span-8">
              <rf-search-board />
              <div class="hidden lg:block">
                <rf-rack-mini-map />
              </div>
            </div>
            <div class="lg:col-span-4">
              <div class="lg:sticky lg:top-28">
                <rf-pick-slip />
              </div>
            </div>
          </div>
        } @else if (activeTab() === 'map') {
          <div class="grid gap-5 lg:grid-cols-12">
            <div class="lg:col-span-8">
              <rf-rack-mini-map />
            </div>
            <div class="lg:col-span-4">
              <rf-pick-slip />
            </div>
          </div>
        } @else {
          <rf-moderator-ops (requestUnlock)="openPinModal()" />
        }

        <footer class="mt-8 border-t border-line pt-4 text-[11px] text-muted">
          Shelf-location aid only — never use for medical advice, drug substitution, or final GST billing. Always verify strip strength, salt, and expiry before dispensing.
        </footer>
      </main>

      @if (pinModalOpen()) {
        <div
          class="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
          (click)="pinModalOpen.set(false)"
        >
          <div
            class="w-full max-w-sm rounded-xl border border-line bg-surface p-5"
            (click)="$event.stopPropagation()"
          >
            <div class="flex items-center justify-between">
              <h3 class="text-base font-bold text-fg">Unlock Moderator Mode</h3>
              <button
                type="button"
                (click)="pinModalOpen.set(false)"
                class="text-muted hover:text-fg"
              >
                <lucide-icon [img]="XIcon" [size]="16" />
              </button>
            </div>
            <p class="mt-1 text-xs text-muted">
              Required for shelf moves, container swaps, row shifts, layout edits, CSV imports, and Undo.
            </p>
            @if (store.config()?.pinHint; as hint) {
              <p class="mt-2 font-mono text-xs text-amber">Demo PIN hint: {{ hint }}</p>
            }

            <form (submit)="submitPin($event)" class="mt-4 space-y-3">
              <input
                type="password"
                inputmode="numeric"
                autocomplete="one-time-code"
                [value]="pinInput()"
                (input)="onPinInput($event)"
                placeholder="Enter PIN"
                class="w-full rounded-lg border border-line bg-bg px-3 py-2 font-mono text-base tracking-widest text-fg focus:border-amber focus:outline-none"
              />
              @if (pinError()) {
                <p class="text-xs text-warn">{{ pinError() }}</p>
              }
              <button
                type="submit"
                class="w-full rounded-lg bg-amber py-2 text-sm font-bold text-bg hover:opacity-90"
              >
                Unlock
              </button>
            </form>
          </div>
        </div>
      }

      @if (store.toast(); as t) {
        <div
          class="fixed bottom-4 right-4 z-50 max-w-sm rounded-xl px-4 py-2.5 text-xs font-semibold shadow-lg"
          [class.rf-pill-ok]="t.kind === 'ok'"
          [class.rf-pill-warn]="t.kind === 'warn'"
          [class.rf-pill-amber]="t.kind === 'info'"
        >
          {{ t.text }}
        </div>
      }
    </div>
  `,
})
export class AppComponent {
  readonly store = inject(RackFlowStore);

  readonly activeTab = signal<WorkspaceTab>('lookup');
  readonly pinModalOpen = signal<boolean>(false);
  readonly pinInput = signal<string>('');
  readonly pinError = signal<string | null>(null);

  readonly SearchIcon = Search;
  readonly GridIcon = LayoutGrid;
  readonly OpsIcon = SlidersHorizontal;
  readonly LockIcon = Lock;
  readonly UnlockIcon = Unlock;
  readonly SunIcon = Sun;
  readonly MoonIcon = Moon;
  readonly UndoIcon = Undo2;
  readonly RefreshIcon = RefreshCw;
  readonly AlertIcon = AlertTriangle;
  readonly XIcon = X;

  onStaffChange(event: Event): void {
    this.store.setStaffName((event.target as HTMLSelectElement).value);
  }

  openPinModal(): void {
    this.pinInput.set('');
    this.pinError.set(null);
    this.pinModalOpen.set(true);
  }

  onPinInput(event: Event): void {
    this.pinInput.set((event.target as HTMLInputElement).value);
  }

  async submitPin(event: Event): Promise<void> {
    event.preventDefault();
    this.pinError.set(null);
    const res = await this.store.unlockModerator(this.pinInput());
    if (res.ok) {
      this.pinModalOpen.set(false);
    } else {
      this.pinError.set(res.error ?? 'Incorrect PIN.');
    }
  }
}
