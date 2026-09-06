# Producto y descubrimiento

> Baseline de fase 0. Las aprobaciones y el orden de ejecución actuales están en [decisiones vigentes](09-aprobacion-ejecucion.md); prevalecen sobre estados pendientes históricos de este documento.
Estado: propuesto · 6 septiembre 2026 · responsable de aprobación: propietario del producto.

## Resumen ejecutivo

Crear una única fuente de información financiera conciliable y explicable. El usuario registra una compra una sola vez, ve su efecto en el presupuesto y en la deuda de tarjeta, y conserva la operación aunque pierda conexión. Gmail reduce la captura manual, pero los mensajes ambiguos quedan para revisión. El saldo bancario confirmado, los movimientos pendientes y una proyección deben distinguirse siempre.

La primera versión será una beta privada. El valor inicial será conocer gastos del periodo, saldo de cuentas, utilización de tarjetas y presupuesto disponible; no prometer fechas de salida de deudas a partir de información incompleta. Los compromisos detallados, cobranza y simulaciones pertenecen a V2. La información del proyecto anterior no se importa automáticamente; cualquier futura migración requerirá mapeo y revisión propios.

## Objetivos y medidas propuestas

| Objetivo | Evidencia de aceptación |
| --- | --- |
| Registro confiable | Un mismo evento importado o reenviado no aumenta dos veces el saldo |
| Menos captura manual | Aviso BCP soportado genera candidato con importe, moneda, fecha y procedencia |
| Trabajo sin conexión | Crear una operación, cerrar y abrir la app, reconectar y obtener una sola operación |
| Comprensión financiera | Cada cifra muestra periodo, moneda, definición y acceso al detalle |
| Privacidad | Pruebas de usuario A contra B fallan en API, búsqueda, exportación y sincronización |
| Mantenimiento | Reglas financieras independientes de frameworks y parsers intercambiables |

## Supuestos para poder planificar

Se propone español, PEN como moneda inicial de visualización y America/Lima como zona inicial, ambos editables. USD se mantiene separado hasta disponer de una conversión explícita. La capacidad objetivo de diseño es uso personal y una beta de hasta 100 usuarios: es un supuesto para dimensionar pruebas, no demanda medida. Se supone un equipo pequeño; experiencia real con Angular/Flutter, disponibilidad semanal y presupuesto cloud están pendientes.

No conocemos todavía formatos bancarios autorizados de prueba, dispositivos mínimos, cuenta de desarrollador Apple, propiedad del proyecto Google Cloud, condiciones de publicación OAuth ni presupuesto de operación. Estos puntos condicionan implementación y publicación, pero no impiden preparar la arquitectura. No se necesitan contraseñas bancarias para resolverlos.

## Versiones y alcance exacto

| Versión | Incluye | Excluye |
| --- | --- | --- |
| MVP / beta privada | Google y email verificado; sesión y revocación; cuentas y categorías; registro manual de gastos, ingresos, transferencias, pagos, reembolsos y ajustes; tarjetas con saldo, línea, corte y pago; presupuesto mensual; dashboard básico; búsqueda y todos los filtros temporales; CSV; offline de operaciones esenciales y sincronización; Gmail BCP con revisión; auditoría mínima | IA, varios bancos a la vez, préstamos con cronograma y cobranza, metas avanzadas, detección de suscripciones, Excel/PDF, proyecciones, inversiones complejas |
| V2 | Deudas por pagar y por cobrar, capital/intereses/cuotas/abonos y simulaciones; metas y aportes; recurrencias confirmables y suscripciones; presupuestos con alertas progresivas; Excel/PDF; expansión gradual a BBVA, Interbank, Scotiabank, Oh!, Yape y Plin; notificaciones push y automatización programada; analítica comparativa y proyecciones explicadas | IA generativa, ejecución automática de pagos, open banking no oficial |
| V3 | Asistente de consultas sobre agregados propios, explicaciones de ahorro/deudas/metas; mejoras de analítica y accesibilidad según beta | Acceso a otros usuarios, envío autónomo a deudores, recomendaciones automáticas de crédito o promesas de rendimiento |

MFA opcional y desbloqueo biométrico/PIN son requisitos de seguridad de la beta, no funcionalidades que se eliminan por no aparecer en la lista breve del MVP. Avisos dentro de la app para importaciones, errores de sincronización y vencimientos básicos pertenecen al MVP; push programado multicanal se completa en V2.

El dashboard MVP muestra saldo por moneda, ingresos, gastos netos de reembolsos, balance del periodo, ahorro registrado, categorías, flujo de caja, gasto diario/semanal/mensual, próximos pagos y tarjetas. Deudas fuera de tarjetas y metas mostrarán un estado vacío explicativo hasta V2, sin cifras inventadas. Las rutas futuras no aparecen como funciones disponibles.

## Reglas de producto

El usuario puede corregir importaciones y consultar su procedencia; una notificación no equivale a un estado de cuenta conciliado. Una suscripción detectada es sugerencia hasta confirmar periodicidad. Cobros futuros y cuentas por cobrar nunca son efectivo disponible. Un pago de tarjeta reduce efectivo y pasivo: no vuelve a sumarse como gasto.

Saldo total significa activos líquidos registrados, por moneda; patrimonio neto resta pasivos y se mostrará aparte. Balance del periodo = ingresos menos gastos netos de reembolsos. Ahorro registrado = aportes netos a cuentas/metas marcadas para ahorro; capacidad potencial de ahorro requiere presupuesto, compromisos y fecha de ingreso, y no se confunde con saldo. Sin datos se presenta «Aún sin registros», no cero confirmado.

## Decisiones que requieren revisión del propietario

Confirmar alternativa tecnológica propuesta; BCP como primer parser; límites MVP/V2; presupuesto y proyecto cloud; dispositivos para pruebas; política de datos y expiración offline. No se ha inferido aprobación de estas decisiones. La revisión del PR precede al código del producto, conforme al PDF, página 10.
