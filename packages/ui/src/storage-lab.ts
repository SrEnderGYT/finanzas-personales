import { Component, OnDestroy, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Capacitor } from '@capacitor/core';
import { IndexedVaultStore } from '../../shared/src/indexed-vault';
import { PrototypeOperation, PrototypeVault } from '../../shared/src/vault';
import { formatMinor, parseDemoAmount } from '../../shared/src/demo';
import { UI_PRIMITIVES } from './primitives';
@Component({
  selector: 'fp-storage-lab',
  imports: [FormsModule, ...UI_PRIMITIVES],
  template: ` <fp-card
    ><header class="section-heading">
      <h2>Probar guardado cifrado</h2>
      <fp-badge>P03 · DEMO</fp-badge>
    </header>
    <p class="muted">
      {{
        native
          ? 'SQLite cifrada y secreto de dispositivo en Keychain/Keystore.'
          : 'IndexedDB cifrada con una frase que sólo conoces tú.'
      }}
    </p>
    <p class="small muted">
      Usa datos ficticios. Perder la frase o borrar el almacenamiento elimina el acceso a estas
      pruebas. El servidor se implementará después de revisar P03.
    </p>
    @if (!ready()) {
      <fp-skeleton />
    }
    @if (ready() && !unlocked()) {
      <form (ngSubmit)="open()">
        <label class="field-label"
          >{{
            native
              ? 'PIN local de prueba (6 a 12 dígitos)'
              : 'Frase local de prueba (mínimo 12 caracteres)'
          }}<input
            fpInput
            name="credential"
            type="password"
            autocomplete="new-password"
            [(ngModel)]="credential"
            [attr.inputmode]="native ? 'numeric' : null"
            required /></label
        ><button fpButton type="submit" [disabled]="busy()">
          {{ exists() ? 'Desbloquear bóveda' : 'Crear bóveda de prueba' }}
        </button>
      </form>
    }
    @if (unlocked()) {
      <div class="lab-heading">
        <fp-sync-status text="Bóveda desbloqueada en este dispositivo" /><button
          fpButton
          class="secondary"
          (click)="lock()"
        >
          Bloquear bóveda
        </button>
      </div>
      <form (ngSubmit)="save()">
        <label class="field-label"
          >Importe ficticio en PEN<input
            fpMoneyInput
            name="lab-amount"
            [(ngModel)]="amount"
            required /></label
        ><button fpButton type="submit" [disabled]="busy()">Guardar prueba cifrada</button>
      </form>
      <h3 class="lab-count">Pendientes locales: {{ operations().length }}</h3>
      @for (op of operations(); track op.id) {
        <fp-transaction-row
          icon="◇"
          merchant="Gasto sintético cifrado"
          detail="Pendiente local · sin enviar"
          [amount]="format(op.minor, op.currency)"
        />
      }
    }
    @if (native) {
      <button fpButton class="secondary full-width" [disabled]="busy()" (click)="biometric()">
        Verificar Face ID / Touch ID / biometría
      </button>
    }
    @if (message()) {
      <fp-alert>{{ message() }}</fp-alert>
    }
  </fp-card>`,
})
export class StorageLab implements OnInit, OnDestroy {
  readonly native = Capacitor.isNativePlatform();
  readonly ready = signal(false);
  readonly exists = signal(false);
  readonly unlocked = signal(false);
  readonly busy = signal(false);
  readonly message = signal('');
  readonly operations = signal<PrototypeOperation[]>([]);
  credential = '';
  amount = '';
  readonly format = formatMinor;
  private vault: PrototypeVault | undefined;
  private failures = 0;
  private retryAt = 0;
  private readonly visibility = () => {
    if (document.hidden) this.lock();
  };
  async ngOnInit() {
    document.addEventListener('visibilitychange', this.visibility);
    try {
      const store = this.native
        ? await (await import('../../shared/src/native-vault')).NativeVaultStore.open()
        : await IndexedVaultStore.open();
      this.vault = new PrototypeVault(store);
      this.exists.set(await this.vault.exists());
      this.ready.set(true);
    } catch {
      this.message.set('No se pudo abrir el almacén cifrado. Se conservaron los datos existentes.');
    }
  }
  ngOnDestroy() {
    document.removeEventListener('visibilitychange', this.visibility);
    this.lock();
    void this.vault?.close();
  }
  lock() {
    this.vault?.lock();
    this.unlocked.set(false);
    this.operations.set([]);
    this.credential = '';
  }
  async open() {
    if (!this.vault || this.busy()) return;
    if (Date.now() < this.retryAt) {
      this.message.set('Espera 30 segundos antes de volver a intentar.');
      return;
    }
    if (this.native ? !/^\d{6,12}$/.test(this.credential) : this.credential.length < 12) {
      this.message.set(
        this.native
          ? 'Usa un PIN local de 6 a 12 dígitos, nunca un PIN bancario.'
          : 'Usa una frase de al menos 12 caracteres.',
      );
      return;
    }
    this.busy.set(true);
    this.message.set('');
    try {
      const credential = this.native
        ? this.credential +
          ':' +
          (await (await import('../../shared/src/native-vault')).nativePepper())
        : this.credential;
      if (this.exists()) await this.vault.unlock(credential);
      else await this.vault.create(credential);
      this.operations.set(await this.vault.operations());
      this.unlocked.set(true);
      this.failures = 0;
    } catch {
      this.failures++;
      if (this.failures >= 5) {
        this.retryAt = Date.now() + 30000;
        this.failures = 0;
      }
      this.message.set(
        'No se pudo desbloquear. Revisa la clave o espera si has acumulado intentos. No se sobrescribieron los datos.',
      );
    } finally {
      this.credential = '';
      this.exists.set(await this.vault.exists());
      this.busy.set(false);
    }
  }
  async save() {
    if (!this.vault || this.busy()) return;
    this.busy.set(true);
    this.message.set('');
    try {
      const minor = parseDemoAmount(this.amount);
      await this.vault.append({
        id: crypto.randomUUID(),
        demo: true,
        minor,
        currency: 'PEN',
        kind: 'expense',
        status: 'pending',
      });
      this.operations.set(await this.vault.operations());
      this.amount = '';
      this.message.set(
        'Prueba guardada cifrada en este dispositivo. Puedes bloquear y volver a abrir.',
      );
    } catch {
      this.message.set('No se pudo guardar. Revisa el importe y el estado de bloqueo.');
    } finally {
      this.busy.set(false);
    }
  }
  async biometric() {
    this.busy.set(true);
    try {
      this.message.set(
        await (await import('../../shared/src/native-vault')).verifyNativeBiometry(),
      );
    } catch {
      this.message.set(
        'Biometría no disponible, cancelada o no verificada. La bóveda conserva el bloqueo por PIN.',
      );
    } finally {
      this.busy.set(false);
    }
  }
}
