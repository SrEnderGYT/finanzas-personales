import { Component, computed, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { UI_PRIMITIVES } from './primitives';

@Component({
  selector: 'fp-locked-product-screen',
  imports: [RouterLink, ...UI_PRIMITIVES],
  styleUrl: './manual-screen.css',
  template: `
    <section class="manual-page">
      <header class="page-heading">
        <div>
          <p class="eyebrow">MIS FINANZAS</p>
          <h1>{{ title() }}</h1>
          <p>{{ subtitle() }}</p>
        </div>
        <a fpButton routerLink="/acceso">Iniciar sesión</a>
      </header>

      @if (view() === 'inicio') {
        <section class="product-status-grid" aria-label="Resumen financiero protegido">
          <article class="product-stat-card">
            <span>Balance registrado</span>
            <strong>—</strong>
            <small>Se muestra después de abrir tu espacio</small>
          </article>
          <article class="product-stat-card">
            <span>Ingresos</span>
            <strong>—</strong>
            <small>Sin cifras ficticias</small>
          </article>
          <article class="product-stat-card">
            <span>Gastos</span>
            <strong>—</strong>
            <small>Sin cifras ficticias</small>
          </article>
        </section>

        <section class="manual-card product-empty-state">
          <div class="product-section-heading">
            <div>
              <h2>Inicia sesión para ver tus finanzas</h2>
              <p>
                Tus importes, cuentas y movimientos no se publican en esta web. Se cargan únicamente
                cuando tu sesión y tu espacio cifrado están disponibles.
              </p>
            </div>
            <a routerLink="/acceso">Ir a acceso</a>
          </div>
        </section>

        <div class="manual-grid" style="margin-top: 18px">
          <section class="manual-card">
            <div class="product-section-heading">
              <div>
                <h2>Actividad reciente</h2>
                <p>Movimientos confirmados, pendientes y operaciones que requieran revisión.</p>
              </div>
              <a routerLink="/movimientos">Ver movimientos</a>
            </div>
            <p class="empty-local">Tu actividad aparecerá aquí después de iniciar sesión.</p>
          </section>
          <section class="manual-card">
            <div class="product-section-heading">
              <div>
                <h2>Cuentas</h2>
                <p>Organiza soles y dólares por separado y conserva el origen de cada movimiento.</p>
              </div>
              <a routerLink="/cuentas">Ver cuentas</a>
            </div>
            <p class="empty-local">No se muestra ninguna cuenta sin una sesión autenticada.</p>
          </section>
        </div>
      } @else if (view() === 'movimientos') {
        <div class="local-toolbar">
          <p role="status">Espacio bloqueado</p>
          <a fpButton routerLink="/acceso">Iniciar sesión</a>
          <span>Última sincronización: —</span>
        </div>
        <section class="manual-card movement-filter-card">
          <div class="product-section-heading">
            <div>
              <h2>Buscar y filtrar movimientos</h2>
              <p>Por moneda, tipo, estado, fecha, cuenta, categoría o concepto.</p>
            </div>
          </div>
        </section>
        <section class="manual-card product-empty-state">
          <h2>Tus movimientos aparecerán aquí</h2>
          <p>
            La aplicación no rellena esta lista con operaciones inventadas. Inicia sesión para
            consultar tus movimientos reales y los pendientes cifrados de este dispositivo.
          </p>
          <a routerLink="/acceso">Abrir mi cuenta</a>
        </section>
      } @else if (view() === 'cuentas') {
        <div class="manual-grid">
          <section class="manual-card">
            <h2>Tus cuentas</h2>
            <p>
              Cuentas bancarias, efectivo y otras fuentes aparecerán aquí con su moneda y estado.
            </p>
            <p class="empty-local">Sin sesión no se carga información financiera.</p>
          </section>
          <section class="manual-card">
            <h2>Tus categorías</h2>
            <p>Clasifica gastos e ingresos sin mezclar monedas ni duplicar movimientos.</p>
            <p class="empty-local">Inicia sesión para cargar tu catálogo personal.</p>
          </section>
        </div>
      } @else if (view() === 'tarjetas') {
        <div class="manual-grid">
          <section class="manual-card">
            <h2>Tarjetas</h2>
            <p>Gestiona tarjetas, moneda, cierre, pago y movimientos relacionados.</p>
            <p class="empty-local">No se muestra ninguna tarjeta sin tu sesión.</p>
          </section>
          <section class="manual-card">
            <h2>Próximos pagos</h2>
            <p>Las fechas y montos aparecerán cuando existan tarjetas configuradas en tu cuenta.</p>
            <p class="empty-local">Sin información cargada.</p>
          </section>
        </div>
      } @else if (view() === 'presupuestos') {
        <section class="product-status-grid">
          <article class="product-stat-card">
            <span>Presupuesto del mes</span>
            <strong>—</strong>
            <small>PEN y USD permanecen separados</small>
          </article>
          <article class="product-stat-card">
            <span>Consumido</span>
            <strong>—</strong>
            <small>Se calcula con movimientos confirmados</small>
          </article>
          <article class="product-stat-card">
            <span>Disponible</span>
            <strong>—</strong>
            <small>Sin estimaciones ficticias</small>
          </article>
        </section>
        <section class="manual-card product-empty-state">
          <h2>Tus presupuestos aparecerán aquí</h2>
          <p>Inicia sesión para consultar límites por categoría y seguimiento mensual.</p>
        </section>
      } @else if (view() === 'analisis') {
        <section class="product-status-grid">
          <article class="product-stat-card">
            <span>Ingresos del periodo</span>
            <strong>—</strong>
            <small>Datos protegidos</small>
          </article>
          <article class="product-stat-card">
            <span>Gastos del periodo</span>
            <strong>—</strong>
            <small>Datos protegidos</small>
          </article>
          <article class="product-stat-card">
            <span>Ahorro registrado</span>
            <strong>—</strong>
            <small>Datos protegidos</small>
          </article>
        </section>
        <section class="manual-card product-empty-state">
          <h2>Análisis basado en tus movimientos</h2>
          <p>
            Los gráficos y comparaciones se construyen con información confirmada de tu cuenta, no
            con valores de muestra.
          </p>
        </section>
      } @else if (view() === 'configuracion') {
        <div class="manual-grid">
          <section class="manual-card">
            <h2>Acceso y seguridad</h2>
            <p>Administra inicio de sesión, sesiones abiertas y autenticación de dos pasos.</p>
            <a routerLink="/acceso">Administrar acceso</a>
          </section>
          <section class="manual-card">
            <h2>Automatización Gmail</h2>
            <p>Conecta Gmail con autorización separada y permiso de solo lectura.</p>
            <a routerLink="/gmail">Administrar Gmail</a>
          </section>
        </div>
      } @else {
        <section class="manual-card product-empty-state">
          <h2>Tu espacio financiero</h2>
          <p>Inicia sesión para continuar con esta función usando tu información privada.</p>
          <a routerLink="/acceso">Iniciar sesión</a>
        </section>
      }
    </section>
  `,
})
export class LockedProductScreen {
  readonly view = input('inicio');

  readonly title = computed(
    () =>
      ({
        inicio: 'Mis finanzas',
        movimientos: 'Movimientos',
        cuentas: 'Cuentas',
        tarjetas: 'Tarjetas',
        presupuestos: 'Presupuestos',
        analisis: 'Análisis',
        configuracion: 'Configuración',
      })[this.view()] ?? 'Mi espacio',
  );

  readonly subtitle = computed(
    () =>
      ({
        inicio: 'Tu resumen financiero, sin cifras de relleno.',
        movimientos: 'Consulta, filtra y sincroniza tu actividad financiera.',
        cuentas: 'Organiza tus cuentas y categorías por moneda.',
        tarjetas: 'Centraliza tarjetas y fechas relevantes.',
        presupuestos: 'Planifica límites y revisa el avance mensual.',
        analisis: 'Entiende tus ingresos, gastos y tendencias.',
        configuracion: 'Controla el acceso, la privacidad y tus integraciones.',
      })[this.view()] ?? 'Tu información financiera permanece protegida.',
  );
}
