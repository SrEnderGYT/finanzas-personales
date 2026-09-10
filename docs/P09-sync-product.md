# P09 — Sync backend y modo producto

Base remota inspeccionada: P08 `8dedbd8`, PR #9, apilado y sin merge. Su CI Web/backend/PostgreSQL e iOS pasa; la prueba Android de captura falla esperando el render del WebView. No se considera una prueba de persistencia nativa fallida ni se elimina; se diagnosticará en la validación móvil de P09.

## Alcance ejecutable

1. API autenticada POST `/v1/sync/commands` y GET `/v1/sync/changes`, recibos P08 y eventos atómicos privados.
2. Coordinador sobre outbox cifrado existente: subida, acuses reales, leases, reintentos acotados, parada por sesión/permisos y pull paginado durable.
3. Modo producto autenticado sin cifras DEMO, movimientos reales, acceso al formulario y última sincronización. Inicio sin analítica ficticia; DEMO separado explícitamente.
4. Pruebas de pérdida de respuesta, A/B, revocación, 422 terminal, reconexión, reapertura y páginas repetidas. Evidencias y PR separados; sin P10 ni merge.

## Contratos implementados

El POST acepta el comando P08 cerrado, sin usuario, con businessDate/timezone obligatorios. Devuelve 200 `{status: applied | already_applied, receipt}`. El recibo mantiene operationId, movementId, payloadHash y recordedAt. 409 representa conflicto; 422 entrada inválida; 401/403 paran acceso o subida según el caso. La identidad siempre procede del verificador P05.

Migración 019: `sync_heads` y `sync_changes` con RLS forzada y FK privadas. Un trigger agrega el evento al insertar el recibo manual, en la misma transacción que journal/movimiento. El contador por usuario se bloquea transaccionalmente, evitando saltarse un commit tardío como ocurriría con una secuencia global asignada antes de confirmar. Se incorporan los registros P08 preexistentes durante la migración.

El cursor codifica generación privada del usuario y secuencia decimal entera. La generación se valida contra la identidad autenticada; un cursor ajeno obtiene 403. Sin retención ni eliminación de cambios en P09. Cambios de generación requieren recuperación futura, no se borra almacenamiento local para resolverlos.

El cliente guarda cada página y su cursor en un único registro cifrado con CAS. Los movimientos confirmados son copias del servidor, no un libro contable ni saldos calculados en UI. Una página repetida conserva IDs y no duplica registros. No se implementa resolución de conflictos P10.

## Validación eficiente

`npm run test:postgres -- --suite=tests/sync.integration.test.ts` ejecuta únicamente sync contra una base desechable y las migraciones reales. El modo completo mantiene todas las suites. Los checks completos se reservan para bloques publicados o cierre; los cambios ajenos al cliente móvil no deben volver a ejecutar emuladores.

No hay contratación de infraestructura ni credenciales nuevas. El despliegue de producto requerirá API HTTPS y PostgreSQL configurados; el preview estático mantiene un modo de prueba explícito. Se documentará la configuración y cualquier falta de staging al entregar.
