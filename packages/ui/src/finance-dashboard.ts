import { Component, computed, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { formatMinorExact, type ProductMovementItem } from './product-insights';

interface CategoryTotal {
  category: string;
  minor: bigint;
  share: number;
  color: string;
}

const PALETTE = ['#635bff', '#14b8a6', '#f59e0b', '#ec4899', '#3b82f6', '#8b5cf6', '#22c55e', '#f97316', '#06b6d4', '#94a3b8'];

@Component({
  selector: 'fp-finance-dashboard',
  imports: [RouterLink],
  styleUrl: './finance-dashboard.css',
  template: `
    <section class="finance-overview" aria-label="Resumen financiero del mes">
      <header class="overview-heading">
        <div>
          <p class="eyebrow">PANORAMA DEL MES</p>
          <h2>Tu dinero, explicado por categorías</h2>
          <p>Solo usamos movimientos confirmados. Avisos, promociones, estados de cuenta y pagos fallidos no entran en estos gráficos.</p>
        </div>
        <a routerLink="/analisis">Ver análisis completo</a>
      </header>

      @for (currency of currencies(); track currency) {
        <section class="currency-dashboard" [attr.aria-label]="'Resumen ' + currency">
          <div class="currency-heading">
            <div>
              <span class="currency-pill">{{ currency }}</span>
              <h3>{{ monthLabel() }}</h3>
            </div>
            <span>{{ stats(currency).count }} movimiento(s) confirmado(s)</span>
          </div>

          <div class="metric-grid">
            <article class="metric-card expense">
              <span>Gastos</span>
              <strong>{{ money(currency, stats(currency).expense) }}</strong>
              <small>{{ stats(currency).expenseCount }} movimiento(s)</small>
            </article>
            <article class="metric-card income">
              <span>Ingresos</span>
              <strong>{{ money(currency, stats(currency).income) }}</strong>
              <small>{{ stats(currency).incomeCount }} movimiento(s)</small>
            </article>
            <article class="metric-card balance">
              <span>Balance registrado</span>
              <strong>{{ money(currency, stats(currency).balance) }}</strong>
              <small>Ingresos menos gastos confirmados</small>
            </article>
            <article class="metric-card average">
              <span>Gasto promedio</span>
              <strong>{{ money(currency, stats(currency).averageExpense) }}</strong>
              <small>Por movimiento de gasto</small>
            </article>
          </div>

          @if (categories(currency).length) {
            <div class="analytics-grid">
              <article class="chart-card donut-card">
                <header>
                  <div>
                    <span>Distribución</span>
                    <h4>Gastos por categoría</h4>
                  </div>
                  <strong>{{ money(currency, stats(currency).expense) }}</strong>
                </header>
                <div class="donut-layout">
                  <div
                    class="donut-chart"
                    role="img"
                    [attr.aria-label]="donutLabel(currency)"
                    [style.background]="donutStyle(currency)"
                  >
                    <div class="donut-center">
                      <strong>{{ categories(currency).length }}</strong>
                      <span>categorías</span>
                    </div>
                  </div>
                  <div class="donut-legend">
                    @for (row of categories(currency).slice(0, 7); track row.category) {
                      <div class="legend-row">
                        <span class="legend-dot" [style.background]="row.color"></span>
                        <div>
                          <strong>{{ row.category }}</strong>
                          <small>{{ money(currency, row.minor) }}</small>
                        </div>
                        <b>{{ row.share }}%</b>
                      </div>
                    }
                  </div>
                </div>
              </article>

              <article class="chart-card ranking-card">
                <header>
                  <div>
                    <span>Ranking</span>
                    <h4>Dónde gastaste más</h4>
                  </div>
                  @if (categories(currency)[0]; as top) {
                    <strong>{{ top.category }}</strong>
                  }
                </header>
                <div class="category-bars">
                  @for (row of categories(currency).slice(0, 8); track row.category) {
                    <div class="category-bar-row">
                      <div class="bar-label">
                        <span>{{ row.category }}</span>
                        <strong>{{ row.share }}%</strong>
                      </div>
                      <div class="bar-track" aria-hidden="true">
                        <span [style.width.%]="row.share" [style.background]="row.color"></span>
                      </div>
                      <small>{{ money(currency, row.minor) }}</small>
                    </div>
                  }
                </div>
              </article>
            </div>
          } @else {
            <article class="empty-analytics">
              <strong>Aún no hay gastos confirmados en {{ currency }} este mes.</strong>
              <p>Cuando se confirme una operación real, aparecerá automáticamente en su categoría.</p>
            </article>
          }
        </section>
      } @empty {
        <article class="empty-analytics primary-empty">
          <strong>Aún no hay movimientos confirmados este mes.</strong>
          <p>Los gráficos se construirán automáticamente a partir de operaciones reales confirmadas.</p>
        </article>
      }
    </section>
  `,
})
export class FinanceDashboard {
  readonly rows = input.required<readonly ProductMovementItem[]>();
  readonly monthKey = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Lima',
    year: 'numeric',
    month: '2-digit',
  }).format(new Date());

  readonly monthRows = computed(() =>
    this.rows().filter(
      (row) => row.state === 'confirmed' && row.payload.businessDate.startsWith(this.monthKey),
    ),
  );

  readonly currencies = computed(() =>
    [...new Set(this.monthRows().map((row) => row.payload.currency))].sort(),
  );

  monthLabel() {
    const [year, month] = this.monthKey.split('-').map(Number);
    return new Intl.DateTimeFormat('es-PE', { month: 'long', year: 'numeric' }).format(
      new Date(Date.UTC(year!, month! - 1, 15)),
    );
  }

  stats(currency: string) {
    const rows = this.monthRows().filter((row) => row.payload.currency === currency);
    let expense = 0n;
    let income = 0n;
    let expenseCount = 0;
    let incomeCount = 0;
    for (const row of rows) {
      const amount = BigInt(row.payload.amountMinor);
      if (row.payload.kind === 'expense') {
        expense += amount;
        expenseCount++;
      } else if (row.payload.kind === 'income') {
        income += amount;
        incomeCount++;
      }
    }
    return {
      expense,
      income,
      balance: income - expense,
      expenseCount,
      incomeCount,
      count: expenseCount + incomeCount,
      averageExpense: expenseCount ? expense / BigInt(expenseCount) : 0n,
    };
  }

  categories(currency: string): CategoryTotal[] {
    const grouped = new Map<string, bigint>();
    for (const row of this.monthRows()) {
      if (row.payload.currency !== currency || row.payload.kind !== 'expense') continue;
      grouped.set(row.category, (grouped.get(row.category) ?? 0n) + BigInt(row.payload.amountMinor));
    }
    const ordered = [...grouped.entries()].sort((a, b) =>
      a[1] > b[1] ? -1 : a[1] < b[1] ? 1 : a[0].localeCompare(b[0]),
    );
    const total = ordered.reduce((sum, [, minor]) => sum + minor, 0n);
    return ordered.map(([category, minor], index) => ({
      category,
      minor,
      share: total > 0n ? Math.max(1, Math.round(Number((minor * 10000n) / total) / 100)) : 0,
      color: PALETTE[index % PALETTE.length]!,
    }));
  }

  donutStyle(currency: string) {
    const rows = this.categories(currency);
    if (!rows.length) return 'conic-gradient(#334155 0deg 360deg)';
    let cursor = 0;
    const segments = rows.map((row) => {
      const start = cursor;
      cursor += row.share;
      return `${row.color} ${start}% ${Math.min(100, cursor)}%`;
    });
    if (cursor < 100) segments.push(`${rows.at(-1)!.color} ${cursor}% 100%`);
    return `conic-gradient(${segments.join(', ')})`;
  }

  donutLabel(currency: string) {
    const rows = this.categories(currency);
    return rows.map((row) => `${row.category}: ${row.share}%`).join(', ');
  }

  money(currency: string, minor: bigint) {
    return formatMinorExact(currency, minor);
  }
}
