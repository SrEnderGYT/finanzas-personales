# P05 — autenticación y sesiones (en desarrollo)

P05 todavía no está terminado. Implementa sesiones revocables, registro/login por correo, verificación/recuperación y flujo Google OIDC en la API, además de formularios web/responsive. Incluye pruebas de navegador contra backend real en CI. Quedan retorno nativo, validación del proveedor Google real y evaluación de MFA. No se conecta Gmail ni se envían correos reales durante las pruebas.

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

## Interfaz de acceso

La ruta `#/acceso` contiene login, registro, verificación, recuperación, sesiones y vinculación Google. Usa el mismo contrato API que las pruebas de PostgreSQL. Los campos de contraseña/código se limpian al terminar cada operación. Los errores nunca muestran el cuerpo de respuesta del servidor. Un 401 elimina el token local; un fallo de red al cerrar sesión conserva la posibilidad de reintentar la revocación remota, sin afirmar que se cerró.

El [preview de acceso](https://srendergyt.github.io/finanzas-personales/#/acceso) se publica con `finanzas-auth=disabled`: inputs y envío desactivados, texto explícito de muestra y cero solicitudes de autenticación. No admite datos personales. Capturas: [desktop](evidence/P05/desktop.png), [móvil claro](evidence/P05/mobile-light.png), [móvil oscuro](evidence/P05/mobile-dark.png).

Para un staging futuro, servir frontend y `/v1` en el mismo origen HTTPS, cambiar la meta `finanzas-auth` a `same-origin` sólo en ese despliegue y configurar el servidor y entrega de correo. No se admite una URL de API arbitraria desde query/storage. El callback Google debe apuntar a la raíz web sin fragmento; la navegación detecta query, retira code/state inmediatamente de la barra y completa el flujo. El documento usa referrer=no-referrer. El hosting debe excluir query strings de logs y no almacenar respuestas API; no basta con esta meta. La UI usa el código de correo pegado manualmente y no construye enlaces externos con tokens.

Las pruebas de navegador verifican preview desactivada, registro visual, responsive, contraste/accesibilidad automatizada, contrato login/sesiones, expiración y ausencia de token en storage. El contrato HTTP del navegador está simulado: no se presenta como E2E completo con PostgreSQL o Google. Las pruebas API con PostgreSQL sí prueban autoridad, aislamiento y concurrencia reales. El commit 349a344 pasó calidad, Android e iOS simulator en [CI](https://github.com/SrEnderGYT/finanzas-personales/actions/runs/34086264600).

Siguiente trabajo dentro de P05: inscripción y recuperación MFA, y validación real del proveedor Google/retorno nativo. Credenciales Google y envío real se configurarán fuera de Git cuando exista el entorno. Su ausencia no detiene el desarrollo del código y pruebas sintéticas. No hay autenticación de producto publicada ni datos reales.

## Pruebas de sistema con navegador y PostgreSQL

`npm run test:auth-system` crea su propio PostgreSQL desechable con credenciales aleatorias, ejecuta las migraciones y arranca el backend compilado y el frontend Angular compilado en loopback. Requiere previamente `npm run build:web`, `npm run build:backend` y Chromium de Playwright. El job `Browser + PostgreSQL auth` prepara y ejecuta todo en cada PR. No usa DATABASE_URL existente, cuentas reales ni servicios externos.

El navegador registra y verifica dos usuarios sintéticos; el transporte de correo se sustituye por un receptor en memoria mediante el método real de entrega de la outbox cifrada. Login, recuperación, hashing, sesiones, autorizaciones, RLS y respuestas HTTP son reales, sin interceptación Playwright. Recuperar A debe revocar sus dos sesiones y conservar B. El token de A no puede revocar la sesión de B. Otra prueba comprueba el fallo de logout offline, reintento online y pérdida local de sesión al recargar. La PWA permanece activada y su manifest corresponde al index de staging aislado. No se guardan trazas con tokens.

Este bloque sólo puede declararse validado tras aprobar el job en CI. No cubre todavía Google real, transporte real de correo ni retorno nativo. El flujo MFA adicional se describe y valida abajo. Los resultados y el commit se registran en el PR.

## MFA — acceso integrado, inscripción y recuperación pendientes

`totp.ts` implementa la generación y comprobación de códigos de autenticador según [RFC 6238](https://datatracker.ietf.org/doc/html/rfc6238): HMAC-SHA1, secreto aleatorio de 160 bits, seis dígitos y periodos de treinta segundos. La comprobación acepta el periodo actual y uno adyacente por lado, compara con timingSafeEqual y devuelve el periodo aceptado. Rechaza periodos ya consumidos según el estado proporcionado. Cuatro pruebas verifican los seis vectores SHA1 publicados, fechas posteriores a 2038, límites de reloj, formatos, reutilización secuencial y parámetros de configuración.

La función TOTP aislada no impide por sí sola la reutilización concurrente: el servicio deberá bloquear la fila y guardar el periodo aceptado atómicamente antes de emitir una sesión. El reloj y el último periodo usado procederán del servidor, nunca del navegador.

La implementación cifra secretos por usuario, limita intentos de forma persistente, confirma posesión antes de activar el factor y exige MFA tras contraseña o Google. Recuperar la contraseña no lo desactiva. También deberá implementar códigos de recuperación de un solo uso y exigir reautenticación para cambios del factor. Los criterios siguen la [guía MFA de OWASP](https://cheatsheetseries.owasp.org/cheatsheets/Multifactor_Authentication_Cheat_Sheet.html). La protección frente a phishing mediante passkeys requiere evaluación adicional; no se atribuye esa propiedad a TOTP.

Criterio de cierre MFA: pruebas concurrentes en PostgreSQL, aislamiento A/B, rechazo de desafíos caducados, recuperación sin bypass y flujo completo desde navegador. La base criptográfica probada no cumple por sí sola ese criterio ni cierra P05.

### Almacenamiento de factores

La migración 005 añade factores con RLS forzada por user_id, accesibles únicamente al rol de autenticación y con contexto del usuario establecido dentro de la transacción. El runtime financiero sólo puede consultar user_id y active propios para bloquear emisión de sesiones sin MFA; no puede leer el secreto cifrado ni modificar factores. `MfaSecrets` cifra con AES-256-GCM y vincula el ciphertext al usuario mediante AAD; copiarlo a otro usuario o cambiar su contenido impide descifrarlo. La clave se recibe explícitamente, sin valor predeterminado ni persistencia en Git.

`MfaStore` es un servicio interno aún sin endpoints. Crea inscripciones pendientes de diez minutos; confirmar exige un código válido. No permite reemplazar un factor activo. Serializa los intentos, lee el reloj de PostgreSQL después del bloqueo y consume el periodo bajo bloqueo de fila. Cinco errores bloquean el factor durante quince minutos; los fallos se confirman en DB aunque la validación falle y cambiar una inscripción pendiente conserva el bloqueo. La protección se comparte entre instancias.

Dos pruebas unitarias cubren cifrado y manipulación. Cuatro pruebas PostgreSQL cubren cinco intentos concurrentes con un único éxito, bloqueos persistentes, expiración, sustitución de ciphertext y RLS A/B. Su evidencia requiere aprobación de CI. El acceso integrado deriva el usuario del desafío verificado e incorpora consumo y emisión de sesión a la misma transacción. La futura inscripción debe exigir reautenticación para inscribir/cambiar el factor. El segundo factor se exige en login cuando el factor está activo. Todavía no hay recuperación MFA ni inscripción accesible al usuario; no se deben crear factores de producción hasta completar esos flujos.


### Desafíos de acceso

La migración 006 añade desafíos MFA opacos de cinco minutos, almacenados como hashes. Contraseña y Google llaman al mismo paso de emisión: si hay factor activo, devuelven `mfaRequired`, `challenge` y `expiresAt`, sin token de sesión. Se limita a cinco desafíos pendientes por usuario. `POST /v1/auth/mfa/complete` recibe únicamente challenge/code, aplica límite por IP y cinco intentos por desafío, deriva el usuario desde el desafío y consume código/desafío junto a la creación de sesión en una única transacción. Un desafío no autoriza `/v1/me`. El camino JWT interno no puede saltar el factor.

Recuperar contraseña invalida desafíos pendientes bajo el mismo bloqueo del usuario y conserva el factor activo. Confirmar una inscripción revoca sesiones anteriores. La comprobación de MFA vuelve a ejecutarse dentro de createSession; no basta con haber validado la contraseña. Si emitir sesión falla, el consumo se revierte y puede reintentarse. La clave MFA_ENCRYPTION_KEY debe contener 32 bytes en base64 y almacenarse fuera de Git. Sin clave, completar MFA devuelve servicio no disponible: no se degrada a contraseña sola.

La UI web/responsive recibe el desafío en memoria, muestra el campo del autenticador y no solicita sesiones hasta obtener un token real. Al cancelar o recargar se pierde el desafío local. La preview pública sigue desactivada para autenticación real. Un E2E con PostgreSQL prepara un factor sintético desde el fixture interno y comprueba el login completo desde navegador; no expone un endpoint de preparación. Capturas de ese flujo se guardan como artifact `auth-system-visual` en CI.

Validación aprobada en CI del bloque: cinco pruebas API/PostgreSQL para contraseña, Google simulado, concurrencia, recuperación, límites, expiración, aislamiento y rollback por límite de sesiones; un E2E de MFA real y una prueba del contrato del cliente. No equivalen a inscripción/recuperación MFA terminadas ni a Google real. P05 permanece abierto.

### Evidencia del acceso MFA

El commit `c31e558f70369ee6a664e1034f71e5f62164b63c` aprobó los cuatro jobs de [CI](https://github.com/SrEnderGYT/finanzas-personales/actions/runs/34177926478): calidad y builds, navegador con PostgreSQL, APK Android de desarrollo e iOS simulator sin firma. El preview público sirve ese commit con datos sintéticos; la autenticación pública continúa desactivada.

Capturas del navegador conectado al backend de pruebas: [desktop](evidence/P05/mfa-desktop.png), [móvil claro](evidence/P05/mfa-mobile-light.png) y [móvil oscuro](evidence/P05/mfa-mobile-dark.png). Se revisaron visualmente y muestran el campo de seis dígitos y la caducidad de cinco minutos; la prueba también exige teclado numérico. No contienen códigos ni tokens. Fuente: artifact `auth-system-visual` de la ejecución enlazada.

Aceptación de este bloque: contraseña o Google simulado requieren el segundo factor cuando está activo; cinco canjes concurrentes crean una sola sesión; recuperar contraseña conserva MFA; un desafío no permite acceso a datos; los errores no consumen el código si falla la creación de sesión. Esto no cierra P05: faltan inscripción con reautenticación y recuperación MFA, configuración real de proveedores y validación nativa en dispositivos.

### Base de códigos de recuperación (integración pendiente)

La migración 007 incorpora códigos de recuperación con RLS forzada y acceso exclusivo al rol de autenticación dentro del contexto del usuario. Cada lote contiene diez códigos aleatorios de 128 bits. Se devuelve el texto una sola vez al llamador interno; PostgreSQL conserva únicamente hashes SHA-256 vinculados al usuario y fecha de consumo. Rotar el lote elimina los códigos anteriores.

El consumo es una actualización condicional atómica dentro de la transacción del llamador: un rollback conserva el código. No desactiva el autenticador ni emite sesiones por sí mismo. Estas funciones aún no tienen endpoint: antes de exponerlas se integrarán con inscripción y reautenticación reciente, desafío limitado y emisión de sesión en la misma transacción. No se deben activar factores de producción todavía.

Validación local: tipo estricto, lint, build backend y prueba de formato/hash aprobados. Se añade una prueba PostgreSQL de cinco consumos concurrentes, aislamiento A/B, rollback, rotación y denegación al runtime financiero; su resultado queda pendiente de CI. No se considera recuperación de usuario terminada hasta completar y probar el flujo API/UI.

### Canje de recuperación por API

`POST /v1/auth/mfa/recover` recibe challenge/code y exige el mismo desafío primario de cinco minutos que TOTP. Deriva la identidad desde el desafío; no acepta user_id. Comparte límite por IP y los cinco intentos por desafío con `/complete`. El consumo del código y del desafío se confirma junto con la sesión o se revierte entero si la sesión no puede crearse. El factor permanece activo.

La prueba API añadida comprueba rechazo sin desafío, aislamiento A/B, cinco canjes concurrentes con una sola sesión, reutilización, límite de intentos y rollback por límite de sesiones. Tipo estricto, lint y build backend aprobados localmente; esta prueba API requiere CI. La base anterior de almacenamiento aprobó calidad y navegador/PostgreSQL en la ejecución 34179312089. La inscripción y entrega de códigos con reautenticación y la interfaz de recuperación siguen pendientes; P05 no está cerrado.

### Interfaz de recuperación MFA

La pantalla del segundo factor permite alternar entre autenticador y código de recuperación manteniendo el desafío en memoria y borrando el campo al cambiar de opción. El código se introduce oculto, con validación de formato y sin almacenarlo en el navegador. Cancelar el acceso elimina el desafío.

Se añade un E2E con backend/PostgreSQL reales que prepara códigos únicamente desde el fixture de pruebas, entra con uno, cierra sesión y verifica el rechazo del código consumido. Genera capturas desktop y móvil claro/oscuro antes de introducir secretos, incluidas en el artifact visual. Tipo estricto, lint y build web aprobados localmente; el E2E y las nuevas capturas quedan pendientes de ejecución y revisión en CI. La preview pública mantiene el acceso desactivado. La inscripción y entrega de códigos con reautenticación aún deben implementarse antes de activar MFA en producción.

### Activación y recuperación atómicas

`confirmEnrollmentWithRecovery` confirma posesión del autenticador, revoca sesiones/desafíos anteriores y genera los diez códigos de recuperación dentro de la misma transacción. Devuelve los códigos sólo en la respuesta de activación. Un reintento sobre el factor ya activo devuelve rechazo y no regenera ni revela el lote. El método booleano interno utilizado por fixtures delega en esta operación; la futura API utilizará la respuesta completa y exigirá reautenticación reciente.

La prueba PostgreSQL añadida verifica ausencia de códigos tras un intento inválido, cinco confirmaciones concurrentes con una sola respuesta válida, diez hashes persistidos sin texto plano y rechazo de replay. Tipo estricto, lint y compilación backend aprobados localmente; prueba PostgreSQL pendiente de CI. La API de recuperación del commit 730226a aprobó los cuatro jobs en [CI](https://github.com/SrEnderGYT/finanzas-personales/actions/runs/34179457559). Inscripción accesible al usuario y reautenticación siguen pendientes.

### Revisión visual de recuperación

El commit 4032b96 aprobó calidad y las pruebas de navegador/PostgreSQL en [CI](https://github.com/SrEnderGYT/finanzas-personales/actions/runs/34179613172). Las capturas del artifact confirmaron el acceso con recuperación, pero mostraron que la barra fija móvil cubría el botón secundario. Se oculta esa barra mientras se muestra una pantalla de acceso; el enlace de retorno al panel permanece disponible. El E2E exige que la navegación fija esté oculta y regenerará las capturas para revisión. No se publican las capturas anteriores como evidencia de diseño aprobado.

### Evidencia verificada de recuperación

El commit `54b6ecc2fb1a942c8f11491db3020602a0192c31` aprobó todos los jobs de [CI](https://github.com/SrEnderGYT/finanzas-personales/actions/runs/34179835246): calidad, navegador con PostgreSQL, Android APK e iOS simulator sin firma. Incluye activación interna y generación del lote en una transacción, acceso con recuperación y rechazo de reutilización desde navegador.

Capturas revisadas del mismo commit: [desktop](evidence/P05/mfa-recovery-desktop.png), [móvil claro](evidence/P05/mfa-recovery-mobile-light.png) y [móvil oscuro](evidence/P05/mfa-recovery-mobile-dark.png). Los controles se muestran sin superposición y los campos están vacíos; no se incluyen códigos ni tokens. El [APK de desarrollo](https://github.com/SrEnderGYT/finanzas-personales/actions/runs/34179835246/artifacts/10038545756) corresponde al mismo commit. La compilación de iOS es para simulador, no TestFlight.

La recuperación está probada con cuentas sintéticas preparadas por fixtures. Todavía falta inscripción desde una sesión con reautenticación reciente y entrega segura de los códigos al usuario; P05 continúa abierto y la autenticación del preview público permanece desactivada.

### Permisos de reautenticación para inscripción

La migración 008 almacena permisos opacos de cinco minutos mediante hashes, ligados a usuario, sesión y propósito fijo mfa-enroll mediante FK compuesta y RLS. Sólo el rol de autenticación puede acceder. Emitir uno reemplaza el permiso pendiente de esa sesión; consumirlo requiere la misma sesión vigente y se realiza dentro de la transacción de inscripción. Se comprueba vigencia después de adquirir el bloqueo. Revocar o caducar la sesión impide el canje.

Estas funciones son internas: todavía no hay endpoint de emisión. Su llamador deberá verificar de nuevo contraseña o Google antes de emitir el permiso; una sesión abierta no basta. La prueba PostgreSQL cubre cinco consumos concurrentes, sesión ajena, usuario ajeno, sustitución, caducidad, revocación y permisos del runtime. Tipo estricto, lint y compilación se verifican localmente; la integración queda pendiente de CI y del flujo de reautenticación/API/UI. P05 continúa abierto.

### Reautenticación por contraseña

`POST /v1/auth/reauthenticate/password` exige una sesión opaca vigente y recibe sólo password. El usuario y la sesión se obtienen de la autoridad de sesiones, nunca del cuerpo. Se comprueba scrypt de nuevo, con límites persistentes de cinco intentos por usuario y treinta por IP en quince minutos. Bajo bloqueo se vuelve a comprobar que la credencial no cambió y que la sesión sigue vigente antes de emitir el permiso mfa-enroll. No emite otra sesión ni permite usar el permiso para acceder a datos.

La prueba API cubre ausencia/revocación de sesión, contraseña errónea, campos de identidad inyectados, emisión correcta, ausencia de texto plano en DB/logs y rechazo del permiso como token de acceso. Tipo estricto, lint y build backend aprobados localmente; prueba PostgreSQL pendiente de CI. Falta reautenticación Google, conectar el permiso con la inscripción y completar su interfaz. Las cuentas exclusivamente Google no pueden usar este endpoint para crear una contraseña.

### Inscripción por API ligada a sesión

`POST /v1/auth/mfa/enrollment/start` exige sesión vigente y grant de reautenticación. El permiso se consume en la misma transacción que crea o reemplaza la inscripción pendiente. La migración 009 liga esa inscripción a la sesión mediante FK compuesta; sólo esa sesión puede llamar `/enrollment/confirm` con el código TOTP. El servidor vuelve a comprobar vigencia bajo bloqueo. Se conservan límites de intentos del factor y caducidad de diez minutos de la inscripción.

Confirmar activa el factor, genera códigos de recuperación y revoca sesiones anteriores en una transacción; devuelve el lote sólo una vez. La prueba API recorre login, reautenticación, inscripción, rechazo desde otra sesión/replay y confirmación con revocación. Tipo estricto, lint y build backend aprobados localmente; PostgreSQL pendiente de CI. La interfaz de inscripción y la reautenticación Google siguen pendientes, por lo que todavía no se habilita MFA de producción.

### Interfaz de activación con contraseña

Desde la sesión se puede iniciar Activar autenticador, volver a verificar la contraseña, introducir la clave manual en una app TOTP y confirmar su primer código. Al activarlo se muestran diez códigos de recuperación sólo en memoria de la pantalla, con acción explícita Ya guardé mis códigos. Las sesiones anteriores se revocan y el usuario vuelve a entrar con MFA. Los campos se limpian al finalizar cada envío; el secreto y lote no se guardan en storage. La configuración manual está disponible; QR y reautenticación Google siguen pendientes.

El E2E añadido recorre registro/login, reautenticación, inscripción real mediante API, entrega de diez códigos y un nuevo acceso mediante uno de ellos, sin preparar el factor desde fixtures. Genera capturas de la pantalla inicial vacía, sin secretos, para revisión en CI. Tipo estricto y lint aprobados localmente; build y E2E se registrarán tras completar su ejecución. No se habilita autenticación en el preview público.

### Prueba de autenticación reciente con Google

El adaptador puede solicitar auth_time mediante claims y verificar ese campo firmado contra un umbral del servidor. Rechaza ausencia, tipos incorrectos, fechas antiguas y fechas futuras fuera de cinco segundos de tolerancia. iat no sustituye a auth_time: un token recién emitido puede proceder de una sesión antigua. Referencia: [Google OIDC](https://developers.google.com/identity/openid-connect/reference).

Tres pruebas del proveedor pasan, incluida una prueba de tokens firmados con fecha de autenticación caducada/ausente. Esta capacidad aún no está conectada a un flujo público de reautenticación; debe ligarse a la sesión y al subject ya vinculado. No se afirma que Google fuerce una contraseña nueva: si no entrega evidencia reciente suficiente, la operación debe rechazarse. Configuración y pruebas con Google real continúan pendientes.

### Reautenticación Google ligada a sesión

El modo reauthenticate de `/google/start` exige sesión activa, conserva su identidad cifrada en el flujo OIDC y solicita auth_time. Al completar, el proveedor verifica autenticación en los últimos cinco minutos y el servidor exige el subject ya vinculado al usuario original. Sólo entonces emite un permiso de inscripción para aquella sesión, comprobando su vigencia bajo bloqueo. No crea usuarios, vincula identidades ni emite otra sesión en este modo.

La prueba PostgreSQL añadida usa proveedor simulado y comprueba solicitud del dato de fecha, umbral de antigüedad, identidad vinculada, replay, revocación y ausencia de sesión adicional. La comprobación criptográfica de auth_time se cubre por separado con tokens firmados. La interfaz debe conservar la sesión original durante el retorno de Google; esa conexión y la validación con proveedor real están pendientes. El flujo no solicita Gmail.
