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

## Evidencia verificada el 10 de septiembre de 2026

- [Prueba multicliente PostgreSQL](https://github.com/SrEnderGYT/finanzas-personales/actions/runs/34540892210):
  dos contextos de navegador, respuesta 409 real, comparación y resolución explícita,
  respuesta perdida tras commit y reintento sin duplicar la corrección.
- [Contrato PostgreSQL](https://github.com/SrEnderGYT/finanzas-personales/actions/runs/34540890481):
  20 migraciones y 31 tablas con RLS comprobadas. Son suites dirigidas, no CI final completo.
- Capturas sintéticas del commit `a051229`, inspeccionadas visualmente:
  [desktop](evidence/P10/conflict-desktop.png),
  [móvil claro](evidence/P10/conflict-mobile-light.png),
  [móvil oscuro](evidence/P10/conflict-mobile-dark.png).
- [Procedimiento de staging](P10-staging-runbook.md): preparación local; configuración
  privada y despliegue real pendientes. No confundirlo con la URL DEMO existente.
- [Android](https://github.com/SrEnderGYT/finanzas-personales/actions/runs/34560769844):
  build y persistencia cifrada con reapertura en emulador aprobados para `dd2a4a1`.
  No acredita dispositivo físico ni los cambios posteriores de alta de catálogo.

## Correcciones y revisión entre clientes

La migración 020 añade recibos de corrección, una cadena de revisiones inmutable
y auditoría mínima. Los recibos conservan el comando y el resultado necesarios
para recuperar conflictos y respuestas perdidas; las tablas tienen RLS forzada
y FK compuestas por propietario. El runtime solo inserta y consulta, sin permisos
para sobrescribir o borrar historia.

`POST /v1/sync/corrections` compara `expectedVersion` bajo los bloqueos existentes
catálogo → ledger. Una versión obsoleta devuelve 409 con la propuesta local,
la versión del servidor y los campos diferentes, y conserva ese resultado para
reintentos. `keep_server` requiere una referencia a un conflicto; `replace` exige
motivo, IDs distintos, fecha/zona explícitas para el reverso y un comando manual
de sustitución. Una decisión aplicada por conflicto es única.

La única extracción de P08 es `confirmInTransaction`, que verifica el contexto
de la conexión y permite confirmar reverso P06, sustitución P08, linaje, recibos y
auditoría en una transacción. No se modifica la regla financiera de P06. El feed
P09 conserva los movimientos históricos y añade metadatos inmutables de revisión
a las sustituciones; la lista presenta la última revisión sin sumar gastos de nuevo.

Las propuestas de corrección tienen una cola cifrada propia que reutiliza la bóveda
y CAS, con estados pending/sending/retryable/requires_review/applied. No se resuelve
un conflicto automáticamente. Un envío interrumpido conserva su lease y los mismos
IDs; una respuesta validada se guarda cifrada. La UI permite corregir importe,
fecha y nota, con motivo obligatorio, y decidir entre conservar servidor o registrar
la propuesta mediante reverso y sustitución. Las cuentas y categorías no se editan
en este formulario.

Validación local de este bloque: 90 unitarias pasan, lint y formato pasan. Se añadieron
pruebas PostgreSQL de concurrencia, aislamiento, rollback e inmutabilidad y un
recorrido con dos contextos de navegador independientes. Su ejecución completa,
capturas y staging siguen pendientes; no se declara P10 terminado.
