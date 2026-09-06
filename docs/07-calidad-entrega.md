# Pruebas, riesgos, CI/CD y operación

Estado: estrategia propuesta. Actualmente sólo se ejecuta validación documental; no hay tests del producto ni despliegues.

## Matriz de pruebas

| Nivel | Casos obligatorios | Evidencia para aprobar |
| --- | --- | --- |
| Unitarias dominio | Dinero exacto, escalas, reembolsos, transferencias/pagos, intereses según términos, límites de meses | Casos y propiedades; conservación por moneda; redondeo explícito |
| Unitarias parsers | BCP fixture soportada/desconocida; decimal coma/punto; montos múltiples; formato cambiado; texto malicioso | Corpus sintético y anonimizaciones autorizadas versionadas |
| Integración DB/API | Auth, FK/RLS, asientos atómicos, filtros, exportaciones, auditoría | PostgreSQL real de test; no sólo mocks |
| Aislamiento | A intenta IDs de B en lectura/escritura/search/sync/export/IA | 401/403/404 consistente, sin revelar existencia ni datos |
| Idempotencia | Doble click, 5 reintentos, mensaje repetido, commit sin ack, mismo ID/payload distinto | Una operación confirmada; payload distinto rechazado |
| Fechas/monedas | America/Lima, zona con DST, fin de mes, año bisiesto, corte31 en febrero, PEN/USD sin FX | Rango exacto, moneda separada, vencimiento ajustado según regla visible |
| Offline/recuperación | Modo avión, matar app, restablecer, dos dispositivos, tombstone vencido, migración fallida, sesión revocada | Pendientes conservados; conflictos visibles; resync conciliado |
| Gmail | Consentimiento/revocación, token inválido, 429/5xx, cursor404, watch expirado, duplicados y orden | Replay controlado y métricas sin cuerpos; no polling infinito |
| E2E web | Login→cuenta→compra→pago→dashboard→CSV; Gmail revisión | Playwright propuesto en navegadores soportados |
| E2E mobile | Instalación, teclado, biometría/PIN, bloqueo, offline, push opt-in | Maestro/Appium a seleccionar tras prototipo; Android e iOS físicos |
| Accesibilidad | Teclado, foco, lectores, contraste, zoom, reduced motion | Automático + recorrido manual documentado |
| Rendimiento | Lista10.000, filtros/dashboard, carga móvil | Datos sintéticos, dispositivo/red fijados, antes/después; no benchmark inventado |

Objetivos iniciales a calibrar: escritura local percibida <=200 ms; dashboard ya descargado <=1 s; API p95 <=500 ms con 100 sesiones sintéticas; ningún scroll bloqueado perceptiblemente en dispositivo medio. Registrar entorno y percentiles; superar una meta requiere análisis, no alterar la medida. Cero pérdida/duplicación en pruebas monetarias y cero fugas de tenant son gates absolutos.

## Riesgos y mitigaciones

| Riesgo | Probabilidad/impacto propuestos | Mitigación / señal / responsable |
| --- | --- | --- |
| OAuth restringido retrasa beta | Alta/alto | Revisar requisitos antes P15; prototipos con usuarios autorizados; propietario resuelve proyecto/verificación |
| Plugin cifrado/biometría incompatible | Media/alto | P03 físico antes core; alternativa A/otro adaptador; ingeniería |
| iOS sin macOS/firma/cuenta | Alta/alto hasta comprobar | Confirmar entorno P01; build CI macOS; propietario aporta cuentas por canales seguros |
| Doble conteo o cambio de formato banco | Alta/alto | Asientos, procedencia, dedupe exacta vs sugerida, fixtures versionadas; ingeniería |
| Fuga entre usuarios | Media/crítico | RLS+API+FK y suite A/B en cada módulo; bloquea release |
| Pérdida de pendientes offline | Media/alto | Transacciones locales, cifrado, migraciones recuperables, pruebas matar app; sin borrado silencioso |
| Coste cloud inesperado | Media/alto | Presupuesto previo, cuotas, alertas, mínimos servicios; sin aprovisionar todavía |
| Crecimiento de alcance | Alta/medio | MVP exacto, V2/V3 y revisión por historias; propietario |
| Push no entregado | Media/medio | Avisos persistentes, estado consultable, sin depender de background para Gmail |
| Proyección engañosa | Media/alto | Mostrar supuestos/cobertura; no tratar cobranzas futuras como caja; producto |
| Protección main no disponible por plan | Por comprobar/medio | Intentar activar; documentar respuesta; PR obligatorio por política sin fingir enforcement |
| Pérdida/restauración DB | Baja/alto | Backups, simulacro restore, registro de supresiones, generación cursor; operación |

## CI/CD actual y previsto

Actual: workflow `Documentacion` ejecuta `python scripts/check_docs.py` en push/PR; permisos contents:read. Comprueba archivos, enlaces locales, 22 entregables y 17 entidades. No compila producto ni demuestra seguridad financiera.

P01: fijar runtime/lockfile; lint, types, unit tests y build web/backend/Android; build iOS en runner macOS. Desde P04 añadir Postgres efímero y permisos/RLS; desde P09 sync; P16 fixtures; P19 E2E y matriz física. Dependabot/auditoría de dependencias y análisis estático disponibles según plan; no llamar «escaneo activo» a una herramienta sólo planificada. Acciones con versiones/commits revisados y permisos mínimos; PRs externos sin secretos.

Main con PR obligatorio, checks exigidos y sin force push/deletion cuando la cuenta permita protección. Para propietario único, no exigir autoaprobación imposible; revisión del producto queda explícita en comentarios/ADR. Comprobar enforcement mediante API y registrar resultado en entrega. No usar `pull_request_target` para ejecutar código no confiable con secretos.

Staging y producción en proyectos/cuentas/DB/secretos separados. Staging usa sólo fixtures; jamás copiar automáticamente datos reales. CI obtiene credenciales por OIDC/identidad federada. Deploy staging desde main tras gates; producción requiere aprobación explícita y evidencia beta. Firma Android/iOS y publicación en tiendas separadas del merge del código. No activar hosting público sólo porque el repo sea privado.

Migraciones expand/contract: introducir esquema compatible, desplegar, verificar, retirar campos en release posterior. Rollback aplicación sólo a versión compatible; no bajar una migración destruyendo transacciones. Backup previo y simulacro de restore antes de cambio incompatible. API versionada acepta ventana de dos clientes; actualización no pierde outbox.

## Operación y puerta de release

Checklist de release: compilación y tests pertinentes verdes; ninguna vulnerabilidad crítica abierta; RLS A/B probado; backup restaurado; sync offline/dedupe pasado; dispositivos Android/iOS reales comprobados; consentimiento Gmail válido; política de privacidad, exportación/revocación/borrado utilizables; alertas y presupuesto definidos. Registrar excepciones no críticas con propietario y fecha; no excepcionar integridad financiera ni aislamiento.

Observabilidad propuesta: salud API/DB, latencia, errores por código, cola atrasada, conflictos, renovación Gmail y duplicados; correlación por ID sin contenido financiero. Alertas por backlog creciente o watch expirado al operador, sin avisar a terceros por defecto. Objetivos de recuperación propuestos: RPO<=24h y RTO<=4h para beta, sujetos a infraestructura contratada; medir en simulacro. No son garantías operativas actuales.

## Fuentes técnicas consultadas

Consulta: 2026-09-06. Revalidar versiones/restricciones al implementar. [Angular PWA](https://angular.dev/ecosystem/service-workers), [Capacitor push](https://capacitorjs.com/docs/apis/push-notifications), [Flutter offline-first](https://docs.flutter.dev/app-architecture/design-patterns/offline-first), [Gmail scopes](https://developers.google.com/workspace/gmail/api/auth/scopes), [Gmail push](https://developers.google.com/workspace/gmail/api/guides/push), [Gmail sync](https://developers.google.com/workspace/gmail/api/guides/sync). El resto de las decisiones y métricas son propuestas de este proyecto, no resultados medidos ni promesas de los proveedores.
