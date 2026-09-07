# Finanzas personales · preview DEMO

Web Angular, UI móvil Ionic/Capacitor y PWA con datos exclusivamente sintéticos. Repositorio público; la futura aplicación real tendrá beta privada. No se conectó Gmail ni se importaron proyectos o datos financieros anteriores.

- [Preview Web](https://srendergyt.github.io/finanzas-personales/)
- [Preview Mobile](https://srendergyt.github.io/finanzas-personales/mobile/)
- [P01 — workspace](docs/P01-workspace.md) · [PR #2](https://github.com/SrEnderGYT/finanzas-personales/pull/2)
- [P02 — diseño, capturas y PWA](docs/P02-preview.md) · [PR #3](https://github.com/SrEnderGYT/finanzas-personales/pull/3)
- [P03 — prototipo cifrado](docs/P03-almacenamiento.md)
- [P04 — backend, PostgreSQL y aislamiento](docs/P04-backend.md)
- [P05 — autenticación y sesiones, en desarrollo](docs/P05-autenticacion.md)

La URL muestra el último preview publicado; `build-info.json` identifica el commit. Consultar las ejecuciones Actions antes de asociar un binario o despliegue a una revisión. Los PR de implementación siguen abiertos, apilados; sólo fase0 fue fusionada con aprobación del propietario.

## Qué puedes probar

Dashboard DEMO, monedas PEN/USD separadas, rangos de fechas, búsqueda, formulario efímero de muestra, tarjetas/cuentas ilustrativas, presupuestos y temas claro/oscuro/sistema. En Configuración, P03 añade bóveda local cifrada con comandos sintéticos pendientes. No representa sincronización bancaria ni aplicación lista para datos reales.

## Reproducir

Node24.14.1 y npm11.6.1. `npm ci`; `npm run build`; `npm start` (web); `npm run start:mobile` (móvil). `npm run cap:sync` genera activos y registra plugins en Android/iOS. `npm run lint`, `npm run format:check`, `npm run typecheck`, `npm test`, `npm run test:integration`, `npm run test:e2e`, `npm run security`.

GitHub Actions produce APK debug con metadata de commit/versión/fecha/entorno y compilación de simulador iOS sin firma. No hay certificados, provisioning ni TestFlight configurados. Pruebas físicas de biometría/almacenamiento nativo pendientes; pruebas web no las sustituyen.

## Estructura

```text
apps/web          Angular web/PWA
apps/mobile       Ionic/Capacitor + Android/iOS
packages/domain   Lugar del dominio P06; aún no core financiero
packages/shared   Contratos DEMO y prototipo cifrado
packages/ui       Componentes, temas y experiencia DEMO
backend/api       Nest/Fastify, User, migraciones PostgreSQL y RLS
infra             Configuración de infraestructura; secretos externos
docs              Arquitectura, decisiones, entregas y evidencia
```

## Revisión y seguridad

Main protegida por PR/checks, incluidos administradores. [Auditoría de publicación y decisiones aprobadas](docs/09-aprobacion-ejecucion.md). Secretos externos al repositorio; fixtures sintéticas. El repositorio público no publica infraestructura ni datos reales.

**Continuación después de P03 autorizada por el propietario.** P04 añade preferencias persistentes protegidas; `npm run test:postgres` verifica aislamiento en PostgreSQL real con Docker. El dashboard permanece DEMO. Después del core manual habrá otra revisión antes de Gmail. No hay merge automático de PR grandes.

[Arquitectura](ARCHITECTURE.md) · [Roadmap](ROADMAP.md) · [Seguridad](SECURITY.md) · [22 entregables de fase0](docs/08-trazabilidad.md) · [Plan Maestro histórico](docs/referencia/Plan_Maestro_Codex_App_Finanzas.pdf)
