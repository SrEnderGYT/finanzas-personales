import { Injectable, inject, signal } from '@angular/core';
import { Capacitor } from '@capacitor/core';
import { App } from '@capacitor/app';
import { AUTH_CLIENT } from './auth-provider';
import { ManualSession } from '../../shared/src/manual-session';
import {
  SyncEngine,
  SyncHttpError,
  type SyncSnapshot,
  type SyncState,
} from '../../shared/src/sync-engine';
import type { OutboxRecord } from '../../shared/src/manual-outbox';
import type { ManualCatalog } from '../../domain/src';
import { CorrectionQueue, type CorrectionRecord } from '../../shared/src/correction-queue';
@Injectable({ providedIn: 'root' })
export class ProductWorkspace {
  readonly auth = inject(AUTH_CLIENT);
  readonly product = signal(this.auth.enabled);
  readonly unlocked = signal(false);
  readonly catalog = signal<ManualCatalog | undefined>(undefined);
  readonly rows = signal<OutboxRecord[]>([]);
  readonly snapshot = signal<SyncSnapshot | undefined>(undefined);
  readonly state = signal<SyncState>('idle');
  readonly error = signal('');
  readonly corrections = signal<CorrectionRecord[]>([]);
  readonly correcting = signal(false);
  private correctionAbort: AbortController | undefined;
  session: ManualSession | undefined;
  epoch = 0;
  private engine: SyncEngine | undefined;
  private syncing = false;
  private rerun = false;
  private timer: ReturnType<typeof setTimeout> | undefined;
  constructor() {
    this.auth.onSessionChange(() => {
      this.lock();
      this.product.set(this.auth.enabled || this.auth.signedIn);
    });
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) this.lock();
    });
    window.addEventListener('online', () => {
      if (!['forbidden', 'invalid'].includes(this.state())) void this.syncNow();
    });
    window.addEventListener('offline', () => {
      this.engine?.stop();
      this.state.set('offline');
    });
    if (Capacitor.isNativePlatform())
      void App.addListener('appStateChange', ({ isActive }) => {
        if (!isActive) this.lock();
        else if (!['forbidden', 'invalid'].includes(this.state())) void this.syncNow();
      });
  }
  lock() {
    this.epoch++;
    this.rerun = false;
    this.engine?.stop();
    this.correctionAbort?.abort();
    this.engine = undefined;
    if (this.timer) clearTimeout(this.timer);
    this.session?.vault.lock();
    this.unlocked.set(false);
    this.catalog.set(undefined);
    this.rows.set([]);
    this.snapshot.set(undefined);
    this.corrections.set([]);
    this.state.set('locked');
    this.error.set('');
  }
  async refresh() {
    const session = this.session,
      epoch = this.epoch;
    if (!session?.vault.unlocked) return;
    const rows = await session.outbox.list();
    const corrections =
      session.vault.profile.mode === 'product'
        ? await new CorrectionQueue(session.vault).list()
        : [];
    const snapshot =
      session.vault.profile.mode === 'product'
        ? await new SyncEngine(
            session.vault,
            this.auth.syncApi(session.vault.profile.ownerId),
          ).snapshot()
        : undefined;
    if (epoch !== this.epoch) return;
    this.rows.set(rows);
    this.corrections.set(corrections);
    this.snapshot.set(snapshot);
  }
  async syncNow() {
    const session = this.session;
    if (!session?.vault.unlocked || session.vault.profile.mode !== 'product') return;
    if (this.syncing) {
      this.rerun = true;
      return;
    }
    if (!navigator.onLine) {
      this.state.set('offline');
      return;
    }
    if (!this.auth.canUseOwner(session.vault.profile.ownerId)) {
      this.state.set('session_required');
      return;
    }
    const epoch = this.epoch;
    this.syncing = true;
    this.state.set('syncing');
    this.error.set('');
    this.engine = new SyncEngine(
      session.vault,
      this.auth.syncApi(session.vault.profile.ownerId),
      () => this.refresh(),
    );
    try {
      const state = await this.engine.run();
      if (epoch !== this.epoch) return;
      this.state.set(navigator.onLine ? state : 'offline');
      await this.refresh();
      if (epoch !== this.epoch) return;
      if (state === 'session_required') {
        this.auth.expireSession();
        return;
      }
      if (state === 'forbidden')
        this.error.set('No tienes permiso para continuar. La operación quedó conservada.');
      const snapshot = this.snapshot();
      const times = this.rows().flatMap((row) =>
        row.state === 'pending'
          ? [Date.now() + 100]
          : row.state === 'sending'
            ? [Date.parse(row.attempt!.expiresAt) + 1]
            : row.state === 'retryable'
              ? [
                  Date.parse(
                    snapshot?.retries[row.command.operationId]?.nextAt ??
                      new Date(Date.now() + 1000).toISOString(),
                  ),
                ]
              : [],
      );
      if (!['forbidden', 'invalid'].includes(state) && (times.length || state === 'retryable')) {
        if (this.timer) clearTimeout(this.timer);
        this.timer = setTimeout(
          () => void this.syncNow(),
          times.length ? Math.max(100, Math.min(...times) - Date.now()) : 5000,
        );
      }
    } catch {
      if (epoch === this.epoch) {
        this.state.set('invalid');
        this.error.set('No se pudo completar la sincronización. Los datos locales se conservaron.');
      }
    } finally {
      this.syncing = false;
      if (this.rerun) {
        this.rerun = false;
        void this.syncNow();
      }
    }
  }
  async recoverCheckpoint() {
    const session = this.session;
    if (!session?.vault.unlocked || session.vault.profile.mode !== 'product' || this.syncing)
      return;
    if (!navigator.onLine) {
      this.state.set('offline');
      return;
    }
    if (!this.auth.canUseOwner(session.vault.profile.ownerId)) {
      this.state.set('session_required');
      return;
    }
    const epoch = this.epoch;
    if (this.timer) clearTimeout(this.timer);
    this.syncing = true;
    this.rerun = false;
    this.state.set('syncing');
    this.error.set('');
    this.engine = new SyncEngine(session.vault, this.auth.syncApi(session.vault.profile.ownerId));
    try {
      const state = await this.engine.recoverCheckpoint();
      if (epoch !== this.epoch) return;
      await this.refresh();
      if (epoch !== this.epoch) return;
      this.state.set(state);
      this.error.set('Descarga recuperada. Tus pendientes se conservaron sin enviar.');
    } catch (error) {
      if (epoch !== this.epoch) return;
      if (error instanceof SyncHttpError && error.status === 401) {
        this.auth.expireSession();
        return;
      }
      this.state.set(
        error instanceof SyncHttpError && error.status === 403 ? 'forbidden' : 'invalid',
      );
      this.error.set(
        'No se pudo recuperar la descarga. La copia anterior y tus pendientes se conservaron.',
      );
    } finally {
      this.syncing = false;
      // A recovery is download-only; reconnect/queued events must not silently
      // turn the explicit repair action into an upload.
      this.rerun = false;
    }
  }
  async submitCorrection(input: unknown) {
    const session = this.session,
      epoch = this.epoch;
    if (!session?.vault.unlocked || session.vault.profile.mode !== 'product') return;
    const row = await new CorrectionQueue(session.vault).enqueue(input);
    if (epoch !== this.epoch) return;
    await this.refresh();
    if (epoch === this.epoch) await this.sendCorrection(row.command.operationId);
  }
  async sendCorrection(id: string) {
    const session = this.session,
      epoch = this.epoch;
    if (!session?.vault.unlocked || this.correcting()) return;
    if (!navigator.onLine) {
      this.error.set('Corrección guardada en este dispositivo. Reintenta cuando tengas conexión.');
      return;
    }
    if (!this.auth.canUseOwner(session.vault.profile.ownerId)) {
      this.state.set('session_required');
      return;
    }
    this.correcting.set(true);
    this.correctionAbort = new AbortController();
    this.error.set('');
    try {
      const result = await new CorrectionQueue(session.vault).send(
        id,
        this.auth.correctionApi(session.vault.profile.ownerId),
        this.correctionAbort.signal,
      );
      if (epoch !== this.epoch) return;
      await this.refresh();
      if (epoch !== this.epoch) return;
      if (result.state === 'applied') await this.syncNow();
    } catch (error) {
      if (epoch !== this.epoch) return;
      if (error instanceof SyncHttpError && error.status === 401) {
        this.auth.expireSession();
        return;
      }
      await this.refresh().catch(() => {});
      if (epoch === this.epoch)
        this.error.set('La corrección se conserva. Comprueba tu conexión y vuelve a intentar.');
    } finally {
      this.correcting.set(false);
    }
  }
  enterDemo() {
    this.lock();
    this.product.set(false);
  }
  enterProduct() {
    if (this.session?.vault.profile.mode === 'demo') {
      this.lock();
      void this.session.vault.close();
      this.session = undefined;
    }
    this.product.set(true);
  }
}
