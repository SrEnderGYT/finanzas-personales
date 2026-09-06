# Entrega inicial y trazabilidad

> Baseline de fase 0. Las aprobaciones y el orden de ejecución actuales están en [decisiones vigentes](09-aprobacion-ejecucion.md); prevalecen sobre estados pendientes históricos de este documento.
Estado: **22 entregables documentados para revisión; implementación pendiente**. Fuente exclusiva de requisitos para esta fase: [PDF original](referencia/Plan_Maestro_Codex_App_Finanzas.pdf). No se reutilizó código ni datos de repositorios anteriores.

## Los 22 entregables

El PDF numera esta lista del 11 al 32 en su sección 21; aquí se asignan IDs E01–E22 sin omitir elementos.

| ID | Número PDF | Entregable | Documento |
| --- | --- | --- | --- |
| E01 | 11 | Resumen ejecutivo | [Producto](01-producto.md) |
| E02 | 12 | Objetivos generales/específicos | [Producto](01-producto.md) |
| E03 | 13 | Alcance y fuera de alcance | [Producto](01-producto.md) |
| E04 | 14 | Arquitectura propuesta | [ADR](../ARCHITECTURE.md) |
| E05 | 15 | Matriz y recomendación | [ADR](../ARCHITECTURE.md) |
| E06 | 16 | Modelo de datos | [Datos](02-datos.md) |
| E07 | 17 | Arquitectura de seguridad | [Seguridad](../SECURITY.md) |
| E08 | 18 | Arquitectura Gmail | [Gmail](03-gmail.md) |
| E09 | 19 | Arquitectura Web | [Clientes](04-clientes-sync.md) |
| E10 | 20 | Arquitectura Mobile | [Clientes](04-clientes-sync.md) |
| E11 | 21 | Design System | [Diseño](05-diseno.md) |
| E12 | 22 | Wireframes textuales | [Diseño](05-diseno.md) |
| E13 | 23 | Roadmap | [Roadmap](../ROADMAP.md) |
| E14 | 24 | Backlog priorizado | [Backlog](06-backlog.md) |
| E15 | 25 | Historias de usuario | [Backlog](06-backlog.md) |
| E16 | 26 | Criterios de aceptación | [Backlog](06-backlog.md) |
| E17 | 27 | Riesgos y mitigaciones | [Calidad](07-calidad-entrega.md) |
| E18 | 28 | Estrategia de testing | [Calidad](07-calidad-entrega.md) |
| E19 | 29 | CI/CD | [Calidad](07-calidad-entrega.md) |
| E20 | 30 | MVP/V2/V3 exactos | [Producto](01-producto.md) |
| E21 | 31 | Estructura repositorio | [README](../README.md) |
| E22 | 32 | Plan por PRs pequeños | [Roadmap](../ROADMAP.md) |

## Requisitos por página

| PDF | Cobertura de la propuesta |
| --- | --- |
| p1–2: nuevo, independiente, objetivos | README, Producto, historial nuevo y sin dependencias antiguas |
| p2–3: módulos y principios | Producto versiones; Arquitectura módulos; Backlog H01–H24 |
| p3: tres alternativas y capas | ADR-001 y matriz de diez criterios |
| p4: 17 modelos y Gmail | Datos con tipos/FK/índices/reglas; Gmail pipeline |
| p5: seguridad y paleta | SECURITY; Diseño tokens claros exactos y oscuros propuestos |
| p6: navegación y dashboard | Clientes; Diseño wireframes; Producto dashboard por versión |
| p7: IA y offline | Gmail sección IA; Clientes protocolo/conflictos; Datos idempotencia |
| p7–8: fases y MVP | ROADMAP y Producto; fases no equivalen a releases |
| p8: pruebas y GitHub | Calidad; CONTRIBUTING; CI actual sólo documental |
| p9: estructura y entregables | README y tabla E01–E22 |
| p10: revisión antes de implementación | PR de fase0; todos los ADR siguen propuestos |

## Revisión solicitada sobre decisiones concretas

| Decisión | Propuesta | Estado |
| --- | --- | --- |
| D01 Plataforma | Angular + Ionic/Capacitor; reconsiderar tras P03 si falla UX/cifrado | Pendiente de revisión |
| D02 Backend | TypeScript modular + PostgreSQL; servicios Google propuestos | Pendiente de presupuesto/entorno |
| D03 MVP | Corte exacto de Producto; BCP como primer conector | Pendiente de revisión |
| D04 Offline/retención | Bloqueo5min, renovar online7d, tombstones90d, backups30d | Pendiente de revisión |
| D05 Publicación | Beta privada con pruebas Android/iOS reales | Cuentas y dispositivos pendientes |

No se pide autorización para preparar documentación ni crear el repositorio privado: ya fueron solicitados. La revisión pendiente proviene del PDF, página 10: «Después de mi revisión, implementa por fases y PRs pequeños». Es un requisito del documento adoptado como especificación, no una exigencia de las habilidades utilizadas. La revisión D01–D05 ya fue realizada explícitamente por el propietario; véase la decisión posterior enlazada arriba.

## Estado de ejecución

El README distingue documentación lista de funcionalidades futuras. La CI de documentos no cumple todavía el criterio final del PDF de pruebas financieras, aislamiento real y sincronización confiable: eso exige código y evidencia de beta. No hay Gmail conectado, hosting, aplicación instalable ni datos bancarios reales en este repositorio.
