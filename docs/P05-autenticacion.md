# P05 — autenticación y sesiones (en desarrollo)

P05 todavía no está terminado. Este primer bloque implementa sesiones revocables en PostgreSQL; quedan login Google/email, verificación de correo, recuperación, integración web/móvil y la evaluación de MFA. No se conecta Gmail ni se envían correos reales durante las pruebas.

## Sesiones implementadas

Una prueba de login firmada por un emisor configurado se canjea una sola vez por un token aleatorio de 256 bits. La base guarda su hash SHA-256, nunca el token. El proceso real usa sesiones para `/v1/me`; un JWT de login no puede utilizarse directamente como sesión de API. La prueba todavía procede del adaptador interno P04: no es un token Google que se acepte sin mapear su identidad.

| Ruta                         | Credencial                             | Resultado                                               |
| ---------------------------- | -------------------------------------- | ------------------------------------------------------- |
| POST /v1/auth/session        | Prueba JWT interna, firmada y reciente | Nueva sesión; rechaza reutilización incluso concurrente |
| GET /v1/auth/sessions        | Sesión                                 | Lista sólo las sesiones activas propias                 |
| DELETE /v1/auth/sessions/:id | Sesión                                 | Revoca una sesión propia; no revela sesiones ajenas     |
| POST /v1/auth/logout         | Sesión                                 | Revoca la sesión actual en servidor                     |
| DELETE /v1/auth/sessions     | Sesión                                 | Revoca todas las sesiones propias                       |

Los tokens se transportan en Authorization Bearer, nunca en URL ni cookies automáticas. El cliente real deberá mantenerlos en memoria en web y almacenamiento seguro en móvil; aún no se ha conectado ese cliente. El futuro flujo web con cookies HttpOnly requerirá su protección CSRF y política de origen antes de habilitarse. No se debe guardar el token en localStorage ni en el service worker.

La política inicial limita a diez sesiones activas, con vencimiento absoluto de doce horas y por inactividad de treinta minutos. PostgreSQL aplica ambos límites en cada resolución. Logout y revocación afectan inmediatamente a solicitudes posteriores en cualquier instancia; no cancelan operaciones que ya pasaron la autorización y estén ejecutándose. No hay caché de autorización que sobreviva a la revocación.

## Migración y límites de privilegios

`002_sessions.sql` crea `app.sessions` y `app.login_receipts`, con FK a usuarios y RLS forzada. La PK de sesiones incluye user_id. El runtime sólo puede leer metadata propia, insertar la sesión y cambiar `revoked_at`; no puede leer hashes, reasignar propietarios ni extender expiración. Los recibos impiden canjear otra vez la misma prueba, incluso después de logout. Su limpieza debe implementarse con retención superior a la máxima validez de la prueba (incluida tolerancia de reloj); mientras tanto se conservan.

Antes de conocer user_id, la función estrecha `app.resolve_session(hash)` busca una única sesión válida y actualiza su última actividad. Es SECURITY DEFINER, con search_path fijo a pg_catalog y referencias de tablas calificadas. Su propietario es un rol NOLOGIN que sólo puede leer sesiones y actualizar last_seen_at. El runtime no puede asumir ese rol. PUBLIC no tiene EXECUTE; la función no admite SQL dinámico ni devuelve hashes. Estas excepciones deben revisarse al añadir nuevas migraciones.

El diseño sigue las recomendaciones de [gestión de sesiones de OWASP](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html): identificador aleatorio sin datos personales y expiración/revocación en servidor. RLS sigue siendo una defensa frente a consultas defectuosas, no frente al control total del servidor.

## Evidencia y trabajo restante

`npm run test:postgres` ejecuta los tests P04 y P05 en PostgreSQL 17.11 desechable. P05 prueba emisión, persistencia de hash, cinco canjes concurrentes, rechazo de JWT directo, logout, A contra B, prohibición de leer hashes/asumir rol privilegiado, revocación entre instancias y expiración. CI debe aprobarlos antes de considerar validado este bloque; los enlaces y resultados se registran en el PR.

No hay cambios visuales en este bloque. El [preview](https://srendergyt.github.io/finanzas-personales/) y las [capturas](P02-preview.md) siguen mostrando DEMO. No hay autenticación de producto publicada ni datos reales.

Siguiente trabajo dentro de P05: registro/login con contraseña segura, verificación y recuperación con tokens de un solo uso, entrega de correo de desarrollo aislada, Google OIDC con state/nonce/PKCE y vinculación segura, rate limiting, revocación al recuperar contraseña, UX de sesiones y pruebas completas. Credenciales Google y envío real se configurarán fuera de Git cuando exista el entorno. No se presenta su ausencia como motivo para detener el desarrollo del código y sus pruebas sintéticas.
