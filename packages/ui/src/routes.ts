import { Routes } from '@angular/router';
import { Screen } from './screen';
import { AuthScreen } from './auth-screen';
import { ManualScreen } from './manual-screen';
export const DEMO_ROUTES: Routes = [
  { path: '', pathMatch: 'full', redirectTo: () => (location.search ? 'acceso' : 'inicio') },
  { path: 'acceso', component: AuthScreen },
  { path: 'registro', component: ManualScreen },
  { path: 'pendientes', component: ManualScreen },
  ...[
    'inicio',
    'movimientos',
    'cuentas',
    'tarjetas',
    'presupuestos',
    'configuracion',
    'analisis',
    'nuevo',
  ].map((view) => ({ path: view, component: Screen, data: { view } })),
  { path: '**', redirectTo: 'inicio' },
];
