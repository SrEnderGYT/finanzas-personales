import { Injectable, computed, signal } from '@angular/core';
import {
  DEMO_TRANSACTIONS,
  DemoTransaction,
  demoTotals,
  filterDemo,
  rangeDates,
  RangeLabel,
} from '../../shared/src/demo';
import type { Currency } from '../../shared/src/index';
@Injectable({ providedIn: 'root' })
export class DemoState {
  readonly currency = signal<Currency>('PEN');
  readonly range = signal<RangeLabel>('Este mes');
  readonly start = signal('2026-09-01');
  readonly end = signal('2026-09-06');
  readonly query = signal('');
  readonly rows = signal<DemoTransaction[]>([...DEMO_TRANSACTIONS]);
  readonly theme = signal<'light' | 'dark' | 'system'>('system');
  readonly hidden = signal(false);
  readonly rangeError = computed(() => {
    try {
      rangeDates(this.range(), this.start(), this.end());
      return '';
    } catch {
      return 'Elige fechas válidas, con inicio anterior o igual al fin.';
    }
  });
  readonly period = computed(() => {
    try {
      return rangeDates(this.range(), this.start(), this.end());
    } catch {
      return ['', ''] as [string, string];
    }
  });
  readonly filtered = computed(() =>
    filterDemo(this.rows(), this.currency(), this.period(), this.query()),
  );
  readonly totals = computed(() => demoTotals(this.filtered()));
  setTheme(value: 'light' | 'dark' | 'system') {
    this.theme.set(value);
    document.documentElement.dataset['theme'] = value;
    localStorage.setItem('finanzas-theme', value);
  }
  constructor() {
    const t = localStorage.getItem('finanzas-theme');
    if (t === 'light' || t === 'dark' || t === 'system') this.setTheme(t);
  }
}
