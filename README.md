# Finanzas personales

Aplicación de finanzas personales Web, PWA, Android e iOS en desarrollo activo. El producto ya incluye base financiera, cuentas, categorías, movimientos, trabajo offline, sincronización, resolución de conflictos, dashboard, autenticación y una primera capa de automatización con Gmail.

- [Aplicación Web](https://srendergyt.github.io/finanzas-personales/)
- [Experiencia móvil](https://srendergyt.github.io/finanzas-personales/mobile/)
- [P10 — sincronización, conflictos y staging](docs/P10-staging-runbook.md)
- [P11 — dashboard funcional](https://github.com/SrEnderGYT/finanzas-personales/pull/12)
- [P15 — conexión Gmail](https://github.com/SrEnderGYT/finanzas-personales/pull/13)
- [P16 — aplicación pública y revisión financiera](https://github.com/SrEnderGYT/finanzas-personales/pull/14)

La publicación de GitHub Pages permite recorrer la aplicación completa con datos de ejemplo y sin credenciales reales. El entorno privado conserva la autenticación, PostgreSQL, RLS, almacenamiento cifrado y contratos reales del producto. Ningún dato financiero personal, token de Gmail o secreto se publica en GitHub Pages.

## Qué puedes recorrer ahora

- **Mis finanzas:** patrimonio visible, ingresos, gastos, balance, presupuesto, próximos pagos y cuentas.
- **Movimientos:** búsqueda, moneda, rango de fechas y registro temporal para revisar el flujo de captura.
- **Cuentas:** cuentas PEN/USD, efectivo y categorías financieras.
- **Tarjetas:** línea, consumo, disponible, fechas y actividad de tarjeta.
- **Presupuestos:** límites por categoría y avance del mes.
- **Análisis:** balance, distribución de gastos y categorías principales.
- **Gmail:** experiencia de conexión separada del login y bandeja de revisión financiera.
- **Configuración:** temas, privacidad, almacenamiento local cifrado e integraciones.
- **Acceso:** pantalla de login pública segura; el formulario real sólo se habilita cuando el backend privado está configurado.

Los importes visibles en la publicación pública son de ejemplo. Sirven para validar navegación, diseño y comportamiento; no representan información bancaria real.

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

El repositorio ejecuta lint, Prettier, TypeScript, pruebas unitarias, integración API, PostgreSQL, navegador, builds Web/backend/Android/iOS, auditoría de dependencias y secret scanning. La publicación pública no inicia OAuth real ni contiene contraseñas, refresh tokens o datos personales.

La aplicación privada todavía requiere completar el staging Web/API y sus credenciales externas antes de aceptar información financiera real. Android se compila en CI; iOS se valida en simulador sin firma mientras no exista provisioning/TestFlight.

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

La infraestructura y el core avanzan desde P01 hasta P10. La capa funcional continúa con P11 y la automatización financiera con P15/P16. El siguiente objetivo es cerrar la publicación actual, completar staging privado y continuar con exportación, tarjetas, presupuestos e importación Gmail/BCP sin degradar las garantías ya construidas.

[Arquitectura](ARCHITECTURE.md) · [Roadmap](ROADMAP.md) · [Seguridad](SECURITY.md) · [Trazabilidad](docs/08-trazabilidad.md)
