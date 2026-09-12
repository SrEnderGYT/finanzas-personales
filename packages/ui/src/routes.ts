import { Routes } from '@angular/router';
import { ProductScreen } from './product-screen';
import { AuthScreen } from './auth-screen';
import { ManualScreen } from './manual-screen';
import { GmailScreen } from './gmail-screen';

export const DEMO_ROUTES: Routes = [
  { path: '', pathMatch: 'full', redirectTo: () => (location.search ? 'acceso' : 'inicio') },
  { path: 'acceso', component: AuthScreen },
  { path: 'registro', component: ManualScreen },
  { path: 'pendientes', component: ManualScreen },
  { path: 'gmail', component: GmailScreen },
  ...[
    'inicio',
    'movimientos',
    'cuentas',
    'tarjetas',
    'presupuestos',
    'configuracion',
    'analisis',
    'nuevo',
  ].map((view) => ({ path: view, component: ProductScreen, data: { view } })),
  { path: '**', redirectTo: 'inicio' },
];
