import { Routes } from '@angular/router';
import { Screen } from './screen';
export const DEMO_ROUTES: Routes = [
  { path: '', pathMatch: 'full', redirectTo: 'inicio' },
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
