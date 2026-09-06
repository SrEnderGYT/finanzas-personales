import {
  AfterViewInit,
  Component,
  Directive,
  ElementRef,
  input,
  output,
  viewChild,
} from '@angular/core';

@Directive({ selector: 'button[fpButton],a[fpButton]', host: { class: 'fp-button' } })
export class Button {}
@Directive({ selector: 'input[fpInput],textarea[fpInput]', host: { class: 'fp-input' } })
export class Input {}
@Directive({
  selector: 'input[fpMoneyInput]',
  host: { class: 'fp-input money-input', inputmode: 'decimal', autocomplete: 'off' },
})
export class MoneyInput {}
@Directive({ selector: 'select[fpSelect]', host: { class: 'fp-select' } })
export class Select {}
@Directive({ selector: 'input[fpDatePicker]', host: { class: 'fp-input', type: 'date' } })
export class DatePicker {}
@Directive({
  selector: 'input[fpSearchInput]',
  host: { class: 'fp-input search-input', type: 'search' },
})
export class SearchInput {}
@Component({ selector: 'fp-card', template: '<ng-content/>', host: { class: 'fp-card' } })
export class Card {}
@Component({
  selector: 'fp-financial-card',
  template:
    '<span class="metric-label">{{label()}}</span><strong class="metric-value">{{value()}}</strong><span class="metric-note">{{note()}}</span>',
  host: { class: 'financial-card' },
})
export class FinancialCard {
  label = input('');
  value = input('');
  note = input('');
}
@Component({ selector: 'fp-badge', template: '<ng-content/>', host: { class: 'fp-badge' } })
export class Badge {}
@Component({
  selector: 'fp-alert',
  template: '<span aria-hidden="true">ⓘ</span><div><ng-content/></div>',
  host: { class: 'fp-alert', role: 'alert' },
})
export class Alert {}
@Component({
  selector: 'fp-toast',
  template: '<span>✓</span><ng-content/>',
  host: { class: 'fp-toast', role: 'status' },
})
export class Toast {}
@Component({
  selector: 'fp-skeleton',
  template: '<span></span><span></span>',
  host: { class: 'fp-skeleton', 'aria-hidden': 'true' },
})
export class Skeleton {}
@Component({
  selector: 'fp-empty-state',
  template:
    '<span class="empty-icon" aria-hidden="true">⌕</span><h3>{{title()}}</h3><p>{{detail()}}</p><ng-content/>',
  host: { class: 'fp-empty' },
})
export class EmptyState {
  title = input('Sin movimientos');
  detail = input('Prueba otro periodo o limpia los filtros.');
}
@Component({
  selector: 'fp-sync-status',
  template: '<span class="status-dot" aria-hidden="true"></span>{{text()}}',
  host: { class: 'sync-status', role: 'status' },
})
export class SyncStatus {
  text = input('DEMO · Sin conexión bancaria');
}
@Component({
  selector: 'fp-chart-card',
  template:
    '<header class="section-heading"><h2>{{title()}}</h2><span>{{subtitle()}}</span></header><ng-content/>',
  host: { class: 'fp-card chart-card' },
})
export class ChartCard {
  title = input('');
  subtitle = input('');
}
@Component({
  selector: 'fp-account-card',
  template:
    '<span class="account-icon" aria-hidden="true">{{icon()}}</span><div><h3>{{name()}}</h3><p>{{detail()}}</p></div><strong>{{balance()}}</strong>',
  host: { class: 'fp-card account-card' },
})
export class AccountCard {
  name = input('');
  detail = input('');
  balance = input('');
  icon = input('▣');
}
@Component({
  selector: 'fp-credit-card',
  template:
    '<div class="credit-top"><span>Banco DEMO</span><strong>VISA</strong></div><div class="credit-chip" aria-hidden="true">▥</div><p class="card-digits">•••• &nbsp; •••• &nbsp; •••• &nbsp; 1234</p><div class="credit-bottom"><span>{{label()}}</span><span>DEMO</span></div>',
  host: { class: 'credit-card' },
})
export class CreditCard {
  label = input('Visa de muestra');
}
@Component({
  selector: 'fp-transaction-row',
  template:
    '<span class="transaction-icon" aria-hidden="true">{{icon()}}</span><div class="transaction-description"><strong>{{merchant()}}</strong><span>{{detail()}}</span></div><strong class="transaction-amount" [class.positive]="positive()">{{amount()}}</strong>',
  host: { class: 'transaction-row' },
})
export class TransactionRow {
  icon = input('↗');
  merchant = input('');
  detail = input('');
  amount = input('');
  positive = input(false);
}
@Component({
  selector: 'fp-category-picker',
  template:
    '<label class="field-label">Categoría<select class="fp-select" [value]="value()" (change)="change($event)">@for(option of options();track option){<option [value]="option">{{option}}</option>}</select></label>',
})
export class CategoryPicker {
  options = input<string[]>([]);
  value = input('Otros');
  valueChange = output<string>();
  change(e: Event) {
    this.valueChange.emit((e.target as HTMLSelectElement).value);
  }
}
@Component({
  selector: 'fp-modal,fp-bottom-sheet',
  template:
    '<dialog #dialog (cancel)="close.emit()" (close)="close.emit()" aria-labelledby="dialog-title"><header class="section-heading"><h2 id="dialog-title">{{title()}}</h2><button class="icon-button" type="button" aria-label="Cerrar" (click)="close.emit()">×</button></header><ng-content/></dialog>',
  host: { class: 'overlay' },
})
export class Modal implements AfterViewInit {
  title = input('');
  close = output<void>();
  dialog = viewChild.required<ElementRef<HTMLDialogElement>>('dialog');
  ngAfterViewInit() {
    this.dialog().nativeElement.showModal();
  }
}
/** BottomSheet shares native dialog focus trapping/escape handling; its mobile layout is CSS. */
export { Modal as BottomSheet };
export const UI_PRIMITIVES = [
  Button,
  Input,
  MoneyInput,
  Select,
  DatePicker,
  SearchInput,
  Card,
  FinancialCard,
  Badge,
  Alert,
  Toast,
  Skeleton,
  EmptyState,
  SyncStatus,
  ChartCard,
  AccountCard,
  CreditCard,
  TransactionRow,
  CategoryPicker,
  Modal,
];
