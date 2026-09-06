# Roadmap y plan de PRs pequeños

Fase 0 aprobada por el propietario. Ejecutar P01–P03 y detenerse para revisión antes del core; después P04–P14 y otra revisión antes de Gmail. [Decisiones vigentes](docs/09-aprobacion-ejecucion.md). No hay fechas prometidas; infraestructura y dispositivos siguen por validar.

## Fases del Plan Maestro

| Fase | Resultado y dependencia | Criterio para avanzar |
| --- | --- | --- |
| 0 | Discovery, ADR, modelo, seguridad y alcance | Revisión del propietario registrada; resolver decisiones que bloqueen código |
| 1 | Design System, navegación y shell web/móvil | Build web/Android/iOS y prototipo de cifrado/UX aceptables |
| 2 | Auth, cuentas, categorías y transacciones | Aislamiento, dinero exacto y asientos balanceados comprobados |
| 3 | Dashboard, filtros, búsqueda y CSV | Totales conciliados y exportaciones privadas probadas |
| 4 | Tarjetas y presupuestos MVP; metas/deudas/suscripciones V2 | Sin doble gasto por pago; cálculo de presupuestos correcto |
| 5 | Offline, sync, auditoría y recuperación | Reinicio offline, reintentos y conflicto entre dispositivos pasan |
| 6 | Gmail y parser BCP MVP; demás adaptadores V2 | Consentimiento/revocación, fixtures autorizadas, dedupe y replay pasan |
| 7 | Notificaciones y automatizaciones V2 | Permisos, privacidad, vencimientos y reintentos comprobados |
| 8 | Analítica/proyecciones V2 | Periodo, cobertura y supuestos visibles; cálculos reproducibles |
| 9 | Asistente IA V3 | Sólo agregados propios; aislamiento y explicaciones verificadas |
| 10 | Hardening y beta privada | Matriz de release completa, restauración y pruebas reales móviles |
| 11 | Publicación estable y observabilidad | Operación ensayada, alertas, rollback y aprobación de publicación |

Interpretación de dependencias: CI, seguridad, auditoría y el contrato offline se introducen desde los primeros PRs, aunque la fase 5 los consolide y la 10 haga hardening. No construir un core dependiente exclusivamente de conexión para luego reescribirlo. El MVP es un corte de los componentes marcados MVP más una pasada de fase 10; no espera IA/V3. Cada versión vuelve a pasar hardening antes de publicar.

## Secuencia propuesta de PRs

Cada PR debe entregar cambio acotado, pruebas de comportamiento relevantes, documentación, criterios de aceptación, riesgos y pasos de validación. PRs separados de despliegue, migración destructiva o publicación cuando corresponda.

| PR | Cambio | Depende | Validación y riesgo principal |
| --- | --- | --- | --- |
| P00 | Esta propuesta de fase 0 | — | Integridad documental; decisiones aún propuestas |
| P01 | Toolchain fijada, workspace, lint/build/CI sin secretos | P00 aprobado | Builds mínimos; compatibilidad de versiones |
| P02 | Tokens, componentes base y shell desktop/móvil | P01 | Teclado, contraste, responsive; navegación distinta |
| P03 | Prueba cifrado/biometría/SQLite/iOS, ADR actualizado | P02 | Dispositivo real y reinicio; plugin/licencia |
| P04 | Backend, migración User y autorización/RLS | P01 | A/B aislados, tenant de pool no persiste; permisos |
| P05 | Login, verificación, MFA y sesiones | P03,P04 | Logout/revocación/reautenticación; linking |
| P06 | Money, fechas, asientos y reglas puras | P01 | Casos financieros y propiedades; redondeo |
| P07 | Cuentas/categorías y saldos iniciales | P05,P06 | Balance inicial no ingreso; FK por propietario |
| P08 | Comandos de transacción y outbox local | P03,P07 | Crear sin red/reabrir; durabilidad |
| P09 | Sync backend idempotente y pull/cursor | P04,P08 | Commit sin respuesta/retry; duplicados |
| P10 | Conflictos, tombstones y recuperación cliente | P09 | Dos dispositivos y resync; pérdida de pendientes |
| P11 | Dashboard, filtros y búsqueda | P10 | Totales/periodos/monedas; cobertura parcial |
| P12 | CSV y privacidad de exportación | P11 | Filtros, caracteres peligrosos, acceso ajeno |
| P13 | Tarjetas, cortes/vencimientos/pagos | P07,P10 | Pago no duplica gasto; fechas desconocidas |
| P14 | Presupuesto mensual | P11,P13 | Reembolso, cambio categoría, exceso |
| P15 | OAuth Gmail y ciclo de conexión/revocación | P05,P09 | State/replay/token revocado; alcance restringido |
| P16 | Parser BCP y bandeja de revisión | P15 | Fixtures anonimizadas, formatos desconocidos |
| P17 | Watch/PubSub/dedupe/reconciliación | P16 | Eventos repetidos, cursor404, renovación |
| P18 | Auditoría, borrado/exportación cuenta y hardening MVP | P12–P17 | Aislamiento total, retención y recuperación |
| P19 | Beta MVP staging, matriz móvil y publicación privada | P18 | Builds firmados, E2E, restore; cuentas externas |
| P20 | Deudas por pagar/cobrar y pagos | Beta aceptada | Capital/interés/penalidad separados; términos inciertos |
| P21 | Metas y aportes | P20 | Aportes/retiros no duplican ingreso |
| P22 | Suscripciones y reglas confirmables | P17 | Detección no confunde compras habituales |
| P23 | Push, programación, quiet hours | P22 | Permisos, cancelación, privacidad |
| P24 | Más bancos: un PR por adaptador | P17 | Fixtures propias y criterios idénticos por banco |
| P25 | Excel/PDF, comparativas y proyecciones | P20–P24 | Exportación y cálculos reproducibles; incertidumbre |
| P26 | Hardening y release V2 | P25 | Regresión/beta/operación |
| P27 | Asistente de agregados y evaluación adversarial | V2 confiable | Periodo, evidencia, aislamiento, no SQL libre |
| P28 | Hardening V3 y observabilidad estable | P27 | Seguridad, rollback, release aprobado |

Si un PR supera una responsabilidad revisable, dividirlo antes de codificar; por ejemplo P05 puede separar MFA o P18 separar borrado. El número identifica el paquete de trabajo, no obliga a un diff grande. Fallos de compilación/tests o vulnerabilidades críticas impiden comenzar una fase dependiente.
