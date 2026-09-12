# Finanzas personales

Aplicación de finanzas personales Web, PWA, Android e iOS en desarrollo activo. El producto incluye base financiera, cuentas, categorías, movimientos, trabajo offline, sincronización, resolución de conflictos, dashboard, autenticación y automatización financiera con Gmail.

- [Aplicación Web](https://srendergyt.github.io/finanzas-personales/)
- [Experiencia móvil](https://srendergyt.github.io/finanzas-personales/mobile/)
- [P10 — sincronización, conflictos y staging](docs/P10-staging-runbook.md)
- [P11 — dashboard funcional](https://github.com/SrEnderGYT/finanzas-personales/pull/12)
- [P15 — conexión Gmail](https://github.com/SrEnderGYT/finanzas-personales/pull/13)
- [P16 — aplicación pública y revisión financiera](https://github.com/SrEnderGYT/finanzas-personales/pull/14)
- [P17 — login obligatorio, Gmail y finanzas detectadas](https://github.com/SrEnderGYT/finanzas-personales/pull/15)

## Aplicación Web

La publicación Web es **login-first**: la entrada pública es Acceso y las rutas financieras permanecen protegidas hasta que exista una sesión válida. No se publican saldos, tarjetas, movimientos, suscripciones ni deudas ficticias como sustituto de información personal.

Cuando el API privado todavía no está conectado, el login permanece visible pero bloquea el ingreso de credenciales y muestra el estado del servicio. Al habilitar el API HTTPS, el mismo cliente utiliza autenticación real, PostgreSQL, RLS, almacenamiento cifrado y los contratos privados del producto.

## Finanzas y automatización

- **Inicio y movimientos:** resumen por moneda y actividad confirmada/pendiente del usuario autenticado.
- **Cuentas y categorías:** catálogo privado asociado al usuario.
- **Gmail:** autorización separada con `gmail.readonly`, sincronización por rango y bandeja de hallazgos financieros.
- **Tarjetas:** actividad e instituciones detectadas desde correos autorizados; sin correo conectado no se inventan valores.
- **Suscripciones:** cargos recurrentes detectados para revisión.
- **Deudas:** avisos de deuda, cuotas, vencimientos o pagos detectados para revisión.
- **Registro:** confirmación manual mediante el ledger y outbox idempotente; una detección no altera saldos automáticamente.

La conexión Gmail utiliza un consentimiento independiente del login. El refresh token se mantiene en servidor cifrado y no se almacena en el navegador. Las detecciones se revisan antes de convertirse en movimientos financieros.

## Base técnica implementada

```text
apps/web          Angular Web + PWA
apps/mobile       Ionic / Capacitor + Android / iOS
packages/domain   Money exacto, fechas y ledger financiero
packages/shared   Contratos compartidos y utilidades
packages/ui       Producto, autenticación, Gmail y experiencia responsive
backend/api       NestJS / Fastify, PostgreSQL, autenticación, sync y RLS
infra             Configuración de infraestructura y staging
scripts           Calidad, migraciones, pruebas y automatización
docs              Arquitectura, contratos, decisiones y evidencia
```

El core financiero usa importes exactos, separación PEN/USD, asientos consistentes e idempotencia. Las cuentas y categorías están aisladas por usuario. El flujo offline conserva pendientes cifrados y la sincronización evita duplicar operaciones cuando una respuesta se pierde después del commit. P10 añade conflictos versionados y recuperación explícita del checkpoint.

## Calidad y seguridad

El repositorio ejecuta lint, Prettier, TypeScript, pruebas unitarias, integración API, PostgreSQL, navegador, builds Web/backend/Android/iOS, auditoría de dependencias y secret scanning. GitHub Pages no contiene contraseñas, refresh tokens, correos personales ni información financiera real en el repositorio.

Para activar login y Gmail con datos reales se requiere desplegar el API privado HTTPS y configurar sus variables externas de forma segura; esas credenciales nunca deben almacenarse en GitHub.

## Desarrollo local

Node 24.14.1 y npm 11.6.1.

```bash
npm ci
npm run build
npm start
npm run start:mobile
npm run lint
npm run format:check
npm run typecheck
npm test
npm run test:integration
npm run test:e2e
npm run security
```

## Estado del roadmap

La infraestructura y el core avanzan desde P01 hasta P10. P11 consolidó la capa funcional; P15/P16 prepararon Gmail y la revisión financiera; P17 sustituye la experiencia pública sintética por una aplicación login-first conectable al API privado y a Gmail real.

[Arquitectura](ARCHITECTURE.md) · [Roadmap](ROADMAP.md) · [Seguridad](SECURITY.md) · [Trazabilidad](docs/08-trazabilidad.md)
