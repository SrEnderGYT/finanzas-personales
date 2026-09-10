# P08 — Movimientos manuales y outbox

Base P07 908718e. PR separado sobre feature/p07-accounts-categories. Sin merge, P09 ni P10.

## Contrato aprobado

Solo gasto/ingreso. businessDate YYYY-MM-DD y timezone son obligatorios, persistidos e inmutables; inicialmente America/Lima. occurredAt opcional, nunca inventar hora. Money y reglas pertenecen a P06. Cuenta y categoría pertenecen a P07. No se aceptan saldos, asientos ni propietario desde payload.

La UI siempre guarda pending, también online. Sin worker, envío, polling ni confirmación ficticia. Confirmación de servidor es un servicio interno probado: movimiento/journal/recibos juntos o ninguno. La única excepción P06 es extracción de ejecución dentro de transacción contextualizada, manteniendo comportamiento público.

## Bloques y aceptación

1. Comando puro, fechas obligatorias y JSON exacto.
2. Confirmación interna atómica y aislamiento PostgreSQL.
3. Bóveda separada por perfil/entorno sobre cifrado P03 y CAS durable.
4. Outbox idempotente, estados y leases; ninguna transición de envío desde UI P08.
5. Catálogo cifrado, formulario gasto/ingreso y pendientes Web/Mobile.
6. Reapertura offline, SQLCipher Android real, evidencia iOS disponible, regresiones y CI.

Sin datos reales en fixtures. Dashboard sigue DEMO; espacios separados. No editar/borrar comandos encolados. Sin backup/recuperación prometidos; corrupción o clave perdida falla sin reinicialización. Builds no equivalen a pruebas físicas. Evidencia y límites finales se registrarán en este documento y el PR.

## Implementación y fronteras

- `packages/domain/src/manual-movements`: normalización cerrada, Money positivo, referencias de producto, nota NFC hasta 500 caracteres sin controles. Comando versión 1 con operationId/deviceId/movementId y baseVersion `"0"`. IDs no cambian al reintentar.
- `backend/api/src/manual/service.ts`: confirmación interna sin controlador HTTP. `UserDatabase.asUser` mantiene una sola transacción; bloqueos catálogo → ledger; consulta el recibo manual antes de comprobar referencias activas. Un replay después de archivar una categoría devuelve el mismo acuse. El hash incluye nota, fecha y zona.
- Migración `018_manual_movements.sql`: movimientos y recibos, RLS ENABLE/FORCE, FK privadas, privilegios SELECT/INSERT. Validación diferida exige journal sellado compatible, importe/moneda/fechas idénticos y asiento de la cuenta técnica enlazada por P07. Los saldos siguen perteneciendo al ledger.
- `LedgerService.executeInTransaction`: única extracción P06; comprueba el usuario de la conexión. La API pública conserva validación y comportamiento. Prueba de rollback externo verifica que ningún recibo sobreviva.
- `ProductVault`: metadata versión 1 y registros AES-GCM, AAD por perfil/entorno/registro. IndexedDB usa transacciones readwrite para CAS; SQLite usa UPDATE condicionado por ciphertext anterior. El cambio de perfil o segundo plano borra claves y vistas descifradas de memoria.
- `ManualSession`: bases distintas por identificador hash del perfil y entorno. Catálogo cifrado completo, sin saldo almacenado. Las versiones P07 se conservan cuando vienen del servidor. No persiste tokens. El registro local permite reabrir un perfil previamente preparado sin fingir una sesión del servidor.
- `ManualOutbox`: comando y estado en una única fila cifrada. Cinco inserciones concurrentes con mismo ID/hash recuperan la misma fila; contenido diferente se rechaza. El pendiente no modifica saldos del dashboard.
- `/registro` y `/pendientes`: formulario compartido con disposición responsive, fecha requerida y America/Lima visible. La navegación móvil `+` abre el registro local. `/nuevo` conserva el antiguo formulario DEMO de sesión. El dashboard continúa DEMO.

## Máquina de estados preparada, sin transporte

| Estado | Transición interna permitida | Condición |
| --- | --- | --- |
| pending | sending | CAS y nuevo ID de intento |
| sending | retryable | Lease de 60 s vencido o error transitorio del intento vigente |
| sending | failed | Rechazo/conflicto definitivo del intento vigente |
| sending | confirmed | Acuse con operationId, movementId y hash iguales, propietario correcto e instante válido |
| retryable | sending | Nuevo intento mediante CAS |
| failed / confirmed | Ninguna | Registro terminal conservado |

La UI de P08 solo llama enqueue/list: nunca claim/finish ni envío de movimientos. Los acuses usados para probar estados son sintéticos. En P09 el transporte autenticado será responsable de entregar el acuse real. Una respuesta perdida se recupera reenviando el mismo comando; no se inventa un nuevo identificador. No hay worker, polling, backoff, pull o reconciliación.

## Cómo revisar la experiencia

En el [preview Web](https://srendergyt.github.io/finanzas-personales/#/registro), elegir «Probar con datos DEMO», crear una frase local de 12 caracteres o más y registrar datos ficticios. Para probar offline, cargar primero la aplicación, desconectar, guardar, cerrar y reabrir, desbloquear y comprobar el pendiente. Reconectar no lo confirma.

El [preview Mobile](https://srendergyt.github.io/finanzas-personales/mobile/#/registro) usa IndexedDB al abrirse en navegador. El APK utiliza SQLCipher y PIN local con secreto adicional en almacenamiento seguro del dispositivo; requiere bloqueo del dispositivo. No se afirma que la biometría esté vinculada criptográficamente al desbloqueo de P08.

Para producto se requiere la configuración de autenticación P05 y catálogos P07 ya creados. La descarga GET se limita a `/v1/me`, `/v1/accounts` y `/v1/categories`. El preview público mantiene autenticación deshabilitada. Una sesión expirada no impide desbloquear un perfil local preparado, pero sí actualizar su catálogo. Archivar cuentas/categorías después de descargar puede invalidar un pendiente en su futura confirmación P09.

## Evidencia y pruebas

| Capa | Evidencia |
| --- | --- |
| Dominio | Fecha/zona requeridas, coherencia occurredAt, Money exacto, JSON, moneda y categorías compatibles |
| PostgreSQL real | Confirmación concurrente cinco veces, A/B, gasto/ingreso, rollback entre journal y movimiento, replay tras archivo; regresiones P06/P07 y 10.000 comandos sintéticos |
| Bóveda/outbox | CAS concurrente, cinco reintentos, reapertura, clave incorrecta, corrupción, cuota simulada, lectura en curso al bloquear, perfil distinto y base conocida ausente |
| Web | Playwright cierra el proceso del navegador y reabre un perfil persistente sin red; queda una fila con fecha/zona originales. Validación conserva importe/nota. Axe revisa el formulario |
| Android | Instrumentación sobre app instalada con plugins reales, modo avión, guardado, force-stop, reapertura y cabecera SQLCipher; resultados y capturas en artifact android-offline del CI |
| iOS | Build de simulador sin firma. Sin pruebas físicas, TestFlight ni afirmación de persistencia nativa iOS validada |

Capturas: [desktop](evidence/P08/desktop.png), [mobile claro](evidence/P08/mobile-light.png), [mobile oscuro](evidence/P08/mobile-dark.png), [reapertura](evidence/P08/reopened-offline.png). Las capturas de navegador no acreditan almacenamiento nativo. APK y procedencia (commit, versión, fecha, entorno, tipo de build) se adjuntan en artifact Android de Calidad.

## Límites y revisión

No se recupera una clave perdida ni se reinicializa una bóveda dañada. El borrado total del almacenamiento del navegador puede ser indistinguible de una primera instalación; no hay backup. El borrador sin guardar vive en memoria y se elimina al bloquear. Un comando ya guardado es durable mientras el almacenamiento del dispositivo exista. Las validaciones del reloj local se repiten en servidor.

No se implementan transferencia, pago, reembolso, reverso o ajuste como movimientos de producto; sus reglas P06 no se duplican. No se administra catálogo, no hay tarjetas ni presupuestos. P09 y P10 quedan fuera. Revisar el PR #9 antes de cualquier merge o fase siguiente.
