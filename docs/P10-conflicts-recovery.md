# P10 — staging privado, conflictos y recuperación

Estado: implementación en curso. Rama `feature/p10-conflicts-recovery`, apilada sobre
P09 `b13c210` / PR #10. No implica cierre de P10 ni autorización de merge.

## Límites e invariantes

- P05 verifica la identidad; RLS y las relaciones privadas siguen siendo obligatorias.
- P06 sigue siendo la única autoridad contable. Una corrección confirmada exige
  reverso y sustitución atómicos; nunca se modifica un asiento histórico.
- Los comandos pendientes de P08 y los recibos P09 conservan sus identificadores.
- Un conflicto entre dispositivos requiere comparar versiones y una decisión
  explícita, auditable e idempotente. No se aplica última escritura gana.
- Solo datos sintéticos durante la validación. Gmail queda fuera de P10.
- Al cerrar P10 se detiene el trabajo para revisión. Orden posterior aprobado:
  P15, P16, P17, P11, P12, P13, P14; ninguna fase comienza automáticamente.

## Recuperación explícita del checkpoint

`SyncEngine.recoverCheckpoint()` descarga el historial desde el principio sin
llamar a `send` ni cambiar ninguna fila del outbox. Valida cada página, avance de
secuencia, generación, recibos e inmutabilidad. La descarga debe completarse antes
de sustituir el checkpoint mediante compare-and-swap.

Antes de sustituirlo conserva el ciphertext exacto anterior como evidencia en un
registro también cifrado, ligado al mismo perfil. Una escritura concurrente impide
sobrescribir el checkpoint más reciente. Si la descarga omite historial previamente
observado o cambia datos inmutables, se rechaza la recuperación.

La corrupción que impida descifrar o validar el checkpoint falla de forma segura:
no se interpreta como una instalación nueva y no se recrea la bóveda. La recuperación
de claves perdidas o ciphertext corrupto no se promete sin una copia recuperable.

La interfaz ofrece «Recuperar descarga» cuando la sincronización queda detenida por
datos inválidos. Informa que no enviará pendientes. Requiere sesión vigente del
mismo perfil y conexión. No activa un envío al finalizar.

Pruebas iniciales: reapertura con un pendiente intacto; evidencia cifrada;
historial omitido/modificado; interrupción de descarga; sesión revocada;
checkpoint concurrente; corrupción sin recreación. La suite utiliza IndexedDB
emulada; todavía no acredita pruebas multicliente PostgreSQL ni dispositivos.

## Entorno temporal

El 10 de septiembre de 2026 se creó en Render la base `finanzas-p10-staging`,
PostgreSQL 17, región Oregon, plan Free de US$0. El panel indica caducidad el
10 de octubre de 2026. No se activaron ampliaciones, alta disponibilidad ni planes
pagos. Se bloquearon todas las conexiones PostgreSQL desde Internet; la futura API
debe conectarse por la red privada del proveedor.

La base disponible no equivale a staging funcional. Siguen pendientes el servicio
Web/API HTTPS, migraciones con roles restringidos, configuración privada de acceso
y validación del flujo completo. No se incluyen credenciales ni URLs de conexión
en este documento.

## Puerta de cierre pendiente

- Correcciones y conflictos entre dos clientes, respuesta 409 real y resolución.
- Historial y auditoría inmutables, RLS A/B y reintentos sin duplicados.
- Staging autenticado utilizable, separado del preview DEMO de GitHub Pages.
- CI completo, evidencia desktop/mobile y pruebas nativas relevantes.
- PR P10 separado, sin merge automático.
