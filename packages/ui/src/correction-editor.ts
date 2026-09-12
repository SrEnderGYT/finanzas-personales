import { Component, computed, inject, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ProductWorkspace } from './product-workspace';
import { UI_PRIMITIVES } from './primitives';
import {
  manualAmount,
  normalizeCorrection,
  type MovementVersion,
  type ManualPayload,
  type ManualCorrection,
} from '../../domain/src';

@Component({
  selector: 'fp-correction-editor',
  imports: [FormsModule, ...UI_PRIMITIVES],
  styleUrl: './manual-screen.css',
  template: `
    <button fpButton (click)="open()" [disabled]="workspace.correcting()">
      Corregir movimiento
    </button>
    @if (editing()) {
      <form class="manual-card" (ngSubmit)="save()" aria-label="Corregir movimiento">
        <h3>Registrar una corrección</h3>
        <p>
          Se conservará el historial. Confirmar anula contablemente la versión anterior y registra
          una nueva.
        </p>
        <label
          >Importe ({{ movement().payload.currency }})
          <input
            fpInput
            name="correction-amount"
            inputmode="decimal"
            [(ngModel)]="amount"
            [readonly]="frozen()"
            required
          />
        </label>
        <label
          >Fecha financiera
          <input
            fpInput
            name="correction-date"
            type="date"
            [(ngModel)]="businessDate"
            [readonly]="frozen()"
            required
          />
        </label>
        <label
          >Nota
          <textarea
            name="correction-note"
            [(ngModel)]="note"
            maxlength="500"
            [readonly]="frozen()"
          ></textarea>
        </label>
        <label
          >Motivo de la corrección
          <input
            fpInput
            name="correction-reason"
            [(ngModel)]="reason"
            maxlength="240"
            [readonly]="frozen()"
            required
          />
        </label>
        <p>Zona: America/Lima. El reverso se registra con la fecha de hoy en esta zona.</p>
        @if (frozen()) {
          <p>El reintento conserva exactamente esta propuesta para evitar duplicados.</p>
        }
        <button fpButton type="submit" [disabled]="saving() || workspace.correcting()">
          Confirmar corrección
        </button>
        <button fpButton type="button" (click)="editing.set(false)" [disabled]="saving()">
          Cancelar
        </button>
      </form>
    }
    @if (error()) {
      <p role="alert">{{ error() }}</p>
    }
    @for (row of attempts(); track row.command.operationId) {
      @if (row.result?.status === 'conflict' && !resolved(row.command.operationId)) {
        <section class="manual-card" aria-label="Conflicto de movimiento">
          <h3>Requiere revisión</h3>
          <p>Otro cliente cambió este movimiento. Tu propuesta quedó conservada.</p>
          <div class="correction-comparison">
            <div>
              <h4>Tu versión</h4>
              <p>{{ describe(localPayload(row.command)) }}</p>
            </div>
            <div>
              <h4>Versión del servidor</h4>
              <p>{{ describe(row.result!.server.payload) }}</p>
            </div>
          </div>
          @if (row.result?.status === 'conflict') {
            <p>Campos diferentes: {{ differences(row.result) }}</p>
          }
          <button
            fpButton
            (click)="resolve(row.command.operationId, 'keep_server')"
            [disabled]="
              workspace.correcting() || saving() || decisionPending(row.command.operationId)
            "
          >
            Conservar versión del servidor
          </button>
          @if (row.command.action === 'replace') {
            <button
              fpButton
              (click)="resolve(row.command.operationId, 'replace')"
              [disabled]="
                workspace.correcting() || saving() || decisionPending(row.command.operationId)
              "
            >
              Revertir versión del servidor y registrar mi corrección
            </button>
          }
        </section>
      } @else if (row.state === 'pending' || row.state === 'retryable' || row.state === 'sending') {
        <p role="status">Corrección pendiente de confirmación. El comando original se conserva.</p>
        <button
          fpButton
          (click)="workspace.sendCorrection(row.command.operationId)"
          [disabled]="workspace.correcting()"
        >
          Reintentar corrección
        </button>
      }
    }
  `,
})
export class CorrectionEditor {
  readonly workspace = inject(ProductWorkspace);
  readonly movement = input.required<MovementVersion>();
  readonly editing = signal(false);
  readonly saving = signal(false);
  readonly error = signal('');
  readonly attempts = computed(() =>
    this.workspace.corrections().filter((r) => r.command.rootId === this.movement().rootId),
  );
  amount = '';
  businessDate = '';
  note = '';
  reason = '';
  private base: MovementVersion | undefined;
  private pending: ManualCorrection | undefined;
  private decisions = new Map<string, ManualCorrection>();
  frozen() {
    return this.pending !== undefined;
  }
  decisionPending(id: string) {
    return this.attempts().some((r) => r.command.resolves === id && r.state !== 'requires_review');
  }
  open() {
    if (this.pending) {
      this.editing.set(true);
      return;
    }
    this.base = this.movement();
    const p = this.base.payload,
      digits = p.amountMinor.padStart(3, '0');
    this.amount = digits.slice(0, -2) + '.' + digits.slice(-2);
    this.businessDate = p.businessDate;
    this.note = p.note ?? '';
    this.reason = '';
    this.pending = undefined;
    this.error.set('');
    this.editing.set(true);
  }
  private today() {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Lima',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(new Date());
    const part = (key: string) => parts.find((p) => p.type === key)!.value;
    return `${part('year')}-${part('month')}-${part('day')}`;
  }
  private replacement(
    base: MovementVersion,
    payload: ManualPayload,
    reason: string,
    resolves?: string,
  ): ManualCorrection {
    const deviceId = crypto.randomUUID();
    return normalizeCorrection(
      {
        operationId: crypto.randomUUID(),
        deviceId,
        schemaVersion: 1,
        rootId: base.rootId,
        expectedVersion: base.version,
        reason,
        action: 'replace',
        reversalId: crypto.randomUUID(),
        reversalOperationId: crypto.randomUUID(),
        businessDate: this.today(),
        timezone: 'America/Lima',
        replacement: {
          operationId: crypto.randomUUID(),
          deviceId,
          movementId: crypto.randomUUID(),
          schemaVersion: 1,
          baseVersion: '0',
          payload,
        },
        ...(resolves ? { resolves } : {}),
      },
      { now: () => new Date() },
    );
  }
  async save() {
    if (!this.base || this.saving()) return;
    const epoch = this.workspace.epoch;
    this.saving.set(true);
    this.error.set('');
    try {
      // Retain the exact command if storage fails; editing then retrying must not
      // turn an uncertain save into a second financial intention.
      if (!this.pending)
        this.pending = this.replacement(
          this.base,
          {
            ...this.base.payload,
            ...manualAmount(this.amount, this.base.payload.currency).toJSON(),
            businessDate: this.businessDate,
            timezone: 'America/Lima',
            occurredAt: undefined,
            note: this.note,
          },
          this.reason,
        );
      await this.workspace.submitCorrection(this.pending);
      if (epoch === this.workspace.epoch) {
        this.pending = undefined;
        this.editing.set(false);
      }
    } catch {
      if (epoch === this.workspace.epoch)
        this.error.set(
          'No se pudo guardar. Revisa los campos; se conserva tu formulario y el identificador del intento.',
        );
    } finally {
      this.saving.set(false);
    }
  }
  resolved(id: string) {
    return this.workspace
      .corrections()
      .some((r) => r.command.resolves === id && r.state === 'applied');
  }
  localPayload(command: ManualCorrection) {
    return command.action === 'replace' ? command.replacement.payload : this.movement().payload;
  }
  describe(p: ManualPayload) {
    const digits = p.amountMinor.padStart(3, '0');
    const account =
      this.workspace.catalog()?.accounts.find((a) => a.id === p.accountId)?.name ??
      `Cuenta ${p.accountId.slice(-6)}`;
    const category =
      this.workspace.catalog()?.categories.find((c) => c.id === p.categoryId)?.name ??
      `Categoría ${p.categoryId.slice(-6)}`;
    return `${p.kind === 'expense' ? 'Gasto' : 'Ingreso'} · ${p.currency} ${digits.slice(0, -2)}.${digits.slice(-2)} · ${account} · ${category} · ${p.businessDate} · ${p.timezone} · ${p.occurredAt ?? 'Sin hora registrada'} · ${p.note ?? 'Sin nota'}`;
  }
  fieldNames(keys: string[]) {
    const labels: Record<string, string> = {
      kind: 'tipo',
      accountId: 'cuenta',
      categoryId: 'categoría',
      currency: 'moneda',
      amountMinor: 'importe',
      businessDate: 'fecha',
      timezone: 'zona horaria',
      occurredAt: 'instante',
      note: 'nota',
    };
    return keys.map((key) => labels[key] ?? key).join(', ') || 'versión del movimiento';
  }
  differences(result: import('../../domain/src').CorrectionResult | undefined) {
    return this.fieldNames(result?.status === 'conflict' ? result.differentFields : []);
  }
  async resolve(id: string, action: 'keep_server' | 'replace') {
    const row = this.attempts().find((r) => r.command.operationId === id);
    if (!row?.result || row.result.status !== 'conflict' || this.saving()) return;
    const server = row.result.server;
    const key = id + ':' + action;
    const command: ManualCorrection =
      this.decisions.get(key) ??
      (action === 'replace' && row.command.action === 'replace'
        ? this.replacement(server, row.command.replacement.payload, row.command.reason, id)
        : {
            operationId: crypto.randomUUID(),
            deviceId: crypto.randomUUID(),
            schemaVersion: 1,
            rootId: server.rootId,
            expectedVersion: server.version,
            reason: 'Revisión explícita: conservar versión del servidor',
            action: 'keep_server',
            resolves: id,
          });
    this.decisions.set(key, command);
    this.saving.set(true);
    try {
      await this.workspace.submitCorrection(command);
    } catch {
      this.error.set('No se pudo guardar la decisión. El conflicto se conserva.');
    } finally {
      this.saving.set(false);
    }
  }
}
