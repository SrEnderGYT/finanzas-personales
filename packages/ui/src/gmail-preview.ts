import { Component, computed, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { UI_PRIMITIVES } from './primitives';

interface DemoMailCandidate {
  id: string;
  bank: 'BCP';
  date: string;
  currency: 'PEN' | 'USD';
  amount: string;
  merchant: string;
  source: string;
  confidence: number;
  reason: string;
  status: 'needs_review' | 'ready' | 'confirmed' | 'rejected' | 'duplicate';
}

const INITIAL_CANDIDATES: readonly DemoMailCandidate[] = [
  {
    id: 'bcp-demo-001',
    bank: 'BCP',
    date: '2026-09-11',
    currency: 'PEN',
    amount: '42.90',
    merchant: 'Comercio de ejemplo',
    source: 'Aviso de compra con tarjeta · DEMO',
    confidence: 88,
    reason: 'Importe y fecha reconocidos; categoría pendiente de confirmar.',
    status: 'needs_review',
  },
  {
    id: 'bcp-demo-002',
    bank: 'BCP',
    date: '2026-09-10',
    currency: 'PEN',
    amount: '129.00',
    merchant: 'Internet hogar DEMO',
    source: 'Aviso de consumo · DEMO',
    confidence: 98,
    reason: 'Campos estructurados completos; listo para revisión final.',
    status: 'ready',
  },
  {
    id: 'bcp-demo-003',
    bank: 'BCP',
    date: '2026-09-10',
    currency: 'USD',
    amount: '12.50',
    merchant: 'Servicio digital DEMO',
    source: 'Segundo aviso del mismo consumo · DEMO',
    confidence: 96,
    reason: 'La vista de deduplicación lo marca como posible aviso repetido.',
    status: 'duplicate',
  },
];

@Component({
  selector: 'fp-gmail-preview',
  imports: [FormsModule, RouterLink, ...UI_PRIMITIVES],
  styleUrls: ['./gmail-screen.css', './manual-screen.css'],
  template: `
    <section class="gmail-page">
      <header class="gmail-heading">
        <div>
          <p class="eyebrow">AUTOMATIZACIÓN · VISTA FUNCIONAL DEMO</p>
          <h1>Gmail</h1>
          <p>
            Revisa cómo se verá la conexión y la importación de avisos financieros. Todo en esta
            página es sintético: ningún botón contacta Google, Gmail ni BCP.
          </p>
        </div>
        <span class="gmail-status" [class.connected]="connected()">
          {{ connected() ? 'Conectado · DEMO' : 'Sin conectar · DEMO' }}
        </span>
      </header>

      <div class="mode-banner" role="note">
        <strong>Preview visual seguro.</strong> Usa <code>usuario.demo@gmail.com</code> y mensajes
        inventados. El consentimiento real solo ocurrirá en el staging privado.
      </div>

      @if (!connected()) {
        <div class="gmail-grid" style="margin-top: 20px">
          <section class="gmail-card">
            <p class="eyebrow">CONSENTIMIENTO</p>
            <h2>Conectar Gmail</h2>
            <p>
              En producción, Google abrirá una autorización separada del login de Finanzas. Aquí
              puedes simular el resultado para validar la interfaz.
            </p>
            <label>
              Rango inicial
              <select fpSelect [(ngModel)]="rangeDays">
                <option [ngValue]="7">Últimos 7 días</option>
                <option [ngValue]="30">Últimos 30 días</option>
                <option [ngValue]="90">Últimos 90 días</option>
                <option [ngValue]="180">Últimos 180 días</option>
                <option [ngValue]="365">Último año</option>
              </select>
            </label>
            <p class="gmail-scope">
              Scope previsto:
              <code>https://www.googleapis.com/auth/gmail.readonly</code>
            </p>
            <button fpButton type="button" (click)="connected.set(true)">
              Simular consentimiento aprobado
            </button>
          </section>
          <section class="gmail-card gmail-callout">
            <h2>Qué verá el usuario</h2>
            <ul class="gmail-list">
              <li>Qué cuenta autorizó.</li>
              <li>Qué rango se revisará.</li>
              <li>Cuándo fue la última sincronización.</li>
              <li>Opción clara para desconectar.</li>
            </ul>
          </section>
        </div>
      } @else {
        <div class="gmail-grid" style="margin-top: 20px">
          <section class="gmail-card">
            <div class="gmail-card-heading">
              <div>
                <p class="eyebrow">CUENTA AUTORIZADA · DEMO</p>
                <h2>usuario.demo@gmail.com</h2>
              </div>
              <span class="gmail-status connected">Solo lectura</span>
            </div>
            <dl class="gmail-facts">
              <div><dt>Permiso</dt><dd>Gmail readonly</dd></div>
              <div><dt>Rango</dt><dd>Últimos {{ rangeDays }} días</dd></div>
              <div><dt>Última sincronización</dt><dd>{{ lastSync() }}</dd></div>
              <div><dt>Cobertura</dt><dd>13 ago 2026 — 11 sep 2026</dd></div>
            </dl>
            <div class="gmail-actions">
              <button fpButton type="button" (click)="simulateSync()">Sincronizar DEMO</button>
              <button fpButton class="secondary" type="button" (click)="connected.set(false)">
                Simular desconexión
              </button>
            </div>
          </section>
          <section class="gmail-card">
            <h2>Estado de importación</h2>
            <dl class="gmail-facts">
              <div><dt>Detectados</dt><dd>{{ candidates().length }}</dd></div>
              <div><dt>Por revisar</dt><dd>{{ reviewCount() }}</dd></div>
              <div><dt>Confirmados</dt><dd>{{ confirmedCount() }}</dd></div>
              <div><dt>Posibles duplicados</dt><dd>{{ duplicateCount() }}</dd></div>
            </dl>
            <p class="gmail-scope">
              P16 prepara candidatos para revisión. P17 será responsable de dedupe/conciliación y
              automatización segura.
            </p>
          </section>
        </div>

        <section class="gmail-card" style="margin-top: 20px" aria-label="Bandeja de revisión DEMO">
          <div class="gmail-card-heading">
            <div>
              <p class="eyebrow">P16 · BANDEJA DE REVISIÓN</p>
              <h2>Avisos financieros detectados</h2>
              <p>
                Ningún candidato ambiguo se convierte silenciosamente en un movimiento. Puedes
                revisar qué entendió el parser antes de confirmar.
              </p>
            </div>
            <label style="margin: 0; min-width: 190px">
              Mostrar
              <select fpSelect [(ngModel)]="filter">
                <option value="all">Todos</option>
                <option value="review">Por revisar</option>
                <option value="processed">Procesados</option>
              </select>
            </label>
          </div>

          @for (candidate of visibleCandidates(); track candidate.id) {
            <article class="pending-row">
              <div>
                <strong>{{ money(candidate) }} · {{ candidate.merchant }}</strong>
                <span>{{ candidate.bank }} · {{ candidate.date }} · {{ candidate.source }}</span>
                <span>Confianza DEMO: {{ candidate.confidence }}%</span>
                <p>{{ candidate.reason }}</p>
                @if (candidate.status === 'needs_review' || candidate.status === 'ready') {
                  <div class="gmail-actions">
                    <button fpButton type="button" (click)="review(candidate.id, 'confirmed')">
                      Confirmar candidato
                    </button>
                    <button
                      fpButton
                      class="secondary"
                      type="button"
                      (click)="review(candidate.id, 'rejected')"
                    >
                      Descartar
                    </button>
                  </div>
                }
              </div>
              <span
                class="gmail-status"
                [class.connected]="candidate.status === 'confirmed'"
                [class.attention]="candidate.status === 'needs_review' || candidate.status === 'duplicate'"
              >
                {{ statusLabel(candidate.status) }}
              </span>
            </article>
          } @empty {
            <p>No hay candidatos en este filtro.</p>
          }

          <div class="gmail-actions" style="margin-top: 16px">
            <button fpButton class="secondary" type="button" (click)="resetCandidates()">
              Reiniciar DEMO
            </button>
            <a routerLink="/movimientos">Ver cómo llegan a Movimientos</a>
          </div>
        </section>
      }

      @if (message()) {
        <p class="gmail-feedback" role="status">{{ message() }}</p>
      }
    </section>
  `,
})
export class GmailPreview {
  readonly connected = signal(true);
  readonly lastSync = signal('hace 2 min · DEMO');
  readonly message = signal('');
  readonly candidates = signal<DemoMailCandidate[]>(INITIAL_CANDIDATES.map((row) => ({ ...row })));
  readonly reviewCount = computed(
    () => this.candidates().filter((row) => row.status === 'needs_review' || row.status === 'ready').length,
  );
  readonly confirmedCount = computed(
    () => this.candidates().filter((row) => row.status === 'confirmed').length,
  );
  readonly duplicateCount = computed(
    () => this.candidates().filter((row) => row.status === 'duplicate').length,
  );
  rangeDays = 30;
  filter: 'all' | 'review' | 'processed' = 'all';

  readonly visibleCandidates = computed(() => {
    if (this.filter === 'review')
      return this.candidates().filter(
        (row) => row.status === 'needs_review' || row.status === 'ready' || row.status === 'duplicate',
      );
    if (this.filter === 'processed')
      return this.candidates().filter((row) => row.status === 'confirmed' || row.status === 'rejected');
    return this.candidates();
  });

  simulateSync() {
    this.lastSync.set('ahora · DEMO');
    this.message.set('Sincronización visual simulada. No se consultó ningún correo real.');
  }

  review(id: string, status: 'confirmed' | 'rejected') {
    this.candidates.update((rows) => rows.map((row) => (row.id === id ? { ...row, status } : row)));
    this.message.set(
      status === 'confirmed'
        ? 'Candidato confirmado en la vista DEMO. No se creó un movimiento real.'
        : 'Candidato descartado en la vista DEMO.',
    );
  }

  resetCandidates() {
    this.candidates.set(INITIAL_CANDIDATES.map((row) => ({ ...row })));
    this.message.set('Bandeja DEMO reiniciada.');
  }

  money(candidate: DemoMailCandidate) {
    return `${candidate.currency === 'PEN' ? 'S/' : 'US$'} ${candidate.amount}`;
  }

  statusLabel(status: DemoMailCandidate['status']) {
    return (
      {
        needs_review: 'Requiere revisión',
        ready: 'Listo para confirmar',
        confirmed: 'Confirmado · DEMO',
        rejected: 'Descartado · DEMO',
        duplicate: 'Posible duplicado',
      } as const
    )[status];
  }
}
