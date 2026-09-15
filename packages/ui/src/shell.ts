import { Component, DestroyRef, InjectionToken, inject, signal, computed } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { ProductWorkspace } from './product-workspace';
import { UI_PRIMITIVES } from './primitives';

export const MOBILE_MODE = new InjectionToken<boolean>('MOBILE_MODE', { factory: () => false });

@Component({
  selector: 'fp-shell',
  imports: [RouterLink, RouterLinkActive, RouterOutlet, ...UI_PRIMITIVES],
  template: `
    <div
      class="workspace"
      [class.auth-only-shell]="!signedIn()"
      [class.mobile-client]="mobile && signedIn()"
    >
      <a class="skip-link" href="#content">Saltar al contenido</a>

      @if (signedIn()) {
        <aside class="sidebar" aria-label="Navegación principal">
          <a routerLink="/inicio" class="brand" aria-label="Ir a Inicio">
            <span class="brand-mark" aria-hidden="true">f<span>↗</span></span>
            <span class="brand-word">finanzas<span class="brand-dot">.</span></span>
          </a>

          <span class="nav-caption">TU ESPACIO FINANCIERO</span>
          <nav>
            @for (item of menu; track item.path) {
              <a [routerLink]="item.path" routerLinkActive="active">
                <span class="nav-icon" aria-hidden="true">{{ item.icon }}</span>
                <span class="nav-copy">
                  <strong>{{ item.label }}</strong>
                  @if (item.hint) {
                    <small>{{ item.hint }}</small>
                  }
                </span>
              </a>
            }
          </nav>

          <section class="sidebar-note" aria-label="Protección de datos">
            <div class="security-visual" aria-hidden="true">
              <span class="shield-ring"></span>
              <span class="shield-core">◇</span>
            </div>
            <strong>Blindaje de tus datos</strong>
            <p>Cifrado local, controles de sesión y acceso únicamente dentro de tu espacio.</p>
            <a routerLink="/configuracion" class="security-link">Gestionar seguridad</a>
          </section>

          <a routerLink="/acceso" class="profile-mini">
            <span class="avatar">F</span>
            <div>
              <strong>Mi cuenta</strong>
              <small>{{ sessionLabel() }}</small>
            </div>
            <span class="profile-chevron" aria-hidden="true">›</span>
          </a>
        </aside>
      }

      <div class="main-frame" [class.auth-only-content]="!signedIn()">
        @if (signedIn()) {
          <header class="topbar">
            <span class="topbar-brand">finanzas<span>.</span></span>
            <span class="breadcrumb">Mi espacio <span>/</span> Finanzas personales</span>
            <div class="topbar-actions">
              <span class="session-copy">
                <strong>Mi cuenta</strong>
                <small>{{ sessionLabel() }}</small>
              </span>
              <a class="avatar" routerLink="/configuracion" aria-label="Configuración">F</a>
            </div>
          </header>
        }

        <main id="content"><router-outlet /></main>

        @if (signedIn()) {
          <footer class="app-footer">
            <span>Finanzas personales · monedas separadas · datos protegidos por sesión</span>
          </footer>
        }
      </div>

      @if (signedIn()) {
        <nav class="bottom-nav" aria-label="Navegación móvil">
          <a routerLink="/inicio" routerLinkActive="active">
            <span aria-hidden="true">⌂</span>Inicio
          </a>
          <a routerLink="/movimientos" routerLinkActive="active">
            <span aria-hidden="true">⇅</span>Movimientos
          </a>
          <a routerLink="/registro" class="add-tab" aria-label="Registrar movimiento">
            <span>+</span>
          </a>
          <a routerLink="/gmail" routerLinkActive="active">
            <span aria-hidden="true">✉</span>Gmail
          </a>
          <a routerLink="/configuracion" routerLinkActive="active">
            <span aria-hidden="true">○</span>Perfil
          </a>
        </nav>
      }
    </div>
  `,
})
export class Shell {
  readonly mobile = inject(MOBILE_MODE);
  readonly product = inject(ProductWorkspace);
  private readonly serverSignedIn = signal(this.product.auth.signedIn);
  readonly signedIn = computed(() => this.serverSignedIn() || this.product.localReady());
  readonly sessionLabel = computed(() =>
    this.serverSignedIn() ? 'Sesión activa' : 'Acceso local · sin sesión del servidor',
  );
  readonly menu = [
    { path: '/inicio', label: 'Inicio', icon: '⌂' },
    { path: '/movimientos', label: 'Movimientos', icon: '☷', hint: 'Registro financiero' },
    { path: '/registro', label: 'Registrar movimiento', icon: '＋', hint: 'Gasto o ingreso' },
    { path: '/cuentas', label: 'Cuentas', icon: '▣' },
    { path: '/gmail', label: 'Gmail', icon: '✉' },
    { path: '/tarjetas', label: 'Tarjetas', icon: '▤' },
    { path: '/suscripciones', label: 'Suscripciones', icon: '↻' },
    { path: '/deudas', label: 'Deudas de tarjeta', icon: '◫' },
    { path: '/presupuestos', label: 'Presupuestos', icon: '◴' },
    { path: '/analisis', label: 'Análisis', icon: '▥' },
    { path: '/configuracion', label: 'Configuración', icon: '⚙' },
  ];

  constructor() {
    const unsubscribe = this.product.auth.onSessionChange(() =>
      this.serverSignedIn.set(this.product.auth.signedIn),
    );
    inject(DestroyRef).onDestroy(unsubscribe);
  }
}
