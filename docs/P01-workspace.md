# P01 · Workspace y toolchain

Alcance: aplicaciones Angular web e Ionic móvil compilables, proyectos Capacitor Android/iOS, backend Nest/Fastify mínimo, paquetes domain/shared/ui y controles automáticos. Sólo fixtures sintéticas. El dominio financiero, autenticación y PostgreSQL real comienzan después de P03; no existen endpoints financieros accesibles.

| Herramienta                   | Versión fijada                         |
| ----------------------------- | -------------------------------------- |
| Node.js / npm                 | 24.14.1 / 11.6.1                       |
| TypeScript                    | 5.9.3 strict                           |
| Angular framework / CLI-build | 21.2.22 / 21.2.23                      |
| Ionic Angular                 | 9.0.2                                  |
| Capacitor                     | 8.4.3                                  |
| NestJS/Fastify adapter        | 12.0.1; Fastify exacto en package-lock |
| PostgreSQL                    | 17 objetivo de P04; no base creada     |
| ESLint / Prettier             | 10.10.0 / 3.9.6                        |
| Vitest / Playwright           | 4.1.11 / 1.63.0                        |

Angular 21 se mantiene en rango soportado compatible con Node24 y TypeScript5.9 según [matriz oficial](https://angular.dev/reference/versions). Ionic9 usa imports de `@ionic/angular` para standalone. Capacitor8.4.3 y Vitest4.1.11 resuelven vulnerabilidades detectadas en la primera selección: no se utilizó audit fix --force ni se ignoraron alertas.

## Reproducir

`npm ci`, `npm run lint`, `npm run format:check`, `npm run typecheck`, `npm test`, `npm run test:integration`, `npm run build`, `npm run security`.

`npm start` abre servidor web local y `npm run start:mobile` el móvil en 4201. Las pantallas de P01 son únicamente prueba de arranque; el preview visual revisable llegará con P02. `npm run cap:sync` compila y copia web móvil a los proyectos nativos. CI genera APK debug y un build iOS para simulador sin firma. Un build de simulador no equivale a TestFlight ni a prueba física.

Pruebas actuales: frontera DEMO rechaza registros no sintéticos; integración Nest/Fastify comprueba health y ausencia de API financiera. En P02 se añaden pruebas visuales y en P03 almacenamiento/cifrado. No se afirma RLS, autenticación o ledger implementado por tener CI.

Credenciales y datos reales no requeridos. No hay claves Apple, provisioning ni cuenta de distribución configurados: instalación nativa iPhone/TestFlight sigue pendiente. Java/SDK locales no se presuponen: las compilaciones nativas se validan en los runners correspondientes.

Riesgo: compatibilidad de plugins a validar en P03. Deuda técnica: proveedor identidad, migraciones y política operativa pendientes del core. Próximo paso: P02 en rama dependiente; no hacer merge automático de los PR de implementación.
