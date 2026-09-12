import { Component, InjectionToken, inject } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { ProductWorkspace } from './product-workspace';
import { UI_PRIMITIVES } from './primitives';

export const MOBILE_MODE = new InjectionToken<boolean>('MOBILE_MODE', { factory: () => false });

@Component({
  selector: 'fp-shell',
  imports: [RouterLink, RouterLinkActive, RouterOutlet, ...UI_PRIMITIVES],
  template: `
    <div class="workspace" [class.mobile-client]="mobile">
      <a class="skip-link" href="#content">Saltar al contenido</a>
      <aside class="sidebar" aria-label="Navegación principal">
        <a routerLink="/inicio" class="brand">
          <span class="brand-mark" aria-hidden="true">f<span>↗</span></span>
          finanzas<span class="brand-dot">.</span>
        </a>

        <span class="nav-caption">MIS FINANZAS</span>
        <nav>
          @for (item of menu; track item.path) {
            <a [routerLink]="item.path" routerLinkActive="active">
              <span aria-hidden="true">{{ item.icon }}</span
              >{{ item.label }}
            </a>
          }
        </nav>

        <div class="sidebar-note">
          <span aria-hidden="true">◇</span>
          <strong>Tu información, bajo control.</strong>
          <p>Los importes personales solo aparecen después de abrir tu espacio cifrado.</p>
        </div>

        <a routerLink="/acceso" class="profile-mini">
          <span class="avatar">{{ product.auth.signedIn ? 'F' : '○' }}</span>
          <div>
            <strong>{{ product.auth.signedIn ? 'Mi cuenta' : 'Iniciar sesión' }}</strong>
            <small>{{ product.auth.signedIn ? 'Sesión activa' : 'Acceso protegido' }}</small>
          </div>
        </a>
      </aside>

      <div class="main-frame">
        <header class="topbar">
          <span class="topbar-brand">finanzas<span>.</span></span>
          <span class="breadcrumb">Mi espacio <span>/</span> Finanzas personales</span>
          <div class="topbar-actions">
            <a routerLink="/acceso" class="auth-entry">
              {{ product.auth.signedIn ? 'Mi cuenta' : 'Acceso' }}
            </a>
            <fp-badge>{{ product.auth.signedIn ? 'Sesión activa' : 'Protegido' }}</fp-badge>
            <a class="avatar" routerLink="/configuracion" aria-label="Configuración">F</a>
          </div>
        </header>

        <main id="content"><router-outlet /></main>

        <footer class="app-footer">
          <span>Finanzas personales · monedas separadas · espacio local cifrado</span>
        </footer>
      </div>

      <nav class="bottom-nav" aria-label="Navegación móvil">
        <a routerLink="/inicio" routerLinkActive="active"
          ><span aria-hidden="true">⌂</span>Inicio</a
        >
        <a routerLink="/movimientos" routerLinkActive="active">
          <span aria-hidden="true">⇅</span>Movimientos
        </a>
        <a routerLink="/registro" class="add-tab" aria-label="Registrar movimiento">
          <span>+</span>
        </a>
        <a routerLink="/gmail" routerLinkActive="active"><span aria-hidden="true">✉</span>Gmail</a>
        <a routerLink="/configuracion" routerLinkActive="active">
          <span aria-hidden="true">○</span>Perfil
        </a>
      </nav>
    </div>
  `,
})
export class Shell {
  readonly mobile = inject(MOBILE_MODE);
  readonly product = inject(ProductWorkspace);
  readonly menu = [
    { path: '/inicio', label: 'Inicio', icon: '⌂' },
    { path: '/movimientos', label: 'Movimientos', icon: '⇅' },
    { path: '/registro', label: 'Registrar movimiento', icon: '+' },
    { path: '/cuentas', label: 'Cuentas', icon: '▣' },
    { path: '/gmail', label: 'Gmail', icon: '✉' },
    { path: '/tarjetas', label: 'Tarjetas', icon: '▤' },
    { path: '/presupuestos', label: 'Presupuestos', icon: '◴' },
    { path: '/analisis', label: 'Análisis', icon: '▥' },
    { path: '/configuracion', label: 'Configuración', icon: '⚙' },
  ];
}
