# P06 — Money, fechas y ledger

Estado: implementación del plan aprobado. Base: P05 d32c904. PR independiente sobre feature/p05-auth; sin merge automático ni P07.

## Invariantes

Dinero exacto bigint y strings JSON; moneda explícita PEN/USD sin FX; partida doble; propietario único por FK/RLS; confirmación atómica; asientos inmutables; gasto de tarjeta una vez; pago/transferencia sin gasto adicional; reembolsos limitados al original en su fecha efectiva; reversos exactos únicos; recibos idempotentes por usuario; conflictos sin última escritura gana; fechas y zona explícitas; pendiente offline no equivale a confirmado.

## Bloques y aceptación

1. Money: parser canónico, rango BIGINT simétrico, redondeo explícito; tests de exactitud y límites.
2. Fechas: calendario civil, instante opcional, zona IANA, reloj inyectable; tests UTC/Lima/DST y fechas inválidas.
3. Ledger puro: reglas de gasto, ingreso, transferencia, pago, reembolso, ajuste y reverso; dos asientos balanceados por operación.
4. PostgreSQL: cuentas técnicas, cabeceras selladas, asientos, RLS y FK compuestas; SQL directo no puede confirmar registros inválidos.
5. Idempotencia/concurrencia: comando versionado, recibo/auditoría atómicos, reembolsos/reversos/correcciones serializados por usuario.
6. Cierre: serialización offline, 10.000 operaciones sintéticas, regresión y CI completo.

Sin API financiera, UI nueva, cuentas de producto, categorías, sincronización real, Gmail, datos reales o secretos. El dominio no depende de autenticación ni frameworks. Se reutilizan UserDatabase y migraciones sin cambiar contratos P05. Capturas nuevas no aplican: no hay cambios visuales.
