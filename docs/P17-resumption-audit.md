# P17 — continuidad y verificación, 15 de septiembre de 2026

## Estado reconstruido

El checkout anterior estaba limpio en P10 `c65bb0a`. Su validación completa
[34636721757](https://github.com/SrEnderGYT/finanzas-personales/actions/runs/34636721757)
terminó correctamente. La preparación de PostgreSQL con propietario restringido
y la retirada de variables temporales preceden a esta revisión.

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

## Siguiente validación

Restituir durabilidad e idempotencia en el flujo manual y el acceso al espacio
cifrado; adaptar los recorridos de navegador a la navegación actual conservando
sus aserciones contables, A/B, reapertura y 409. Después ejecutar las suites
afectadas, verificar migraciones/despliegue de P17 y cerrar con CI y evidencias
Web/Android/iOS. P17 permanece abierto y no está completo. No se hizo merge.
