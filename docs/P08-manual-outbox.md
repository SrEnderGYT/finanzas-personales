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
