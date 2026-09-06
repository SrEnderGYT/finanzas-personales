# Finanzas personales · propuesta de fase 0

Una plataforma personal para entender gastos, ingresos, cuentas y compromisos, registrar operaciones sin conexión e incorporar avisos bancarios autorizados. Web de escritorio, PWA y aplicaciones Android/iOS compartirán las reglas financieras y el backend.

**Estado: propuesta preparada para revisión; aplicación no implementada ni publicada.** Este repositorio es nuevo, privado e independiente. No contiene código, Excel, fotos bancarias ni datos reales importados de proyectos anteriores. No se ha conectado Gmail ni autorizado ningún cobro o mensaje a terceros.

## Decisión propuesta

Angular para la web e Ionic/Capacitor para móvil, dominio TypeScript compartido y backend modular con PostgreSQL. La elección prioriza mantenimiento y rapidez para una beta pequeña; depende de validar almacenamiento cifrado y UX en dispositivos reales. Alternativas y límites en [ARCHITECTURE.md](ARCHITECTURE.md).

## Leer en este orden

1. [Producto, descubrimiento y versiones](docs/01-producto.md): objetivos, supuestos y MVP exacto.
2. [Arquitectura y matriz tecnológica](ARCHITECTURE.md).
3. [Modelo de datos](docs/02-datos.md), [seguridad](SECURITY.md) y [Gmail](docs/03-gmail.md).
4. [Web, móvil y sincronización](docs/04-clientes-sync.md), [sistema de diseño y wireframes](docs/05-diseno.md).
5. [Roadmap](ROADMAP.md), [backlog e historias](docs/06-backlog.md), [pruebas, riesgos y entrega](docs/07-calidad-entrega.md).
6. [Índice de los 22 entregables y decisiones a revisar](docs/08-trazabilidad.md).

## Qué hay y qué falta

| Preparado | Pendiente de implementación y evidencia |
| --- | --- |
| Documentación de fase 0 y estructura del proyecto | Login, pantallas, API y bases de datos |
| Modelo lógico y reglas financieras | Migraciones y pruebas financieras automáticas |
| Contrato de sincronización e idempotencia | Offline real y pruebas Android/iOS |
| Diseño OAuth y parser BCP inicial | Configuración Google, consentimiento y parser validado |
| CI de integridad documental | Compilación, tests del producto, staging y producción |

El PDF establece: «Después de mi revisión, implementa por fases y PRs pequeños». La siguiente acción es revisar esta propuesta y registrar decisiones en el PR; después se abrirá el primer PR de implementación. Una propuesta no equivale a arquitectura aprobada ni a controles de seguridad activos.

## Estructura

```text
apps/web/           # Futuro cliente Angular y PWA
apps/mobile/        # Futuro cliente Ionic/Capacitor Android/iOS
packages/shared/   # Futuras reglas, contratos y sincronización compartidos
backend/           # Futuro monolito modular API + trabajadores
infra/             # Futuro aprovisionamiento separado por entorno
docs/              # Entregables de fase 0 y referencia original
scripts/           # Validación documental; no código del producto
.github/workflows/ # CI documental actual
```

## Validación actual

Con Python 3.11 o posterior, ejecutar desde la raíz: `python scripts/check_docs.py`. Comprueba entregables, carpetas, enlaces Markdown locales y presencia de las entidades mínimas del modelo. No comprueba aún funcionalidades financieras.

Fuente de requisitos: [Plan Maestro original](docs/referencia/Plan_Maestro_Codex_App_Finanzas.pdf). Las decisiones de este repositorio se identifican como propuestas, supuestos o pendientes; no se presentan como instrucciones adicionales del usuario.
