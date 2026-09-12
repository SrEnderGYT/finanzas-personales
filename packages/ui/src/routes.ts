import { Routes } from '@angular/router';
import { authenticatedGuard } from './auth-guard';
import { LatestScreen } from './latest-screen';
import { LatestGmailScreen } from './latest-gmail-screen';
import { LatestAuthScreen } from './latest-auth-screen';
import { ManualScreen } from './manual-screen';
import { DetectedFinancesScreen } from './detected-finances-screen';

const privateView = (view: string) => ({
  path: view,
  component: LatestScreen,
  canActivate: [authenticatedGuard],
  data: { view },
});

const detectedView = (path: string, view: 'cards' | 'subscriptions' | 'debts') => ({
  path,
  component: DetectedFinancesScreen,
  canActivate: [authenticatedGuard],
  data: { view },
});

export const APP_ROUTES: Routes = [
  { path: '', pathMatch: 'full', redirectTo: 'acceso' },
  { path: 'acceso', component: LatestAuthScreen },
  { path: 'registro', component: ManualScreen, canActivate: [authenticatedGuard] },
  { path: 'pendientes', component: ManualScreen, canActivate: [authenticatedGuard] },
  { path: 'gmail', component: LatestGmailScreen, canActivate: [authenticatedGuard] },
  detectedView('tarjetas', 'cards'),
  detectedView('suscripciones', 'subscriptions'),
  detectedView('deudas', 'debts'),
  ...['inicio', 'movimientos', 'cuentas', 'presupuestos', 'configuracion', 'analisis', 'nuevo'].map(
    privateView,
  ),
  { path: '**', redirectTo: 'acceso' },
];
