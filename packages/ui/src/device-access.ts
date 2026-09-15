import { Component, inject, OnDestroy, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { Capacitor } from '@capacitor/core';
import { ManualSession } from '../../shared/src/manual-session';
import type { LocalProfile } from '../../shared/src/product-vault';
import type { ManualCatalog } from '../../domain/src';
import { ProductWorkspace } from './product-workspace';
import { UI_PRIMITIVES } from './primitives';

@Component({
  selector: 'fp-device-access',
  imports: [FormsModule, RouterLink, ...UI_PRIMITIVES],
  styleUrl: './manual-screen.css',
  template: `
    <section class="manual-card" aria-label="Espacio cifrado del dispositivo">
      <h2>Tu espacio en este dispositivo</h2>
      <p>Protege tus pendientes para conservarlos al cerrar la aplicación o perder la conexión.</p>
      @if (workspace.localReady()) {
        <p>Espacio desbloqueado. Los envíos requieren una sesión vigente.</p>
        <a routerLink="/registro">Registrar movimiento</a>
      } @else {
        @if (workspace.auth.signedIn) {
          <button fpButton (click)="prepare()" [disabled]="busy()">
            Preparar perfil conectado
          </button>
        } @else {
          <a routerLink="/acceso">Iniciar sesión</a>
          @for (profile of profiles; track profile.ownerId; let i = $index) {
            <button fpButton (click)="open(profile)" [disabled]="busy()">
              Perfil local {{ i + 1 }}
            </button>
          }
        }
        @if (selected()) {
          <form (ngSubmit)="unlock()">
            <label
              >{{ native ? 'PIN local' : 'Frase local' }}
              <input
                fpInput
                type="password"
                name="credential"
                autocomplete="off"
                [(ngModel)]="credential"
                [disabled]="busy()"
              />
            </label>
            <p>
              {{
                native
                  ? 'De 6 a 12 dígitos. No uses tu PIN bancario.'
                  : 'Al menos 12 caracteres. No se envía al servidor.'
              }}
            </p>
            <button fpButton [disabled]="busy()">
              {{ existing() ? 'Desbloquear' : 'Crear espacio cifrado' }}
            </button>
          </form>
        }
      }
      <p class="manual-feedback" role="status">{{ message() }}</p>
    </section>
  `,
})
export class DeviceAccess implements OnDestroy {
  readonly workspace = inject(ProductWorkspace);
  readonly native = Capacitor.isNativePlatform();
  readonly busy = signal(false);
  readonly selected = signal(false);
  readonly existing = signal(false);
  readonly message = signal('');
  profiles: LocalProfile[] = [];
  credential = '';
  private initialCatalog: ManualCatalog | undefined;
  private destroyed = false;
  constructor() {
    try {
      this.profiles = ManualSession.profiles().filter(
        (p) => p.mode === 'product' && p.environment === this.workspace.auth.catalogEnvironment,
      );
    } catch {
      this.message.set('No se pudo leer el registro local. No se borraron datos.');
    }
  }
  async prepare() {
    if (this.busy()) return;
    this.busy.set(true);
    const epoch = this.workspace.epoch;
    try {
      const loaded = await this.workspace.auth.manualCatalog();
      if (epoch !== this.workspace.epoch || this.destroyed) return;
      await this.open(
        {
          ownerId: loaded.ownerId,
          environment: this.workspace.auth.catalogEnvironment,
          mode: 'product',
        },
        loaded.catalog,
      );
    } catch {
      this.message.set('No se pudo preparar el perfil. Reintenta con conexión y sesión vigente.');
    } finally {
      this.busy.set(false);
    }
  }
  async open(profile: LocalProfile, catalog?: ManualCatalog) {
    if (
      profile.mode !== 'product' ||
      profile.environment !== this.workspace.auth.catalogEnvironment ||
      (this.workspace.auth.signedIn && !this.workspace.auth.canUseOwner(profile.ownerId))
    )
      return;
    this.workspace.lock();
    this.workspace.enterProduct();
    this.credential = '';
    this.selected.set(false);
    const epoch = this.workspace.epoch;
    try {
      await this.workspace.session?.vault.close();
      const session = await ManualSession.open(profile);
      if (epoch !== this.workspace.epoch || this.destroyed) {
        await session.vault.close();
        return;
      }
      this.workspace.session = session;
      this.existing.set(await session.vault.exists());
      this.initialCatalog = catalog;
      if (epoch === this.workspace.epoch && !this.destroyed) this.selected.set(true);
    } catch {
      this.message.set('No se pudo abrir el espacio cifrado. No se recreó ni borró información.');
    }
  }
  async unlock() {
    const session = this.workspace.session;
    if (this.busy() || !session) return;
    if (
      this.workspace.auth.signedIn &&
      !this.workspace.auth.canUseOwner(session.vault.profile.ownerId)
    ) {
      this.message.set('Prepara el perfil de la sesión actual antes de desbloquear.');
      return;
    }
    this.busy.set(true);
    const epoch = this.workspace.epoch;
    try {
      if (this.existing()) await session.unlock(this.credential);
      else await session.create(this.credential);
      this.credential = '';
      if (epoch !== this.workspace.epoch || this.destroyed) {
        session.vault.lock();
        return;
      }
      if (this.initialCatalog) await session.saveCatalog(this.initialCatalog);
      const catalog = await session.catalog();
      await this.workspace.refresh();
      if (epoch !== this.workspace.epoch || this.destroyed) {
        session.vault.lock();
        return;
      }
      this.workspace.catalog.set(catalog);
      this.workspace.unlocked.set(true);
      this.initialCatalog = undefined;
      void this.workspace.syncNow();
    } catch {
      this.message.set(
        'No se completó el desbloqueo. Comprueba la clave; los pendientes se conservan.',
      );
    } finally {
      this.busy.set(false);
    }
  }
  ngOnDestroy() {
    this.destroyed = true;
    this.credential = '';
  }
}
