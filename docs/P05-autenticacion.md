# P05 — autenticación y sesiones (en desarrollo)

P05 todavía no está terminado. Implementa sesiones revocables, registro/login por correo, verificación/recuperación y flujo Google OIDC en la API. Quedan integración web/móvil, validación del proveedor real y evaluación de MFA. No se conecta Gmail ni se envían correos reales durante las pruebas.

## Sesiones implementadas

El login crea un token aleatorio de 256 bits. La base guarda su hash SHA-256, nunca el token. El proceso real usa sesiones para `/v1/me`; un JWT de login no puede utilizarse directamente como sesión de API. El canje JWT se conserva probado como adaptador interno, pero queda deshabilitado en main. Google valida el ID token y mapea su subject a un usuario local antes de crear sesión.

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

## Registro, verificación y recuperación

| Ruta POST                | Body            | Resultado                                            |
| ------------------------ | --------------- | ---------------------------------------------------- |
| /v1/auth/register        | email           | 202 genérico; encola verificación si corresponde     |
| /v1/auth/verify-email    | token, password | Define contraseña y verifica correo una sola vez     |
| /v1/auth/login           | email, password | Sesión revocable para credencial verificada          |
| /v1/auth/forgot-password | email           | 202 genérico para direcciones conocidas/desconocidas |
| /v1/auth/reset-password  | token, password | Cambia contraseña y revoca todas las sesiones        |

La contraseña se elige al demostrar posesión del correo, para impedir una preregistración con contraseña elegida por un atacante. Los tokens de correo tienen 256 bits, se guardan como hashes, duran quince minutos y distinguen verificación de recuperación. Solicitar otro invalida los anteriores de ese tipo. Consumirlo invalida todos los restantes del usuario. Actualización de contraseña, consumo y revocación comparten transacción. Login comprueba de nuevo el hash bajo bloqueo de credencial y crea la sesión en esa misma transacción: una recuperación concurrente no puede omitir una sesión emitida con la contraseña antigua.

`finanzas_auth_runtime` y AUTH_DATABASE_URL están separados del runtime financiero. Acceden a credenciales para autenticar, pero no a preferencias ni información financiera. La migración 003 fuerza RLS en todas las tablas nuevas. El runtime financiero no puede leer credenciales, desafíos ni correos pendientes. El límite en PostgreSQL aplica treinta intentos por IP y diez por email en ventanas de quince minutos, antes de derivar contraseñas; funciona entre instancias. No se confía en X-Forwarded-For. Configuración de proxies confiables y agregación IPv6 requieren validación antes de staging.

Los correos pendientes se encolan en la misma transacción, cifrados con AES-256-GCM, IV aleatorio y AAD del ID. AUTH_MAIL_KEY contiene 32 bytes aleatorios en base64, custodiados fuera de Git. La API no devuelve tokens de correo. `npm run mail:deliver` procesa hasta 25 mensajes mediante AUTH_MAIL_WEBHOOK (HTTPS) y AUTH_MAIL_WEBHOOK_TOKEN, con timeout y sin redirecciones. No se configuró ni ejecutó envío real. El transporte recibe recipient/kind/token para generar una plantilla escapada y un enlace a una URL fija de la aplicación; habilitarlo sólo con transporte seguro y UI de verificación. Una caída después del envío y antes del commit puede repetir un mensaje, pero el token sólo se consume una vez. Limpieza de colas, límites históricos y recibos, rotación de clave y mensajes vencidos siguen pendientes antes de producción.

La API ahora requiere DATABASE_URL restringida, AUTH_DATABASE_URL de autenticación y AUTH_MAIL_KEY; ya no requiere AUTH_PUBLIC_JWKS/AUTH_ISSUER/AUTH_AUDIENCE porque el canje externo está deshabilitado. Nunca usar el login migrador para estos roles.

## Evidencia y trabajo restante

## Google OIDC

`POST /v1/auth/google/start` recibe `{mode:"login"}` o `{mode:"link"}`. Link requiere Authorization con sesión activa. Devuelve sólo authorizationUrl y establece una cookie host-only HttpOnly/Secure/SameSite=Lax durante diez minutos. `POST /v1/auth/google/complete` recibe state/code y exige esa cookie y Origin exacto. Los endpoints sólo permiten el origen HTTPS configurado; no se aceptan redirect URIs del request.

El backend genera state, nonce y PKCE S256. El verificador y el contexto de vinculación se cifran con AES-GCM y AAD del hash de state. La DB consume el flujo una sola vez antes del intercambio; tras fallo hay que reiniciar, no reutilizar el código. El adaptador usa únicamente los endpoints fijos de Google con timeout y sin redirecciones. Valida firma RS256/JWKS, issuer, audience, azp cuando aplica, nonce, exp/iat, subject y email_verified booleano. Sólo solicita `openid email`, sin Gmail, profile, offline access ni almacenamiento de access/refresh tokens. Basado en [Google OIDC](https://developers.google.com/identity/openid-connect/reference) y [OAuth Security BCP](https://www.rfc-editor.org/rfc/rfc9700.html).

La identidad es subject, nunca email. No hay unión automática con una cuenta local cuyo email coincida: se requiere iniciar sesión local y vincular explícitamente. El flujo link guarda usuario/sesión iniciadora cifrados y comprueba bajo bloqueo que la sesión sigue activa al terminar. No permite trasladar una identidad Google de A a B ni vincular un segundo subject a la misma cuenta. No hay fusión de cuentas existentes. Una cuenta creada primero con Google no recibe automáticamente credenciales de correo; esa ampliación de métodos debe ser explícita. No se persiste el email recibido de Google ni su token completo.

La migración 004 usa RLS forzada para identidades y flujos, sólo accesibles al rol de autenticación. El límite de treinta operaciones Google por IP/ventana de quince minutos vive en PostgreSQL. Un inicio nuevo reemplaza la cookie anterior en el navegador: el flujo anterior deja de funcionar allí.

Para habilitar el adaptador se necesitan GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI (HTTPS, sin fragmento) y GOOGLE_FLOW_KEY (32 bytes aleatorios en base64). El origen se obtiene de esa URI. Sin configuración, Google devuelve servicio no disponible; correo continúa disponible. Aún no se configuraron credenciales reales ni se probaron permisos reales del proveedor. La UI debe recibir code/state, retirarlos inmediatamente de la URL y completar el flujo desde el mismo origen; no guardar tokens en URL/storage. Falta validar también el retorno mediante navegador del sistema/deep link en Android/iOS.

Dos tests de proveedor verifican claims firmados y scopes/PKCE. Cuatro tests con PostgreSQL y proveedor simulado verifican cookie/origen, identidad estable, state intercambiado, expiración, replay concurrente, colisión email, vinculación A/B, sesión revocada y permisos sobre secretos. El proveedor simulado exige el verificador PKCE correcto; no contacta Google. CI debe aprobar la ejecución antes de considerarla evidencia. No sustituye un E2E con Google real.

## Estado de validación

`passwords.ts` usa scrypt nativo de Node con N=131072, r=8, p=1, salt de 32 bytes y comparación en tiempo constante, según [OWASP Password Storage](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html). Admite 15–128 caracteres Unicode y hasta 512 bytes, preservando espacios. Usuarios inexistentes también recorren la derivación costosa. Máximo dos derivaciones simultáneas por proceso. Se utiliza en verificación, recuperación y login; las pruebas usan el coste real.

`npm run test:postgres` ejecuta los tests P04 y P05 en PostgreSQL 17.11 desechable. P05 prueba emisión, persistencia de hash, cinco canjes concurrentes, rechazo de JWT directo, logout, A contra B, prohibición de leer hashes/asumir rol privilegiado, revocación entre instancias y expiración. CI debe aprobarlos antes de considerar validado este bloque; los enlaces y resultados se registran en el PR.

No hay cambios visuales en este bloque. El [preview](https://srendergyt.github.io/finanzas-personales/) y las [capturas](P02-preview.md) siguen mostrando DEMO. No hay autenticación de producto publicada ni datos reales.

Siguiente trabajo dentro de P05: UI de login/verificación/recuperación/sesiones y callback Google, E2E completos, evaluación MFA y validación real del proveedor/retorno nativo. Credenciales Google y envío real se configurarán fuera de Git cuando exista el entorno. Su ausencia no detiene el desarrollo del código y pruebas sintéticas.
