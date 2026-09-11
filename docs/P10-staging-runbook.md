# P10 — preparación de staging privado

Estado: scripts preparados; despliegue y validación en Render pendientes. No acredita
staging funcional ni cierre de P10. Solo se permite el plan Free y datos sintéticos.

## Servicio

- Repositorio: `SrEnderGYT/finanzas-personales`.
- Rama: `feature/p10-conflicts-recovery`, sin merge.
- Runtime Node, región Oregon, instancia Free de US$0.
- Build: `npm ci && node scripts/build-staging.mjs`.
- Start: `node scripts/start-staging.mjs`.
- Health: `/health`.

El build genera Web/PWA y API. Habilita autenticación same-origin únicamente en
los assets de staging y actualiza el hash del service worker. El build normal de
GitHub Pages conserva autenticación deshabilitada. No se empaquetan secretos.

## Configuración privada en el proveedor

Los valores sensibles se introducen exclusivamente en las variables protegidas de
Render. No deben copiarse a Git, issues, capturas ni logs.

Variables persistentes:

- `STAGING_ROLE_SECRET`: secreto aleatorio de 32 a 256 caracteres. Conservarlo;
  cambiarlo no rota roles existentes y haría inaccesibles los datos cifrados asociados.
- `STAGING_DATABASE_HOST`: hostname interno de la base seleccionada, sin puerto.
- `STAGING_DATABASE_NAME`: nombre de esa base.
- `STAGING_MODE`: primero `bootstrap`, después `runtime`.

Variables temporales, solo para bootstrap:

- `STAGING_ADMIN_URL`: conexión administrativa interna de la misma base.
- `STAGING_TEST_PASSWORD`: contraseña privada de 15 a 128 caracteres para la cuenta
  sintética `reviewer@example.test`.

El propietario introduce y guarda las credenciales nuevas desde el panel. El agente
no debe publicarlas ni introducirlas mediante automatización del navegador.

## Dos etapas separadas

1. Bootstrap ejecuta migraciones versionadas y crea roles LOGIN restringidos que
   pertenecen a los grupos runtime existentes. Comprueba los permisos reales con
   los validadores P04/P05. Si el proveedor no permite crear esos roles, detener
   el despliegue; no sustituirlos por la conexión administrativa para servir la API.
2. Bootstrap utiliza el flujo P05 de verificación para una invitación sintética
   privada. El token solo pasa por memoria; no se envía correo ni se configura SMTP.
   Una cuenta ya verificada conserva su contraseña.
3. El servidor responde `bootstrap-ready` y todavía no expone la API financiera.
4. Eliminar `STAGING_ADMIN_URL` y `STAGING_TEST_PASSWORD` del entorno del servicio,
   establecer `STAGING_MODE=runtime` y desplegar otra vez.
5. Runtime rechaza arrancar si quedan variables temporales. Sirve Web/PWA y API
   bajo el mismo origen HTTPS usando únicamente conexiones con roles restringidos.

Registro público y recuperación por email permanecen cerrados en este staging
por invitación. No se afirma que haya correo transaccional o Google configurados.
La cuenta nueva no recibe cuentas, categorías ni saldos ficticios. La interfaz de
alta basada en P07 y su prueba de recorrido siguen pendientes antes de entregar
el entorno como funcional.

## Validación y recuperación

Comprobar HTTPS, login, creación de cuenta/categoría, persistencia cifrada,
sincronización y corrección entre dos clientes. No basta con `/health` ni un build.
Conservar RLS, aislamiento A/B y los identificadores de reintento.

Ante un despliegue fallido, detener el servicio o volver a un commit compatible
con las migraciones aplicadas. Nunca deshacer migraciones eliminando journals,
pendientes o recibos. La caducidad del plan gratuito no ofrece recuperación de
datos: este entorno temporal no debe contener información financiera real.
