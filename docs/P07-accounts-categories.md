# P07 — Cuentas y categorías

Base aprobada: P06 `7d7c6f3`. PR separado sobre feature/p06-ledger; sin merge automático ni P08.

## Decisión arquitectónica

La cuenta de producto conserva nombre, tipo, estado y posición. Se vincula uno a uno a una cuenta técnica asset de P06 mediante propietario y moneda. IDs distintos, moneda y vínculo inmutables. Crear cuentas no genera asientos: saldo cero; las lecturas reutilizan LedgerStore.balances y Money. No se crean movimientos ni saldos paralelos.

Categorías planas expense/income, sin moneda ni vínculo contable. Plantillas públicas de solo lectura se copian explícitamente al usuario; sus copias son personalizables y archivables. Ahorro no es gasto; Deudas se limita a intereses/comisiones. Inicializar otra vez no sobrescribe personalizaciones.

Los recibos de P06 requieren journals. P07 usa recibos y auditoría de catálogo separados, con canonicalización compartida, versión esperada y bloqueo transaccional por usuario. Mutación, resultado y auditoría se confirman juntos. No se modifica P06.

## Invariantes y aceptación

- RLS forzada en tablas privadas; FK compuestas; ningún selector de propietario desde HTTP.
- No DELETE: archivo/reactivación preservan IDs e historia. Moneda, propietario, vínculo, naturaleza y origen inmutables.
- Nombres NFC recortados, 1–80 caracteres sin controles; duplicados permitidos. Posición 0–2147483647, empates por ID.
- Versiones y dinero en strings JSON. Mismo operationId/contenido devuelve resultado original; contenido distinto o versión antigua da conflicto.
- Cuentas savings/current/cash/wallet/investment/other; inversiones sin valoración. Saldos negativos permitidos por P06.
- Dominio puro, PostgreSQL real, API autenticada; sin UI, ajustes iniciales, outbox, sync, tarjetas, presupuestos ni Gmail.

## Entrega por bloques

Contratos; recibos/auditoría (015); cuentas y vínculo (016); plantillas/categorías (017); API autenticada; pruebas transversales. Cada bloque incluye pruebas. CI final, aislamiento A/B, SQL directo, concurrencia y regresiones P01–P06 son puerta de revisión.

Preview existente sin cambios: https://srendergyt.github.io/finanzas-personales/ . Capturas nuevas no aplican. Solo fixtures sintéticas. Resultados finales se documentan en el PR.
