import { Component, InjectionToken, inject } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { DemoState } from './demo-state';
import { ProductWorkspace } from './product-workspace';
import { UI_PRIMITIVES } from './primitives';
export const MOBILE_MODE = new InjectionToken<boolean>('MOBILE_MODE', { factory: () => false });
@Component({
  selector: 'fp-shell',
  imports: [RouterLink, RouterLinkActive, RouterOutlet, ...UI_PRIMITIVES],
  template: ` <div class="workspace" [class.mobile-client]="mobile">
    <a class="skip-link" href="#content">Saltar al contenido</a>
    <aside class="sidebar" aria-label="Navegación principal">
      <a routerLink="/inicio" class="brand"
        ><span class="brand-mark" aria-hidden="true">f<span>↗</span></span
        >finanzas<span class="brand-dot">.</span></a
      >
      <span class="nav-caption">MI ESPACIO</span>
      <nav>
        @for (item of menu; track item.path) {
          <a [routerLink]="item.path" routerLinkActive="active"
            ><span aria-hidden="true">{{ item.icon }}</span
            >{{ item.label }}</a
          >
        }
      </nav>
      <div class="sidebar-note">
        <span aria-hidden="true">◇</span><strong>Tu dinero, con claridad.</strong>
        @if (product.product()) {
          <p>Registra y revisa tus movimientos.</p>
        } @else {
          <p>Explora la experiencia con datos de muestra.</p>
          <fp-badge>DEMO</fp-badge>
        }
      </div>
      <div class="profile-mini">
        <span class="avatar">{{ product.product() ? 'P' : 'D' }}</span>
        <div>
          <strong>{{ product.product() ? 'Mi espacio' : 'Espacio de prueba' }}</strong
          ><small>{{ product.product() ? 'Acceso privado' : 'Sin datos personales' }}</small>
        </div>
      </div>
    </aside>
    <div class="main-frame">
      <header class="topbar">
        <span class="topbar-brand">finanzas<span>.</span></span
        ><span class="breadcrumb">Mi espacio <span>/</span> Vista general</span>
        <div class="topbar-actions">
          <a routerLink="/acceso" class="auth-entry">Acceso</a>
          @if (!product.product()) {
            <fp-badge>DEMO · Datos sintéticos</fp-badge>
            <button
              class="icon-button"
              type="button"
              [attr.aria-label]="state.hidden() ? 'Mostrar importes' : 'Ocultar importes'"
              (click)="state.hidden.set(!state.hidden())"
            >
              {{ state.hidden() ? '◉' : '◎' }}
            </button>
          }
          <a class="avatar" routerLink="/configuracion" aria-label="Configuración">{{
            product.product() ? 'P' : 'D'
          }}</a>
        </div>
      </header>
      <main id="content"><router-outlet /></main>
      <footer class="app-footer">
        @if (product.product()) {
          <span>Tu espacio cifrado · cada moneda por separado</span>
        } @else {
          <fp-sync-status /><span>Vista de muestra · 6 sep 2026</span>
          @if (product.auth.enabled) {
            <button fpButton (click)="product.enterProduct()">Volver a mi espacio</button>
          }
        }
      </footer>
    </div>
    <nav class="bottom-nav" aria-label="Navegación móvil">
      <a routerLink="/inicio" routerLinkActive="active"><span aria-hidden="true">⌂</span>Inicio</a
      ><a routerLink="/movimientos" routerLinkActive="active"
        ><span aria-hidden="true">⇅</span>Movimientos</a
      ><a routerLink="/registro" class="add-tab" aria-label="Registrar movimiento local"
        ><span>+</span></a
      ><a routerLink="/analisis" routerLinkActive="active"
        ><span aria-hidden="true">▥</span>Análisis</a
      ><a routerLink="/configuracion" routerLinkActive="active"
        ><span aria-hidden="true">○</span>Perfil</a
      >
    </nav>
  </div>`,
})
export class Shell {
  readonly mobile = inject(MOBILE_MODE);
  readonly product = inject(ProductWorkspace);
  readonly state = inject(DemoState);
  readonly menu = [
    { path: '/inicio', label: 'Inicio', icon: '⌂' },
    { path: '/movimientos', label: 'Movimientos', icon: '⇅' },
    { path: '/registro', label: 'Registrar movimiento', icon: '+' },
    { path: '/cuentas', label: 'Cuentas', icon: '▣' },
    { path: '/tarjetas', label: 'Tarjetas', icon: '▤' },
    { path: '/presupuestos', label: 'Presupuestos', icon: '◴' },
    { path: '/configuracion', label: 'Configuración', icon: '⚙' },
  ];
}
