import { Routes } from '@angular/router';
import { Screen } from './screen';
import { AuthScreen } from './auth-screen';
export const DEMO_ROUTES: Routes = [
  { path: '', pathMatch: 'full', redirectTo: () => (location.search ? 'acceso' : 'inicio') },
  { path: 'acceso', component: AuthScreen },
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
