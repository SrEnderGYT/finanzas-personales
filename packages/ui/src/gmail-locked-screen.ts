import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { UI_PRIMITIVES } from './primitives';

@Component({
  selector: 'fp-gmail-locked-screen',
  imports: [RouterLink, ...UI_PRIMITIVES],
  styleUrl: './gmail-screen.css',
  template: `
    <section class="gmail-page">
      <header class="gmail-heading">
        <div>
          <p class="eyebrow">AUTOMATIZACIÓN</p>
          <h1>Gmail</h1>
          <p>
            Conecta tu correo con autorización separada para detectar avisos financieros. El acceso
            a Finanzas y el permiso de lectura de Gmail son consentimientos diferentes.
          </p>
        </div>
        <span class="gmail-status">Sin conectar</span>
      </header>

      <div class="gmail-grid">
        <section class="gmail-card">
          <p class="eyebrow">CONEXIÓN</p>
          <h2>Conectar Gmail</h2>
          <p>
            Primero inicia sesión en Finanzas. Después podrás elegir el rango inicial y autorizar
            Gmail mediante Google con permiso de solo lectura.
          </p>
          <dl class="gmail-facts">
            <div>
              <dt>Cuenta</dt>
              <dd>—</dd>
            </div>
            <div>
              <dt>Permiso</dt>
              <dd>gmail.readonly</dd>
            </div>
            <div>
              <dt>Última sincronización</dt>
              <dd>—</dd>
            </div>
            <div>
              <dt>Estado</dt>
              <dd>Requiere sesión</dd>
            </div>
          </dl>
          <a fpButton routerLink="/acceso">Iniciar sesión</a>
        </section>

        <section class="gmail-card">
          <h2>Privacidad de la conexión</h2>
          <ul class="gmail-list">
            <li>Finanzas no necesita tu contraseña de Gmail.</li>
            <li>El permiso previsto es de solo lectura.</li>
            <li>Puedes desconectar Gmail desde la aplicación.</li>
            <li>Los candidatos ambiguos deben revisarse antes de convertirse en movimientos.</li>
          </ul>
        </section>
      </div>

      <section class="gmail-card" style="margin-top: 20px">
        <div class="gmail-card-heading">
          <div>
            <p class="eyebrow">BANDEJA FINANCIERA</p>
            <h2>Avisos detectados</h2>
            <p>
              Después de conectar Gmail, aquí aparecerán los avisos financieros detectados para que
              puedas confirmar, corregir o descartar cada candidato.
            </p>
          </div>
        </div>
        <p>No hay avisos cargados sin una sesión autenticada.</p>
      </section>
    </section>
  `,
})
export class GmailLockedScreen {}
