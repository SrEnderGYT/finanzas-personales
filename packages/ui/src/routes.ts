import { Routes } from '@angular/router';
import { LatestScreen } from './latest-screen';
import { LatestGmailScreen } from './latest-gmail-screen';
import { LatestAuthScreen } from './latest-auth-screen';
import { ManualScreen } from './manual-screen';

export const APP_ROUTES: Routes = [
  { path: '', pathMatch: 'full', redirectTo: 'inicio' },
  { path: 'acceso', component: LatestAuthScreen },
  { path: 'registro', component: ManualScreen },
  { path: 'pendientes', component: ManualScreen },
  { path: 'gmail', component: LatestGmailScreen },
  ...[
    'inicio',
    'movimientos',
    'cuentas',
    'tarjetas',
    'presupuestos',
    'configuracion',
    'analisis',
    'nuevo',
  ].map((view) => ({ path: view, component: LatestScreen, data: { view } })),
  { path: '**', redirectTo: 'inicio' },
];
