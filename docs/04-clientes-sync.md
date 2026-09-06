# Arquitecturas Web, Mobile y offline

> Baseline de fase 0. Las aprobaciones y el orden de ejecución actuales están en [decisiones vigentes](09-aprobacion-ejecucion.md); prevalecen sobre estados pendientes históricos de este documento.
Estado: contratos propuestos, pendientes de prototipo y pruebas.

## Web/PWA

Angular con rutas por módulo cargadas bajo demanda; componentes de presentación y casos de uso separados. Sesión web mediante backend del mismo origen. Cliente API tipado, estado local de consulta y repositorio local de finanzas; un store de UI no será el libro contable.

Sidebar: Inicio, Movimientos, Cuentas, Tarjetas, Presupuestos, Deudas, Metas, Suscripciones, Analítica, Automatizaciones y Configuración. MVP muestra sólo rutas implementadas, registrando las futuras en roadmap. Escritorio usa tabla filtrable, panel de detalle lateral y gráficos con tabla accesible alternativa. URLs guardan periodo y filtros no sensibles; nunca tokens o importes privados en parámetros de analítica.

PWA cachea shell/versiones estáticas; no cachea respuestas autenticadas de la API indiscriminadamente. Persistencia financiera usa repositorio IndexedDB cifrado. Actualización de service worker espera migración local compatible y conserva outbox; si la versión no es compatible, mostrar recuperación antes de recargar. Offline no permite primer registro, cambio de credenciales ni conectar Gmail.

## Android/iOS

Cliente Ionic/Angular empaquetado con Capacitor. Navegación inferior Inicio, Movimientos, +, Análisis y Perfil. Acción central abre gasto, ingreso, transferencia, pago y, desde V2, deuda. La presentación puede compartir componentes simples con web, pero no impone sidebar/tabla densa al teléfono.

Adaptadores para SQLite cifrada, almacenamiento seguro, biometría, PIN local, notificaciones, red, haptics y compartir exportaciones. Bottom sheets con foco y cierre accesible, safe areas, teclado numérico según moneda, botón guardar siempre visible. Gestos tienen alternativa de botón; confirmar antes de borrar, no con un swipe accidental.

El plugin oficial de push de Capacitor requiere integración iOS y Android. Su soporte no equivale a sincronización continua en segundo plano; iOS silent push no está soportado directamente por ese plugin. La propuesta procesa Gmail en backend y sincroniza al abrir/volver a primer plano y al reconectar; tareas de fondo son mejora oportunista. Fuente: [Capacitor Push Notifications](https://capacitorjs.com/docs/apis/push-notifications).

La compilación y firma iOS requieren entorno macOS y cuenta de distribución apropiada, pendientes de configuración. La beta Android/iOS no puede considerarse validada sólo por abrir la web en un navegador móvil.

## Contrato offline

Operaciones esenciales: consultar datos descargados, crear/editar borradores y registrar gastos/ingresos/transferencias de igual moneda/pagos. Cada guardado escribe en una transacción local el comando de outbox y su proyección optimista. Etiquetas: Guardado en dispositivo; Sincronizando; Confirmado; Requiere revisión; Sesión vencida. Fecha de última sincronización siempre disponible.

```text
POST /v1/sync/commands
{ operationId, deviceId, schemaVersion, entityId, baseVersion,
  commandType, payload }

200: { operationId, status: applied|already_applied, entityVersion, result }
409: { operationId, status: conflict, currentVersion, safeCurrentState }
422: { operationId, status: invalid, fieldErrors }
401/403: bloquear subida y pedir reautenticación/permisos

GET /v1/sync/changes?cursor=<opaque>&limit=200
{ changes[], nextCursor, hasMore, cursorGeneration }
```

El cuerpo nunca fija usuario. El servidor deduce propietario, valida sesión/esquema/FK y dinero, busca `(user,operationId)` y compara hash. Aplica cambios+asientos+auditoría+evento+resultado idempotente en una transacción. Pérdida de respuesta tras commit genera reintento con el mismo ID, no otro gasto. Procesar por dependencia local: crear cuenta antes de movimiento que la referencia.

Pull paginado ordenado por secuencia duradera de usuario; aplicar página y cursor en una transacción local. Un tombstone elimina proyección confirmada, pero no pendientes sin advertencia. Reintentar fallos transitorios con backoff/jitter; 422 queda visible para corrección, nunca se reintenta infinitamente. Revocación bloquea subida; login de otro usuario no accede ni envía la outbox anterior.

## Conflictos y recuperación

No usar «última escritura gana» para importes/saldos. Si dos dispositivos editan versión 4, la primera produce versión 5 y la segunda queda en conflicto. Pantalla compara campo local/servidor y permite descartar el cambio local o crear un nuevo comando sobre versión vigente. Para asientos confirmados, corrección es reversión+sustitución. Dos categorías homónimas no se fusionan sin revisión.

Si dispositivo permanece fuera más que retención de tombstones, snapshot nuevo con generación de cursor, conservando outbox cifrada para revalidación. Migración local fallida detiene escrituras y ofrece exportar pendientes de forma protegida o reintentar; no borra base. Backend restaurado invalida generación anterior y reconstruye proyecciones. Archivar cuenta con pendientes no borra su historial.

## Contratos de lectura y cálculo

Filtros: hoy, 7 días, 15 días, mes actual, anterior, 3 meses, 6 meses, 1 año y personalizado, combinables con cuenta/tarjeta/categoría/tipo/texto. Hoy y límites mensuales usan zona del usuario; intervalos son `[inicio,inicio del día siguiente al final)` convertidos a UTC. Periodos de N días incluyen hoy; mes/3/6/12 meses son ventanas de calendario documentadas, no 30/90/180/365 días arbitrarios. Para 3/6/12 meses se propone incluir el mes actual parcial y los N-1 anteriores; se muestra rango exacto.

Búsqueda siempre privada, paginada y con tamaño máximo. CSV conserva moneda y fecha, distingue saldo inicial de ingreso y neutraliza celdas de texto que empiecen con =, +, -, @ o caracteres de control; valores numéricos se exportan como números según contrato. Cambiar moneda de vista no reescribe originales. Estado offline indica cobertura local, por ejemplo «Datos descargados hasta…»; no presenta totales parciales como completos.
