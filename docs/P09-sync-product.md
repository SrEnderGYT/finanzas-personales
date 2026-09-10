# P09 — Sync backend y modo producto

Base remota inspeccionada: P08 `8dedbd8`, PR #9, apilado y sin merge. Su CI Web/backend/PostgreSQL e iOS pasa; la prueba Android de captura falla esperando el render del WebView. No se considera una prueba de persistencia nativa fallida ni se elimina; se diagnosticará en la validación móvil de P09.

## Alcance ejecutable

1. API autenticada POST `/v1/sync/commands` y GET `/v1/sync/changes`, recibos P08 y eventos atómicos privados.
2. Coordinador sobre outbox cifrado existente: subida, acuses reales, leases, reintentos acotados, parada por sesión/permisos y pull paginado durable.
3. Modo producto autenticado sin cifras DEMO, movimientos reales, acceso al formulario y última sincronización. Inicio sin analítica ficticia; DEMO separado explícitamente.
4. Pruebas de pérdida de respuesta, A/B, revocación, 422 terminal, reconexión, reapertura y páginas repetidas. Evidencias y PR separados; sin P10 ni merge.

## Contratos implementados

El POST acepta el comando P08 cerrado, sin usuario, con businessDate/timezone obligatorios. Devuelve 200 `{status: applied | already_applied, receipt}`. El recibo mantiene operationId, movementId, payloadHash y recordedAt. 409 representa conflicto; 422 entrada inválida; 401/403 paran acceso o subida según el caso. La identidad siempre procede del verificador P05.

Migración 019: `sync_heads` y `sync_changes` con RLS forzada y FK privadas. Un trigger agrega el evento al insertar el recibo manual, en la misma transacción que journal/movimiento. El contador por usuario se bloquea transaccionalmente, evitando saltarse un commit tardío como ocurriría con una secuencia global asignada antes de confirmar. Se incorporan los registros P08 preexistentes durante la migración.

El cursor codifica generación privada del usuario y secuencia decimal entera. La generación se valida contra la identidad autenticada; un cursor ajeno obtiene 403. Sin retención ni eliminación de cambios en P09. Cambios de generación requieren recuperación futura, no se borra almacenamiento local para resolverlos.

El cliente guarda cada página y su cursor en un único registro cifrado con CAS. Los movimientos confirmados son copias del servidor, no un libro contable ni saldos calculados en UI. Una página repetida conserva IDs y no duplica registros. No se implementa resolución de conflictos P10.

## Validación eficiente

`npm run test:postgres -- --suite=tests/sync.integration.test.ts` ejecuta únicamente sync contra una base desechable y las migraciones reales. El modo completo mantiene todas las suites. Los checks completos se reservan para bloques publicados o cierre; los cambios ajenos al cliente móvil no deben volver a ejecutar emuladores.

No hay contratación de infraestructura ni credenciales nuevas. El despliegue de producto requerirá API HTTPS y PostgreSQL configurados; el preview estático mantiene un modo de prueba explícito. Se documentará la configuración y cualquier falta de staging al entregar.

## Cliente y separación de espacios

`SyncEngine` usa `ManualOutbox` y `ProductVault` de P08. El guardado del formulario sigue creando `pending`; el coordinador adquiere el lease mediante CAS y envía el mismo comando. `confirmed` exige el recibo del servidor. Los reintentos conservan IDs, usan espera exponencial de 1–60 segundos y variación de hasta 250 ms. No se generan comandos nuevos al recuperar una respuesta perdida.

Un 422/409 de escritura deja un registro fallido visible y sin reintento automático. Un 403 detiene la subida; un 401 invalida el acceso en memoria. Los rechazos del cursor y las estructuras cifradas dañadas detienen la sincronización: no borran páginas, pendientes ni claves. El checkpoint valida versión, forma, referencias y metadatos antes de reemplazarlo.

`ProductWorkspace` conserva la bóveda al navegar entre registro y movimientos, pero la bloquea al pasar a segundo plano o cambiar sesión. El catálogo y su propietario se verifican con el acceso P05 antes de habilitar envíos; desbloquear offline no restaura un token. Tras reiniciar se puede consultar la copia cifrada, pero enviar requiere entrar y preparar el perfil de la sesión correspondiente.

La lista combina operaciones locales y cambios confirmados por ID, sin sumarlos dos veces. Muestra pendiente, sincronizando, confirmado, reintento y rechazo, además de fecha, zona y última sincronización. Cuentas presenta el catálogo real; no calcula balances desde pendientes. Los saldos del API P07 siguen derivados exclusivamente del ledger. Inicio no presenta cifras hasta P11. El botón para entrar en DEMO bloquea el espacio privado; volver a producto bloquea también la bóveda de prueba.

## Validación del recorrido

- `tests/sync.integration.test.ts`: PostgreSQL real, cinco confirmaciones concurrentes, respuesta perdida y recibo original, cursor privado/paginado, A/B, sesión revocada y saldo P07 obtenido del ledger.
- `tests/sync-engine.test.ts`: sobre cifrado real en IndexedDB de prueba, pérdida de respuesta, reapertura, checkpoint durable, páginas repetidas, 422 terminal, 401, cursor rechazado y corrupción sin recreación.
- `tests/sync.system.ts`: navegador contra el servidor Nest y PostgreSQL desechable; registro/login real con transporte de correo sintético, catálogo P07 real, gasto offline, respuesta HTTP descartada **después** del commit, reintento `already_applied`, una fila financiera, saldo exacto y reapertura sin token persistido. Las capturas usan únicamente fixtures sintéticas.
- El emulador Android mantiene PIN de dispositivo y SQLCipher. El fallo heredado de captura se diagnosticó como `keyguardLocked=true`, con la aplicación sin foco. El script de prueba desbloquea ahora el emulador desechable antes de iniciar la instrumentación; se mantienen las aserciones de foco, render, cifrado, corrupción y reapertura.

## Preparación de staging (sin aprovisionamiento)

1. Elegir un entorno HTTPS separado de producción y una base PostgreSQL. No existe un despliegue de producto contratado o configurado por este PR.
2. Aplicar las migraciones versionadas 001–019 con el rol de migración; mantener los roles restringidos de runtime y autenticación de P04/P05. El API verifica sus permisos al arrancar.
3. Inyectar `DATABASE_URL`, `AUTH_DATABASE_URL` y `AUTH_MAIL_KEY` desde Secret Manager o variables seguras. La entrega real de correo usa el worker P05. Google y MFA conservan su configuración opcional documentada en [P05](P05-autenticacion.md); ningún secreto se incluye en Web ni APK.
4. Servir Web y `/v1` bajo el mismo origen HTTPS mediante proxy. Cambiar `finanzas-auth` a `same-origin` en el **HTML fuente del build de staging**, antes de compilar, para que el manifest del service worker corresponda al HTML resultante. Mantener el build público con `disabled`. No cachear `/v1`, respuestas de autenticación ni cabeceras Authorization en el proxy o service worker.
5. Para un build nativo de staging, configurar el origen HTTPS fijo en `apps/mobile/src/native-auth.config.ts` y su retorno verificado. Habilitar `NATIVE_AUTH_CORS=enabled` en el API. El adaptador admite únicamente los métodos y rutas previstos de catálogo/sync; no obtiene el origen de enlaces o almacenamiento local.
6. Verificar correo, revocación, TLS, copia/restauración de PostgreSQL y el recorrido con cuentas de prueba antes de incorporar información personal. APK de desarrollo y simulador iOS no equivalen a TestFlight ni a una prueba física.

## Límites de esta entrega

Sin resolución de conflictos P10, analítica P11, CSV, tarjetas, presupuestos ni Gmail. El cache de confirmados no es una copia de respaldo ni una segunda fuente de saldos. Borrar los datos del dispositivo puede eliminar pendientes todavía no confirmados; no se promete recuperación de claves. El snapshot de cambios usa un único registro cifrado en P09; particionamiento y mediciones extensas de rendimiento quedan pendientes de una necesidad demostrada. Sin merge automático.

## Evidencia de cierre — 10 septiembre 2026

Código validado: `bb4455d`; cliente/nativo sin cambios respecto de `67c60c1`. Los artifacts de `pull_request` identifican el commit de integración temporal generado por GitHub, no un merge realizado en las ramas.

| Comprobación | Resultado y evidencia |
| --- | --- |
| Calidad, tipos, formato, Web/Mobile/backend | Aprobados en [CI 34474031839](https://github.com/SrEnderGYT/finanzas-personales/actions/runs/34474031839) |
| Unitarias / API / PostgreSQL | 78 / 2 / 68 aprobadas; incluye regresión financiera, idempotencia y RLS |
| Navegador real + PostgreSQL | 6 aprobadas: autenticación y recorrido sync con pérdida de respuesta |
| Preview / pruebas PWA existentes | 12 pruebas de navegador aprobadas; el preview no habilita autenticación real |
| Android | APK debug y tres recorridos instrumentados SQLCipher (crear, reabrir, corrupción) aprobados en [CI nativo 34473768937](https://github.com/SrEnderGYT/finanzas-personales/actions/runs/34473768937) |
| iOS | Build de simulador sin firma aprobado en el mismo CI; sin instalación física ni TestFlight |
| Dependencias / secretos | Auditoría: 0 vulnerabilidades; escaneo de cambios sin secretos |

Capturas de producto verificadas visualmente: [desktop](evidence/P09/product-desktop.png), [móvil claro](evidence/P09/product-mobile-light.png), [móvil oscuro](evidence/P09/product-mobile-dark.png). Evidencia SQLCipher: [creación](evidence/P09/android-created.png) y [reapertura](evidence/P09/android-reopened.png). La captura nativa corresponde al perfil de prueba local, no a una conexión nativa con staging.

Artifacts: [APK de desarrollo](https://github.com/SrEnderGYT/finanzas-personales/actions/runs/34473768937/artifacts/10150693788), [iOS simulador](https://github.com/SrEnderGYT/finanzas-personales/actions/runs/34473768937/artifacts/10150695786), [pruebas Android](https://github.com/SrEnderGYT/finanzas-personales/actions/runs/34473768937/artifacts/10150768108). Tienen la retención temporal configurada en GitHub Actions; el APK incluye metadatos de commit, entorno, fecha y versión.

P09 entrega código y pruebas de sincronización real con servidor desechable. **Staging público de producto permanece sin configurar**: requiere elección de proveedor y configuración externa. La URL GitHub Pages sigue siendo exclusivamente DEMO. No se ha hecho merge ni iniciado P10.
