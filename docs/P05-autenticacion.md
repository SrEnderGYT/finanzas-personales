# P05 — autenticación y sesiones (en desarrollo)

P05 todavía no está terminado. Implementa sesiones revocables, registro/login por correo, verificación/recuperación y flujo Google OIDC en la API, además de formularios web/responsive. Incluye pruebas de navegador contra backend real en CI. Quedan retorno nativo y validación del proveedor Google real; MFA incluye inscripción, acceso y recuperación. No se conecta Gmail ni se envían correos reales durante las pruebas.

## Sesiones implementadas

El login crea un token aleatorio de 256 bits. La base guarda su hash SHA-256, nunca el token. El proceso real usa sesiones para `/v1/me`; un JWT de login no puede utilizarse directamente como sesión de API. El canje JWT se conserva probado como adaptador interno, pero queda deshabilitado en main. Google valida el ID token y mapea su subject a un usuario local antes de crear sesión.

| Ruta                         | Credencial                             | Resultado                                               |
| ---------------------------- | -------------------------------------- | ------------------------------------------------------- |
| POST /v1/auth/session        | Prueba JWT interna, firmada y reciente | Nueva sesión; rechaza reutilización incluso concurrente |
| GET /v1/auth/sessions        | Sesión                                 | Lista sólo las sesiones activas propias                 |
| DELETE /v1/auth/sessions/:id | Sesión                                 | Revoca una sesión propia; no revela sesiones ajenas     |
| POST /v1/auth/logout         | Sesión                                 | Revoca la sesión actual en servidor                     |
| DELETE /v1/auth/sessions     | Sesión                                 | Revoca todas las sesiones propias                       |

Los tokens se transportan en Authorization Bearer, nunca en URL ni cookies automáticas. El cliente web implementado los mantiene sólo en memoria; recargar pierde el acceso local y requiere otro login. El almacenamiento de sesión nativo seguro queda pendiente. El futuro flujo web con cookies HttpOnly requerirá su protección CSRF y política de origen antes de habilitarse. No se guarda el token en localStorage ni en el service worker.

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

## Google OIDC

`POST /v1/auth/google/start` recibe mode login, link o reauthenticate. Link requiere Authorization con sesión activa. Devuelve sólo authorizationUrl y establece una cookie host-only HttpOnly/Secure/SameSite=Lax durante diez minutos. `POST /v1/auth/google/complete` recibe state/code y exige esa cookie y Origin exacto. Los endpoints sólo permiten el origen HTTPS configurado; no se aceptan redirect URIs del request.

El backend genera state, nonce y PKCE S256. El verificador y el contexto de vinculación se cifran con AES-GCM y AAD del hash de state. La DB consume el flujo una sola vez antes del intercambio; tras fallo hay que reiniciar, no reutilizar el código. El adaptador usa únicamente los endpoints fijos de Google con timeout y sin redirecciones. Valida firma RS256/JWKS, issuer, audience, azp cuando aplica, nonce, exp/iat, subject y email_verified booleano. Sólo solicita `openid email`, sin Gmail, profile, offline access ni almacenamiento de access/refresh tokens. Basado en [Google OIDC](https://developers.google.com/identity/openid-connect/reference) y [OAuth Security BCP](https://www.rfc-editor.org/rfc/rfc9700.html).

La identidad es subject, nunca email. No hay unión automática con una cuenta local cuyo email coincida: se requiere iniciar sesión local y vincular explícitamente. El flujo link guarda usuario/sesión iniciadora cifrados y comprueba bajo bloqueo que la sesión sigue activa al terminar. No permite trasladar una identidad Google de A a B ni vincular un segundo subject a la misma cuenta. No hay fusión de cuentas existentes. Una cuenta creada primero con Google no recibe automáticamente credenciales de correo; esa ampliación de métodos debe ser explícita. No se persiste el email recibido de Google ni su token completo.

La migración 004 usa RLS forzada para identidades y flujos, sólo accesibles al rol de autenticación. El límite de treinta operaciones Google por IP/ventana de quince minutos vive en PostgreSQL. Un inicio nuevo reemplaza la cookie anterior en el navegador: el flujo anterior deja de funcionar allí.

Para habilitar el adaptador se necesitan GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI (HTTPS, sin fragmento) y GOOGLE_FLOW_KEY (32 bytes aleatorios en base64). El origen se obtiene de esa URI. Sin configuración, Google devuelve servicio no disponible; correo continúa disponible. Aún no se configuraron credenciales reales ni se probaron permisos reales del proveedor. La UI debe recibir code/state, retirarlos inmediatamente de la URL y completar el flujo desde el mismo origen; no guardar tokens en URL/storage. Falta validar también el retorno mediante navegador del sistema/deep link en Android/iOS.

## Estado de validación

`passwords.ts` usa scrypt nativo de Node con N=131072, r=8, p=1, salt de 32 bytes y comparación en tiempo constante, según [OWASP Password Storage](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html). Admite 15–128 caracteres Unicode y hasta 512 bytes, preservando espacios. Usuarios inexistentes también recorren la derivación costosa. Máximo dos derivaciones simultáneas por proceso. Se utiliza en verificación, recuperación y login; las pruebas usan el coste real.

`npm run test:postgres` ejecuta los tests P04 y P05 en PostgreSQL 17.11 desechable. P05 prueba emisión, persistencia de hash, cinco canjes concurrentes, rechazo de JWT directo, logout, A contra B, prohibición de leer hashes/asumir rol privilegiado, revocación entre instancias y expiración. CI debe aprobarlos antes de considerar validado este bloque; los enlaces y resultados se registran en el PR.

## Interfaz de acceso

La ruta `#/acceso` contiene login, registro, verificación, recuperación, sesiones y vinculación Google. Usa el mismo contrato API que las pruebas de PostgreSQL. Los campos de contraseña/código se limpian al terminar cada operación. Los errores nunca muestran el cuerpo de respuesta del servidor. Un 401 elimina el token local; un fallo de red al cerrar sesión conserva la posibilidad de reintentar la revocación remota, sin afirmar que se cerró.

El [preview de acceso](https://srendergyt.github.io/finanzas-personales/#/acceso) se publica con `finanzas-auth=disabled`: inputs y envío desactivados, texto explícito de muestra y cero solicitudes de autenticación. No admite datos personales. Capturas: [desktop](evidence/P05/desktop.png), [móvil claro](evidence/P05/mobile-light.png), [móvil oscuro](evidence/P05/mobile-dark.png).

Para un staging futuro, servir frontend y `/v1` en el mismo origen HTTPS, cambiar la meta `finanzas-auth` a `same-origin` sólo en ese despliegue y configurar el servidor y entrega de correo. No se admite una URL de API arbitraria desde query/storage. El callback Google debe apuntar a la raíz web sin fragmento; la navegación detecta query, retira code/state inmediatamente de la barra y completa el flujo. El documento usa referrer=no-referrer. El hosting debe excluir query strings de logs y no almacenar respuestas API; no basta con esta meta. La UI usa el código de correo pegado manualmente y no construye enlaces externos con tokens.

Las pruebas de navegador verifican preview desactivada, registro visual, responsive, contraste/accesibilidad automatizada, contrato login/sesiones, expiración y ausencia de token en storage. El contrato HTTP del navegador está simulado: no se presenta como E2E completo con PostgreSQL o Google. Las pruebas API con PostgreSQL sí prueban autoridad, aislamiento y concurrencia reales. El commit 349a344 pasó calidad, Android e iOS simulator en [CI](https://github.com/SrEnderGYT/finanzas-personales/actions/runs/34086264600).

Siguiente trabajo dentro de P05: validación real del proveedor Google y retorno nativo. Credenciales Google y envío real se configurarán fuera de Git cuando exista el entorno. Su ausencia no detiene el desarrollo del código y pruebas sintéticas. No hay autenticación de producto publicada ni datos reales.

## Pruebas de sistema con navegador y PostgreSQL

`npm run test:auth-system` crea su propio PostgreSQL desechable con credenciales aleatorias, ejecuta las migraciones y arranca el backend compilado y el frontend Angular compilado en loopback. Requiere previamente `npm run build:web`, `npm run build:backend` y Chromium de Playwright. El job `Browser + PostgreSQL auth` prepara y ejecuta todo en cada PR. No usa DATABASE_URL existente, cuentas reales ni servicios externos.

El navegador registra y verifica dos usuarios sintéticos; el transporte de correo se sustituye por un receptor en memoria mediante el método real de entrega de la outbox cifrada. Login, recuperación, hashing, sesiones, autorizaciones, RLS y respuestas HTTP son reales, sin interceptación Playwright. Recuperar A debe revocar sus dos sesiones y conservar B. El token de A no puede revocar la sesión de B. Otra prueba comprueba el fallo de logout offline, reintento online y pérdida local de sesión al recargar. La PWA permanece activada y su manifest corresponde al index de staging aislado. No se guardan trazas con tokens.

Este bloque sólo puede declararse validado tras aprobar el job en CI. No cubre todavía Google real, transporte real de correo ni retorno nativo. El flujo MFA adicional se describe y valida abajo. Los resultados y el commit se registran en el PR.

## MFA — acceso, inscripción y recuperación

`totp.ts` implementa la generación y comprobación de códigos de autenticador según [RFC 6238](https://datatracker.ietf.org/doc/html/rfc6238): HMAC-SHA1, secreto aleatorio de 160 bits, seis dígitos y periodos de treinta segundos. La comprobación acepta el periodo actual y uno adyacente por lado, compara con timingSafeEqual y devuelve el periodo aceptado. Rechaza periodos ya consumidos según el estado proporcionado. Cuatro pruebas verifican los seis vectores SHA1 publicados, fechas posteriores a 2038, límites de reloj, formatos, reutilización secuencial y parámetros de configuración.

La función TOTP aislada no impide por sí sola la reutilización concurrente: MfaStore bloquea la fila y guarda el periodo aceptado atómicamente antes de emitir una sesión. El reloj y el último periodo usado proceden del servidor, nunca del navegador.

La implementación cifra secretos por usuario, limita intentos de forma persistente, confirma posesión antes de activar el factor y exige MFA tras contraseña o Google. Recuperar la contraseña no lo desactiva. También implementa códigos de recuperación de un solo uso y exige reautenticación para inscribir el factor. Cambiar/eliminar un factor activo sigue pendiente. Los criterios siguen la [guía MFA de OWASP](https://cheatsheetseries.owasp.org/cheatsheets/Multifactor_Authentication_Cheat_Sheet.html). La protección frente a phishing mediante passkeys requiere evaluación adicional; no se atribuye esa propiedad a TOTP.

Criterio de cierre MFA: pruebas concurrentes en PostgreSQL, aislamiento A/B, rechazo de desafíos caducados, recuperación sin bypass y flujo completo desde navegador. La base criptográfica probada no cumple por sí sola ese criterio ni cierra P05.

### Almacenamiento de factores

La migración 005 añade factores con RLS forzada por user_id, accesibles únicamente al rol de autenticación y con contexto del usuario establecido dentro de la transacción. El runtime financiero sólo puede consultar user_id y active propios para bloquear emisión de sesiones sin MFA; no puede leer el secreto cifrado ni modificar factores. `MfaSecrets` cifra con AES-256-GCM y vincula el ciphertext al usuario mediante AAD; copiarlo a otro usuario o cambiar su contenido impide descifrarlo. La clave se recibe explícitamente, sin valor predeterminado ni persistencia en Git.

`MfaStore` implementa el almacenamiento utilizado por los endpoints MFA. Crea inscripciones pendientes de diez minutos; confirmar exige un código válido. No permite reemplazar un factor activo. Serializa los intentos, lee el reloj de PostgreSQL después del bloqueo y consume el periodo bajo bloqueo de fila. Cinco errores bloquean el factor durante quince minutos; los fallos se confirman en DB aunque la validación falle y cambiar una inscripción pendiente conserva el bloqueo. La protección se comparte entre instancias.


### Desafíos de acceso

La migración 006 añade desafíos MFA opacos de cinco minutos, almacenados como hashes. Contraseña y Google llaman al mismo paso de emisión: si hay factor activo, devuelven `mfaRequired`, `challenge` y `expiresAt`, sin token de sesión. Se limita a cinco desafíos pendientes por usuario. `POST /v1/auth/mfa/complete` recibe únicamente challenge/code, aplica límite por IP y cinco intentos por desafío, deriva el usuario desde el desafío y consume código/desafío junto a la creación de sesión en una única transacción. Un desafío no autoriza `/v1/me`. El camino JWT interno no puede saltar el factor.

Recuperar contraseña invalida desafíos pendientes bajo el mismo bloqueo del usuario y conserva el factor activo. Confirmar una inscripción revoca sesiones anteriores. La comprobación de MFA vuelve a ejecutarse dentro de createSession; no basta con haber validado la contraseña. Si emitir sesión falla, el consumo se revierte y puede reintentarse. La clave MFA_ENCRYPTION_KEY debe contener 32 bytes en base64 y almacenarse fuera de Git. Sin clave, completar MFA devuelve servicio no disponible: no se degrada a contraseña sola.

La UI web/responsive recibe el desafío en memoria, muestra el campo del autenticador y no solicita sesiones hasta obtener un token real. Al cancelar o recargar se pierde el desafío local. La preview pública sigue desactivada para autenticación real. Un E2E con PostgreSQL prepara un factor sintético desde el fixture interno y comprueba el login completo desde navegador; no expone un endpoint de preparación. Capturas de ese flujo se guardan como artifact `auth-system-visual` en CI.

### Evidencia del acceso MFA

El commit `c31e558f70369ee6a664e1034f71e5f62164b63c` aprobó los cuatro jobs de [CI](https://github.com/SrEnderGYT/finanzas-personales/actions/runs/34177926478): calidad y builds, navegador con PostgreSQL, APK Android de desarrollo e iOS simulator sin firma. Ese resultado corresponde a aquel commit; la autenticación pública continúa desactivada.

Capturas del navegador conectado al backend de pruebas: [desktop](evidence/P05/mfa-desktop.png), [móvil claro](evidence/P05/mfa-mobile-light.png) y [móvil oscuro](evidence/P05/mfa-mobile-dark.png). Se revisaron visualmente y muestran el campo de seis dígitos y la caducidad de cinco minutos; la prueba también exige teclado numérico. No contienen códigos ni tokens. Fuente: artifact `auth-system-visual` de la ejecución enlazada.

### Almacenamiento de códigos de recuperación

La migración 007 incorpora códigos de recuperación con RLS forzada y acceso exclusivo al rol de autenticación dentro del contexto del usuario. Cada lote contiene diez códigos aleatorios de 128 bits. Se devuelve el texto una sola vez al llamador interno; PostgreSQL conserva únicamente hashes SHA-256 vinculados al usuario y fecha de consumo. Rotar el lote elimina los códigos anteriores.

### Canje de recuperación por API

`POST /v1/auth/mfa/recover` recibe challenge/code y exige el mismo desafío primario de cinco minutos que TOTP. Deriva la identidad desde el desafío; no acepta user_id. Comparte límite por IP y los cinco intentos por desafío con `/complete`. El consumo del código y del desafío se confirma junto con la sesión o se revierte entero si la sesión no puede crearse. El factor permanece activo.

### Interfaz de recuperación MFA

La pantalla del segundo factor permite alternar entre autenticador y código de recuperación manteniendo el desafío en memoria y borrando el campo al cambiar de opción. El código se introduce oculto, con validación de formato y sin almacenarlo en el navegador. Cancelar el acceso elimina el desafío.

### Activación y recuperación atómicas

`confirmEnrollmentWithRecovery` confirma posesión del autenticador, revoca sesiones/desafíos anteriores y genera los diez códigos de recuperación dentro de la misma transacción. Devuelve los códigos sólo en la respuesta de activación. Un reintento sobre el factor ya activo devuelve rechazo y no regenera ni revela el lote. El método booleano interno utilizado por fixtures delega en esta operación; la API utiliza la respuesta completa y exige reautenticación reciente.

### Revisión visual de recuperación

El commit 4032b96 aprobó calidad y las pruebas de navegador/PostgreSQL en [CI](https://github.com/SrEnderGYT/finanzas-personales/actions/runs/34179613172). Las capturas del artifact confirmaron el acceso con recuperación, pero mostraron que la barra fija móvil cubría el botón secundario. Se oculta esa barra mientras se muestra una pantalla de acceso; el enlace de retorno al panel permanece disponible. El E2E exige que la navegación fija esté oculta y regenerará las capturas para revisión. No se publican las capturas anteriores como evidencia de diseño aprobado.

### Evidencia verificada de recuperación

El commit `54b6ecc2fb1a942c8f11491db3020602a0192c31` aprobó todos los jobs de [CI](https://github.com/SrEnderGYT/finanzas-personales/actions/runs/34179835246): calidad, navegador con PostgreSQL, Android APK e iOS simulator sin firma. Incluye activación interna y generación del lote en una transacción, acceso con recuperación y rechazo de reutilización desde navegador.

Capturas revisadas del mismo commit: [desktop](evidence/P05/mfa-recovery-desktop.png), [móvil claro](evidence/P05/mfa-recovery-mobile-light.png) y [móvil oscuro](evidence/P05/mfa-recovery-mobile-dark.png). Los controles se muestran sin superposición y los campos están vacíos; no se incluyen códigos ni tokens. El [APK de desarrollo](https://github.com/SrEnderGYT/finanzas-personales/actions/runs/34179835246/artifacts/10038545756) corresponde al mismo commit. La compilación de iOS es para simulador, no TestFlight.

### Permisos de reautenticación para inscripción

La migración 008 almacena permisos opacos de cinco minutos mediante hashes, ligados a usuario, sesión y propósito fijo mfa-enroll mediante FK compuesta y RLS. Sólo el rol de autenticación puede acceder. Emitir uno reemplaza el permiso pendiente de esa sesión; consumirlo requiere la misma sesión vigente y se realiza dentro de la transacción de inscripción. Se comprueba vigencia después de adquirir el bloqueo. Revocar o caducar la sesión impide el canje.

### Reautenticación por contraseña

`POST /v1/auth/reauthenticate/password` exige una sesión opaca vigente y recibe sólo password. El usuario y la sesión se obtienen de la autoridad de sesiones, nunca del cuerpo. Se comprueba scrypt de nuevo, con límites persistentes de cinco intentos por usuario y treinta por IP en quince minutos. Bajo bloqueo se vuelve a comprobar que la credencial no cambió y que la sesión sigue vigente antes de emitir el permiso mfa-enroll. No emite otra sesión ni permite usar el permiso para acceder a datos.

### Inscripción por API ligada a sesión

`POST /v1/auth/mfa/enrollment/start` exige sesión vigente y grant de reautenticación. El permiso se consume en la misma transacción que crea o reemplaza la inscripción pendiente. La migración 009 liga esa inscripción a la sesión mediante FK compuesta; sólo esa sesión puede llamar `/enrollment/confirm` con el código TOTP. El servidor vuelve a comprobar vigencia bajo bloqueo. Se conservan límites de intentos del factor y caducidad de diez minutos de la inscripción.

### Interfaz de activación con contraseña

Desde la sesión se puede iniciar Activar autenticador, volver a verificar la contraseña, introducir la clave manual en una app TOTP y confirmar su primer código. Al activarlo se muestran diez códigos de recuperación sólo en memoria de la pantalla, con acción explícita Ya guardé mis códigos. Las sesiones anteriores se revocan y el usuario vuelve a entrar con MFA. Los campos se limpian al finalizar cada envío; el secreto y lote no se guardan en storage. La configuración manual está disponible y la alternativa Google se describe abajo; QR sigue pendiente.

### Prueba de autenticación reciente con Google

El adaptador puede solicitar auth_time mediante claims y verificar ese campo firmado contra un umbral del servidor. Rechaza ausencia, tipos incorrectos, fechas antiguas y fechas futuras fuera de cinco segundos de tolerancia. iat no sustituye a auth_time: un token recién emitido puede proceder de una sesión antigua. Referencia: [Google OIDC](https://developers.google.com/identity/openid-connect/reference).

Tres pruebas del proveedor pasan, incluida una prueba de tokens firmados con fecha de autenticación caducada/ausente. El modo reauthenticate liga esta prueba a la sesión y al subject ya vinculado. No se afirma que Google fuerce una contraseña nueva: si no entrega evidencia reciente suficiente, la operación debe rechazarse. Configuración y pruebas con Google real continúan pendientes.

### Reautenticación Google ligada a sesión

El modo reauthenticate de `/google/start` exige sesión activa, conserva su identidad cifrada en el flujo OIDC y solicita auth_time. Al completar, el proveedor verifica autenticación en los últimos cinco minutos y el servidor exige el subject ya vinculado al usuario original. Sólo entonces emite un permiso de inscripción para aquella sesión, comprobando su vigencia bajo bloqueo. No crea usuarios, vincula identidades ni emite otra sesión en este modo.

La prueba PostgreSQL añadida usa proveedor simulado y comprueba solicitud del dato de fecha, umbral de antigüedad, identidad vinculada, replay, revocación y ausencia de sesión adicional. La comprobación criptográfica de auth_time se cubre por separado con tokens firmados. La interfaz conserva la sesión original mediante el retorno en ventana descrito abajo; la validación con proveedor real está pendiente. El flujo no solicita Gmail.

### Validación del bloque de inscripción

La ejecución [34189593062](https://github.com/SrEnderGYT/finanzas-personales/actions/runs/34189593062), del commit 368a02b, terminó correctamente. También pasaron documentación, revisión de secretos y publicación del preview. Esta validación sustituye las notas de CI pendiente de las subsecciones anteriores.

La revisión de la captura móvil de inscripción detectó un borde de error sin contenido y un mensaje de sesión anterior debajo del formulario. Se corrigen manteniendo la región de estado accesible y mostrando el aviso general sólo fuera de la inscripción. Las capturas anteriores no se incorporan como evidencia visual aprobada; se regeneran con el siguiente CI. El retorno Google ya está conectado en Web; falta validar el proveedor real.

### Retorno Google para activar MFA en Web

El formulario permite verificar con la cuenta Google vinculada en una ventana separada. La pestaña original conserva su sesión en memoria; el retorno se acepta únicamente desde la ventana abierta, con origen exacto y state coincidente. El permiso recibido se consume en inscripción sin aceptarlo como un nuevo login. No se guardan códigos OAuth, permisos ni sesiones en storage: la ventana hija contiene solamente una marca de navegación sin datos sensibles, que se elimina al retornar. La URL de retorno se limpia antes de comunicar el resultado.

Se limpian listeners y temporizadores al terminar, cancelar, cerrar la ventana o alcanzar cinco minutos. Si el navegador bloquea la ventana, el formulario muestra una explicación y permite reintentar. Destruir el componente cancela la espera. La comunicación usa origen explícito, siguiendo [MDN postMessage](https://developer.mozilla.org/en-US/docs/Web/API/Window/postMessage).

Validación local: diez pruebas unitarias entre cliente y ventana, typecheck, lint y build Web aprobados. La prueba Playwright de contrato abre una ventana real, simula Google y el API, regresa al origen y verifica una única finalización con la sesión original. No equivale a una prueba contra Google real ni a una prueba de autenticación nativa. Los contratos PostgreSQL y criptográficos se prueban por separado. La política de ventanas del proveedor o del despliegue puede cortar la relación entre ventanas; debe comprobarse en staging con Google configurado. El acceso nativo mediante navegador del sistema y retorno a Capacitor continúa pendiente. No se solicita Gmail.


## Estado consolidado y evidencia actual

El commit 2086a15 conecta reautenticación Google en Web y mantiene P05 abierto para configuración real y retorno nativo. La inscripción por contraseña y la recuperación están implementadas y probadas con API/PostgreSQL reales, no son tareas de implementación pendientes.

| Alcance | Evidencia | Límite |
| --- | --- | --- |
| Cliente y ventana Google | Diez pruebas unitarias locales aprobadas | No contactan Google |
| Retorno de ventana | Playwright abre ventana real y conserva sesión original | API y proveedor simulados |
| Registro, login, recuperación y MFA | Job Browser + PostgreSQL auth de 34236651525 aprobado | Correo externo sustituido por receptor sintético |
| Tipos, lint y builds | Job Lint, tests y builds de 34236651525 aprobado | No equivale a despliegue real |
| Android e iOS | Ambos jobs aprobados en 34236651525 | iOS es simulador sin firma, no TestFlight |

La [ejecución 34236651525](https://github.com/SrEnderGYT/finanzas-personales/actions/runs/34236651525) corresponde al PR con head 2086a15 y prueba su merge sintético c9bf367ee4f9272bf570ea8945066f4216778191. Las pruebas PostgreSQL cubren permisos de inscripción, rechazo desde otra sesión, replay, revocación y emisión/consumo atómicos. El E2E de inscripción por contraseña recorre entrega de diez códigos y nuevo acceso mediante uno, sin preparar el factor desde fixtures.

Entregables del mismo merge probado: [APK Android de desarrollo](https://github.com/SrEnderGYT/finanzas-personales/actions/runs/34236651525/artifacts/10060259679) e [iOS simulator sin firma](https://github.com/SrEnderGYT/finanzas-personales/actions/runs/34236651525/artifacts/10060256159). Son builds DEMO; sus artifacts incluyen metadata de versión, commit, fecha y entorno.

Capturas de inscripción revisadas visualmente del artifact auth-system-visual de esa ejecución: [desktop](evidence/P05/mfa-enrollment-desktop.png), [móvil claro](evidence/P05/mfa-enrollment-mobile-light.png) y [móvil oscuro](evidence/P05/mfa-enrollment-mobile-dark.png). Los campos están vacíos, sin claves/tokens y sin superposición de controles. Sustituyen la evidencia inicial con borde de error vacío y aviso de sesión anterior.

Pendientes de producto: Google y correo reales en staging HTTPS, políticas de ventanas, retorno Capacitor mediante navegador del sistema, persistencia nativa segura de sesión y pruebas en dispositivos. También siguen pendientes retención/limpieza de colas y recibos, rotación de claves y validación de proxies/IP antes de producción. Los endpoints actuales no permiten reemplazar/eliminar factores activos ni regenerar códigos de recuperación. El preview público continúa desactivado para autenticación y usa únicamente datos sintéticos.

### Preparación del retorno nativo

`NativeAuthReturn` acepta solamente el destino HTTPS configurado, con ruta exacta y state de una petición pendiente de cinco minutos. Rechaza enlaces ajenos, parámetros duplicados, fragmentos, credenciales en URL y parámetros de token. Un retorno correlacionado se consume una sola vez, incluso si viene denegado o malformado. Una apertura en frío sin petición pendiente se rechaza: no reconstruye identidad a partir del enlace.

`listenForNativeAuth` registra appUrlOpen de Capacitor antes de abrir el navegador, devuelve el código al llamador y elimina sólo su listener al completar, cancelar o caducar. También elimina un registro nativo que termine después de una cancelación. Seis pruebas sintéticas verifican correlación, replay, expiración, errores, rechazo y limpieza. No está conectado aún al botón de acceso ni al intercambio PKCE nativo: es la pieza de recepción, no autenticación nativa terminada.

El siguiente paso requiere transporte de API nativo y un flujo del servidor ligado a prueba PKCE del dispositivo; la cookie Web no se comparte automáticamente con el navegador del sistema. El destino deberá contar con Android App Links/iOS Universal Links y archivos de asociación del dominio antes de habilitarlo. No se configura un dominio ficticio en los binarios. Referencias: [Capacitor App](https://capacitorjs.com/docs/apis/app) y [RFC 8252](https://www.rfc-editor.org/rfc/rfc8252).

### Coordinación PKCE del dispositivo

`nativeGoogleFlow` une generación de prueba, registro del listener, apertura del navegador y canje mediante un transporte explícito. Genera state y verifier independientes de 256 bits usando Web Crypto; sólo envía challenge S256 al inicio. Reserva verifier para el canje, no lo coloca en URL ni storage y descarta su referencia al terminar. No promete borrado físico de strings en memoria JavaScript. Comprueba destino fijo de Google y state antes de abrirlo, propaga cancelación y limita el intento a cinco minutos. El transporte debe respetar AbortSignal.

Cuatro pruebas adicionales verifican el vector S256 del [RFC 7636](https://www.rfc-editor.org/rfc/rfc7636), formatos, pruebas independientes, canje correlacionado y rechazo de destinos ajenos sin abrir navegador. Tipo estricto y lint aprobados localmente. El navegador y transporte se simulan en estas pruebas: aún faltan implementación del contrato en backend, configuración de enlaces asociados y conexión al botón nativo. No se habilita OAuth real ni se incluyen secretos en la app.

### Vigencia de sesión durante la vinculación Google

La vinculación ahora utiliza la misma comprobación lockLiveSession que la reautenticación: adquiere el bloqueo de usuario y sesión antes de consultar clock_timestamp. Evita que now(), fijado al inicio de la transacción, acepte una sesión que caducó esperando el bloqueo. La regresión PostgreSQL observa el bloqueo mediante pg_blocking_pids, caduca la sesión mientras espera y exige 401 sin crear identidad vinculada. Esta prueba requiere aprobación del siguiente CI; no se presenta como ejecutada localmente sin PostgreSQL.

### Contrato API nativo de Google

`POST /v1/auth/google/native/start` recibe state/challenge/method, exige S256 y crea un flujo cifrado de cinco minutos. No usa la cookie del navegador. `POST /v1/auth/google/native/complete` recibe state/code/verifier: deriva el challenge y lo compara mediante la condición de consumo antes de contactar al proveedor. Un verificador incorrecto no consume el flujo. Canjes concurrentes permiten una sola operación. La vinculación del flujo tiene un prefijo de propósito nativo y un indicador cifrado, separados del flujo Web.

La finalización comparte las reglas existentes de identidad por subject, rechazo de vinculación implícita por email y emisión con MFA cuando corresponda. Este contrato inicial permite login nativo, no vinculación ni reautenticación nativas. No se acepta redirectUri del cuerpo ni se guarda el verificador del dispositivo. Se reutiliza app.oidc_flows y sus políticas de acceso; no hay cambios de esquema.

Se habilita únicamente con NATIVE_GOOGLE_CLIENT_ID, NATIVE_GOOGLE_CLIENT_SECRET, NATIVE_GOOGLE_REDIRECT_URI y NATIVE_GOOGLE_FLOW_KEY (32 bytes base64) en el servidor. La configuración es independiente de Web; el secreto nunca va en el binario. El destino HTTPS debe corresponder al enlace asociado de la app. Sin configuración las rutas devuelven 503. Las pruebas PostgreSQL añadidas cubren PKCE incorrecto, replay concurrente, uso de sesión emitida, rechazo de plain/redirect inyectado y separación Web/nativo; quedan pendientes de CI. Continúan pendientes el transporte HTTP del cliente, el botón y la validación en dispositivos/proveedor real.

### Cliente del contrato nativo

AuthClient.nativeGoogle conecta la coordinación PKCE con `/google/native/start` y `/google/native/complete`, propaga cancelación a las solicitudes con límite adicional de quince segundos y aplica el mismo validador de sesión/desafío MFA del cliente Web. La prueba del cliente confirma que el verificador no se envía al inicio, que un desafío MFA no abre sesión y que el preview desactivado no registra listeners ni abre navegador. La configuración de transporte HTTPS externo para Capacitor y el botón nativo siguen pendientes; el método no se habilita automáticamente en los binarios DEMO.

Nueve pruebas de cliente aprobadas localmente, typecheck y build mobile correctos. Integrar el módulo en Angular detectó que URLSearchParams.keys requería una biblioteca iterable no incluida: se usa forEach compatible con ambas aplicaciones. Los jobs de calidad y navegador/PostgreSQL del servidor 4da8399 aprobaron en [34272919709](https://github.com/SrEnderGYT/finanzas-personales/actions/runs/34272919709); Android/iOS continuaban ejecutándose al registrar esta evidencia. Esto valida las pruebas PostgreSQL nativas del bloque anterior y la regresión de vigencia de sesión, sin equivaler a Google real.

### Transporte HTTPS del cliente móvil

AuthClient.forNativeServer recibe un origen HTTPS explícito y crea un transporte restringido a rutas `/v1/auth/`. nativeAuthHttp rechaza URLs completas del llamador, traversal, query/fragment y segmentos ambiguos; fuerza credentials omit, redirect error, cache no-store y referrerPolicy no-referrer. Conserva Authorization y la cancelación sólo para ese destino. Comprueba también que la respuesta no declare otro destino. El origen debe venir de la configuración de compilación, nunca de enlaces o almacenamiento del navegador.

Seis pruebas de transporte/cliente aprobadas localmente comprueban destino, opciones, rechazo previo al envío y construcción del cliente. No constituye una prueba de red desde un dispositivo: queda habilitar CORS con orígenes explícitos del runtime Capacitor en el servidor y conectar la configuración de arranque y el botón. No se desactiva la seguridad del navegador ni se configura ningún dominio ficticio en el APK.

### CORS de autenticación para Capacitor

NATIVE_AUTH_CORS=enabled activa en el servidor una política restringida a capacitor://localhost y https://localhost. Sólo afecta `/v1/auth/`, excluyendo el OAuth Web basado en cookie. Preflight permite GET/POST/DELETE y Authorization/Content-Type; rechaza métodos o encabezados adicionales. No permite credenciales automáticas/cookies ni origen comodín. Las respuestas varían por Origin y conservan no-store. Otros orígenes y las rutas financieras no reciben permiso CORS.

Las dos pruebas HTTP de integración pasan localmente, incluyendo preflight de ambos runtimes, rechazo de orígenes ajenos/null, rutas Web excluidas, configuración desactivada y conservación del rechazo del servicio no configurado. Tipos, lint y build backend aprobados. CORS no autentica al llamador: siguen siendo obligatorios los controles API y sesiones. Falta conectar la configuración de arranque y el botón móvil y validar los orígenes reales en dispositivo antes de activar staging.

### Conexión de arranque nativo y navegador — 9 septiembre 2026

El botón de Google utiliza el coordinador PKCE nativo cuando el build Capacitor tiene una configuración HTTPS explícita. El navegador del sistema comunica cancelación; al abandonar la pantalla se cancela el flujo y se retiran sus listeners. Una falla al retirar un listener no oculta el resultado original. Browser 8.0.4 está incluido en los proyectos Android e iOS sincronizados.

`apps/mobile/src/native-auth.config.ts` permanece en `null`: el preview público y los builds sin staging siguen deshabilitados. No contiene dominios inventados ni credenciales. La vinculación de Google y la reautenticación Google para activar MFA en nativo siguen pendientes; el flujo Web permanece disponible en despliegues autorizados. La entrada nativa sí conserva el desafío MFA del servidor.

Validación local: typecheck, lint, formato, 48 pruebas unitarias, 2 de integración API, 5 pruebas Playwright de autenticación/retorno Google; builds Web, Mobile y backend. Sincronización confirma Browser en Android/iOS. Estas pruebas son sintéticas. PostgreSQL y builds nativos del nuevo commit deben confirmarse en CI. Google real, asociación HTTPS de app links y pruebas en dispositivos físicos no se han ejecutado. No se habilita P06.

### Reautenticación Google nativa para MFA — 9 septiembre 2026

El botón de verificación Google del formulario MFA ya usa el navegador nativo cuando existe configuración Capacitor autorizada. El endpoint `POST /v1/auth/google/native/reauthenticate` exige sesión y vincula el flujo PKCE cifrado a esa sesión. Solicita autenticación reciente y reutiliza la verificación firmada de `auth_time`, identidad vinculada y sesión viva. Devuelve un permiso de inscripción; no crea otra sesión. El cliente conserva el token original y rechaza un cambio de sesión durante el retorno. El preview sigue deshabilitado.

Pruebas locales: 49 unitarias, 2 integración API, 5 Playwright; lint, typecheck, formato y builds Web/Mobile/backend aprobados. Nueva prueba PostgreSQL cubre inicio sin sesión, identidad incorrecta, sesión revocada, replay, solicitud de frescura y ausencia de sesión nueva. Pendiente de su ejecución en CI al publicar este commit. CI del anterior 71d8804: los cuatro trabajos de Calidad pasaron, incluidos PostgreSQL/browser, Android e iOS simulador sin firma (run 34318034655).

Pendientes: vinculación nativa de Google, validación real de Google y app links HTTPS en dispositivos, staging y firma/TestFlight. Esta sección reemplaza la limitación anterior sobre ausencia de reautenticación nativa; no declara probada la ejecución real con Google. P06 sigue sin iniciar.
