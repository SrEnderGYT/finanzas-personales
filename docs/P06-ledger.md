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

## Contratos implementados

`@finanzas/domain` exporta Money, Currency, Clock, FinancialDate, Posting, Envelope, Journal y reglas puras. Se compila por separado a CommonJS y declaraciones para reutilizarlo desde el backend sin cambiar su entrypoint ni importar fuentes fuera de rootDir. El código fuente permanece libre de frameworks/autenticación; TypeScript mantiene alias para clientes y tests.

Money minor/decimal/fromJSON valida moneda y rango simétrico BIGINT. ratio exige numerador y denominador bigint y política HALF_EVEN/HALF_AWAY_FROM_ZERO/TRUNCATE. JSON contiene strings exactos; la presentación localizada queda fuera del dominio. Los saldos persistidos se calculan con SUM numeric de PostgreSQL y se devuelven como strings firmados de saldo deudor; activos/gastos positivos y pasivos/ingresos normalmente negativos. Nunca sumar monedas distintas. Las cuentas técnicas no son las cuentas de producto P07.

LedgerService.execute recibe contexto de usuario verificado y Envelope versión 1. El sobre contiene operationId/deviceId/entityId, baseVersion como string y command discriminado post/reverse/correct. No acepta user_id. Post referencia cuentas de débito/crédito y el dominio valida sus naturalezas; no recibe listas arbitrarias de asientos. Ajuste requiere razón y su dirección se expresa en las cuentas. Refund exige originalId de un gasto; reverse referencia el original; correct incluye originalId, reversalId y replacement. Corrección crea reverso y reemplazo en un commit.

Resultados: applied/alreadyApplied contienen los mismos transactionIds guardados; conflict/invalid devuelven códigos estables sin SQL/credenciales. Un error de infraestructura se propaga y no deja recibo. VERSION_CONFLICT, IDEMPOTENCY_CONFLICT, ACTIVE_REFUNDS, ALREADY_REVERSED y REFUND_LIMIT requieren revisión; no sobrescriben dinero.

## Persistencia e invariantes

Migraciones 010–014: cuentas técnicas, cabeceras selladas, dos asientos por journal, recibos idempotentes y auditoría. FK privadas incluyen usuario y moneda. RLS forzada; runtime sólo tiene SELECT/INSERT y UPDATE(sealed) limitado por trigger. Las cabeceras selladas no se editan ni eliminan; las entradas tampoco. El saldo y la condición de reversado derivan de asientos/referencias. No se aplican deleted_at ni un updated_at mutable a este historial append-only.

La versión se deriva de 1 más las referencias al original y reversos de sus reembolsos. La identidad del usuario no viene del payload; el adaptador futuro debe obtenerla de IdentityVerifier antes de invocar el servicio. Las escrituras se serializan con advisory lock transaccional ledger:userId. Después del lock se valida versión, saldo reembolsable e idempotencia. Cinco reintentos conservan una operación; contenido diferente bajo el mismo ID da conflicto. Un ID repetido por otro usuario pertenece a otro espacio privado.

Reembolsos reducen gasto en su fecha efectiva y misma moneda. Un gasto con reembolsos activos no puede revertirse; revertir un reembolso libera capacidad. No hay reverso de reverso. Se permiten activos negativos y pasivos con saldo a favor: el ledger registra hechos y no ejecuta pagos ni impone límites bancarios.

El recibo y la auditoría de operaciones aplicadas se guardan junto con sus asientos. Auditoría conserva usuario, operación, entidad, acción, fecha y resultado; no duplica importes ni payload. No se purgan recibos en P06: una retención futura necesita preservar la garantía de idempotencia para dispositivos antiguos.

## Validación y límites

Unitarias de exactitud, calendario, zona, redondeo, reglas y secuencias deterministas. PostgreSQL prueba SQL directo inválido, propietario A/B, rollback, sellado, cinco reintentos, conflicto de contenido, reembolsos/reversos concurrentes y corrección fallida después de insertar el reverso. La prueba de volumen persiste 10.000 comandos sintéticos, repartidos entre PEN y USD, comprueba saldos/recibos y reintenta el último comando. Tiene un límite operativo de 180 segundos; no es un benchmark móvil.

Las pruebas actuales de P03 y P05 permanecen en regresión. Serialización del sobre no equivale a sincronización: P06 no toca el vault DEMO, no implementa outbox ni pull, no añade endpoints, no conecta auth al preview. Validación física nativa y servicios externos siguen siendo pruebas posteriores y no bloquean este bloque de dominio/persistencia.

CI y resultados finales se enlazarán en PR #7. Screenshots nuevas: no aplican, no cambia la interfaz. Preview existente: https://srendergyt.github.io/finanzas-personales/ . P07 requiere revisión posterior; no merge automático.

## Rendimiento y diagnósticos

La primera ejecución PostgreSQL confirmó nueve casos de integridad/concurrencia, pero el volumen superó 180 segundos. La migración 013 materializa el catálogo público de nombres de zona para una validación indexada; el dominio utiliza una caché limitada a 128 formateadores sin datos de usuarios. Se mantiene el mismo volumen, límite y validaciones. La prueba histórica de migraciones se actualizó de nueve a catorce, sin cambiar autenticación P05. El ejecutor sólo expone nombre de migración, SQLSTATE y posición al diagnosticar fallos.

La migración 014 liga cada journal a su recibo mediante FK diferida; verifica que el resultado enumere exactamente los journals y que su auditoría esté presente. Impide agregar posteriormente asientos a un recibo ya confirmado. Falla cerrada si una base experimental anterior tiene journals sin recibos; no inventa trazabilidad. CI previo con catálogo indexado completó 10.000 comandos en aproximadamente 39 segundos; la ejecución final vuelve a validar el volumen con estas restricciones. El catálogo de zonas es público y de sólo lectura para runtime; las diecinueve tablas privadas conservan RLS forzada.
