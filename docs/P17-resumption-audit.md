# P17 — continuidad y verificación, 15 de septiembre de 2026

## Estado reconstruido

El checkout anterior estaba limpio en P10 `c65bb0a`. Su validación completa
[34636721757](https://github.com/SrEnderGYT/finanzas-personales/actions/runs/34636721757)
terminó correctamente. La preparación de PostgreSQL con propietario restringido
precede a esta revisión; no se presupone que todas las variables temporales
hayan sido retiradas de la configuración guardada.

GitHub contiene trabajo posterior válido. P17, PR #15, estaba en `ffc2fa3`,
incluyendo el rediseño integrado desde PR #16. Se continúa sobre
`feature/p17-real-app`; no se restaura la interfaz P10 ni se modifica su rama.
Se conservan los estilos compartidos, navegación, Gmail readonly, clasificación,
vistas financieras y migraciones 021–027 incorporadas posteriormente.

## Infraestructura observada

- Render `finanzas-personales-staging` continúa en plan Free, Oregon.
- Su rama configurada sigue siendo `feature/p10-conflicts-recovery`, con
  autodeploy y commit desplegado `4de76cc`. Ese commit es antecesor de P17,
  pero no contiene el rediseño y las mejoras posteriores.
- El despliegue `dep-dairvjek1f9s739dat0g` figura como `live`.
- HTTPS `/health` devuelve 200 y `status: ok`; ya no está en bootstrap.
  Esta comprobación no demuestra por sí sola login, Gmail ni flujo financiero.
- El dashboard confirma `STAGING_MODE=runtime`. Todavía muestra los nombres
  `STAGING_ADMIN_URL` y `STAGING_TEST_PASSWORD` con valores ocultos: esto no
  demuestra que contengan valores activos. No se revelaron ni borraron secretos.
- PostgreSQL 17 `finanzas-p10-staging` figura disponible, Free, con caducidad
  10 de octubre de 2026 y lista externa de IP vacía. No se cambió su aislamiento.
- La consulta de metadatos mediante el conector no pudo conectarse; por tanto
  el conjunto efectivo de migraciones aplicado queda por verificar desde una
  conexión autorizada. No se consultaron movimientos ni credenciales.

No se ha cambiado todavía la rama de Render: primero deben resolverse las
regresiones y verificar la compatibilidad de las migraciones pendientes.

## CI y clasificación de fallos

En `ffc2fa3`, [Calidad 34795413531](https://github.com/SrEnderGYT/finanzas-personales/actions/runs/34795413531):

- Lint, tipos, unitarias, integración, PostgreSQL y builds: job aprobado.
- iOS sin firma: aprobado; no equivale a instalación física/TestFlight.
- Browser/PostgreSQL: dos fallos al buscar el enlace anterior de registro.
- Android: genera APK, pero la prueba SQLCipher no llega a encontrar el shell.
- Los workflows de documentación, aplicación Web y secretos pasan.

La inspección identifica problemas reales además de selectores desactualizados:

1. Mobile no registra `AUTH_CLIENT` si no hay configuración nativa; el token ya
   no tiene factory por defecto. Web sí lo registra. Se añade la misma factory
   al bootstrap móvil, antes del override nativo. El build y una prueba de
   navegador sobre el bundle Mobile verifican login inicial sin API configurada,
   ausencia de errores JavaScript y campos deshabilitados de forma segura.
2. `ManualScreen.save()` envía directamente por HTTP y genera IDs nuevos en cada
   intento. La ruta no utiliza el outbox cifrado existente: una respuesta perdida
   puede duplicar la intención al reintentar. Requiere reparación funcional,
   no eliminar la prueba de pérdida de respuesta.
3. La carga remota establece `unlocked` sin abrir `ManualSession`. Altas de
   catálogo y correcciones todavía requieren esa sesión cifrada. Debe reconectarse
   ese ciclo de vida, manteniendo la entrada login-first y el diseño actual.
4. La prueba Android anterior entra en una ruta de preparación DEMO retirada.
   Tras reparar el arranque hay que probar SQLCipher con un recorrido de prueba
   aislado, sin volver a publicar datos sintéticos ni omitir la reapertura real.

## Reparaciones verificadas durante la continuación

- Arranque Mobile: provider de autenticación seguro cuando no hay API nativa.
- Registro manual: restaura `ManualSession`, bóveda cifrada y outbox antes del
  envío; conserva el identificador ante errores y no inventa cuentas iniciales.
- Acceso local: desbloquear no restaura una sesión del servidor. El indicador
  distingue ambos estados. Se conservan los bloqueos por perfil y segundo plano.
- Correcciones: el segundo cliente ahora espera a que termine el desbloqueo
  antes de navegar. No se elimina la cancelación de operaciones al abandonar
  el componente. [Prueba real aprobada](https://github.com/SrEnderGYT/finanzas-personales/actions/runs/35025806510)
  en `287b5e2`.
- La [suite de producto previa](https://github.com/SrEnderGYT/finanzas-personales/actions/runs/34996515283)
  aprobó cinco pruebas de autenticación y el recorrido de sync con respuesta
  perdida, journal único y reapertura cifrada; su resultado global fue fallo
  por la carrera de corrección reparada después.
- Android: fixtures restringidas a un entrypoint de instrumentación. El APK
  publicado se genera antes y comprueba que no incluya ese proveedor sintético.
  Se corrigió la instalación del SDK y un carácter corrupto en una aserción.
  La prueba completa de SQLCipher/reapertura sigue pendiente de su nuevo CI.
- PWA: se sustituye el worker que eliminaba cachés y se desregistraba por el
  worker generado de Angular. Solo precarga recursos estáticos; no hay
  `dataGroups` financieros. Se excluyen las rutas API de navegación.
- Los builds que cambian la configuración pública de autenticación actualizan
  también el hash del index, incluida la ruta de GitHub Pages. No se incluyen
  credenciales en los recursos estáticos.
- Validación local: 127 pruebas unitarias, tipos, build Web y cinco pruebas UI
  aprobadas. La PWA se comprueba cerrando el navegador y reabriendo el mismo
  perfil offline: login-first, acceso local disponible y ninguna respuesta
  `/v1` persistida en Cache Storage. WCAG AA se verifica en ambos temas.

## Puerta de despliegue y trabajo pendiente

Las migraciones posteriores 022, 024 y 025 contienen borrados de candidatos
Gmail; 023 instala una limpieza automática. No deben ejecutarse sin comprobar
historial aplicado, compatibilidad y preservación de datos. Esta continuación
no las modificó ni ejecutó contra staging. El consentimiento para mantener
datos implica revisar este punto antes de cambiar Render a P17.

Queda verificar CI completo del nuevo HEAD, SQLCipher Android, iOS sin firma,
la transición de clientes con caché histórica, configuración nativa de API y
el despliegue real con sus migraciones. La prueba de PWA nueva no acredita por
sí sola migración de todos los navegadores con una versión DEMO antigua.

P17 permanece abierto y no está completo. Render continúa en `4de76cc`; no se
desplegaron allí las reparaciones ni se hizo merge.
