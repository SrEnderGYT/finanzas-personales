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

## API y comandos

GET/POST `/v1/accounts` y `/v1/categories`; GET/PATCH `/:id`; POST `/v1/categories/initialize`. Todas las rutas exigen la IdentityVerifier existente (sesión revocable en servidor). No se amplía CORS ni se añaden cookies; sin endpoints DELETE. El JSON OpenAPI existente describe entradas/salidas.

Sobre: operationId UUID, deviceId UUID, schemaVersion 1, baseVersion string y command. Crear usa baseVersion "0", editar la versión vigente. command contiene type (`account.create`, `account.update`, `category.create`, `category.update`), id UUID y payload. Inicializar usa solo type `category.initialize`, baseVersion "0". El ID de ruta y comando deben coincidir. Estado active y posición son explícitos al crear. No acepta user_id, saldo ni ID técnico.

Resultados aplicados: `{status: "applied" | "alreadyApplied", result: {changes: [{id, entity, version}]}}`. Inicializar sin faltantes devuelve changes vacío. POST devuelve 201 y PATCH 200, también en reintentos. Reintentos posteriores a otras ediciones conservan el resultado original, no una lectura actualizada.

GET individual incluye archivadas/inactivas. Listas: state active por defecto, inactive/archived o all; cuentas permiten type/currency, categorías kind. limit entre 1 y 100, por defecto 50. Orden position/id y nextCursor `posición:UUID`; no es una instantánea estable si se reordena entre páginas. Se rechazan parámetros desconocidos. Nombres duplicados no se fusionan.

Errores: 401 credencial inválida/expirada/revocada; 404 entidad ajena o ausente; 400 entrada o restricción inválida; 409 VERSION_CONFLICT/IDEMPOTENCY_CONFLICT/ENTITY_CONFLICT. BALANCE_UNAVAILABLE/BALANCE_OUT_OF_RANGE devuelve 503 sin inventar saldo. UUID mal formado es entrada inválida. Fallos de infraestructura siguen el filtro seguro existente. Códigos P07 se limitan a sus controladores para conservar respuestas P05.

La lectura obtiene metadatos y balances en consultas separadas; el saldo es el observado en la consulta del ledger, no una instantánea conjunta con nombre/estado. Sin totales globales ni mezcla de monedas. Money rechaza fuera de rango explícitamente. El DTO oculta propietario, ID técnico y recibos internos.

## Persistencia y auditoría

015–017 crean cinco tablas privadas con RLS forzada y un catálogo público de plantillas sin datos de usuarios. El runtime no es propietario, no tiene BYPASSRLS y no puede editar plantillas. Las tablas privadas totales pasan de 19 a 24; los dos catálogos globales son explícitamente de solo lectura.

Nombre/tipo/estado/posición/version/operation_id son las únicas columnas editables según entidad. Triggers conservan identidad, moneda, naturaleza, origen y fechas de creación, y exigen incremento de versión. Restricciones diferidas exigen que cada mutación esté en su recibo y auditoría; una actualización no puede anexarse a un recibo antiguo. Las referencias de auditoría a cuentas/categorías también usan propietario compuesto. Auditoría no copia nombres, importes o payloads.

El bloqueo `catalog:userId` serializa metadatos; no se anida una llamada asUser para crear la cuenta técnica. P06 queda intacto, incluyendo sus reglas monetarias, fechas, recibos y bloqueo financiero. No hay outbox ni confirmación offline. Una futura composición catálogo/ledger debe fijar orden de bloqueos y usar una única transacción; no se implementa en P07.

Plantillas: 19 gastos y 2 ingresos (Sueldo y Otros ingresos). Las copias privadas pueden renombrarse y archivarse; origen system deriva de template_key inmutable. Ahorro no aparece como gasto. Deudas: intereses y comisiones no determina la clasificación contable: pagos de capital y transferencias permanecen neutrales según P06. No hay parent_id, jerarquía ni asignación de categoría a asientos todavía.

## Límites operativos

P07 no añade infraestructura pública de API, límites distribuidos de tráfico ni pruebas físicas de dispositivos. Reutiliza el tamaño máximo de cuerpo, autenticación, cabeceras y logs mínimos de la API existente. Antes de exponer una beta pública se debe completar el hardening de tráfico del roadmap. Receipts no se purgan: una política futura debe conservar idempotencia.
