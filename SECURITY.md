# Arquitectura de seguridad propuesta

Nada de este documento acredita controles ya desplegados. La implementación y sus pruebas son condiciones de beta.

## Fronteras de confianza

Cliente y email son entradas no confiables. La API verifica emisor/audiencia/expiración de identidad, sesión activa y propietario; el trabajador valida origen de Pub/Sub y sólo procesa la conexión asignada. PostgreSQL añade RLS y FK compuestas. Logs, analítica y IA no reciben cuerpos financieros completos. Un repositorio privado protege acceso al código, pero no sustituye autenticación de la aplicación.

## Identidad y sesiones

Google Sign-In o email/contraseña administrados, email verificado antes de sincronizar datos o conectar Gmail. MFA opcional TOTP con códigos de recuperación mediante proveedor compatible; decisión de proveedor pendiente en ADR. Reautenticar para exportación completa, conexión/revocación Gmail y borrado. Nunca fusionar cuentas sólo porque coincida un email no verificado; linking requiere autenticar ambas identidades.

Web: sesión backend en cookie Secure, HttpOnly y SameSite; token CSRF para escrituras, origen permitido y comprobación Origin. Mobile: tokens de sesión en Keychain/Keystore mediante adaptador revisado, rotación y revocación backend. Las claves privadas del servicio y refresh token de Gmail permanecen en backend. No confundir tokens de sesión protegidos con credenciales bancarias, que nunca se solicitan ni guardan.

Pantalla de sesiones permite revocar una o todas; el backend comprueba estado en cada comando sensible. Un dispositivo offline no puede recibir una revocación inmediatamente: conserva acceso local hasta bloqueo/expiración. Propuesta inicial: bloqueo tras 5 minutos de inactividad y renovar autorización online cada 7 días. Política pendiente de revisión; offline expirado conserva outbox cifrada y pide autenticación, sin descartar operaciones. Al reconectar una sesión revocada no sube cambios hasta reautenticación del mismo usuario.

## Protección local

Móvil: base SQLite cifrada con clave aleatoria protegida por almacén seguro del SO; biometría desbloquea esa clave. PIN de la app no es PIN bancario, se deriva con KDF y límites de intentos, nunca se guarda en claro. Cambio de biometría, restauración o clave inválida exige login y recuperación controlada, no omitir cifrado. Elegir plugin y probar licencia/compatibilidad en el primer prototipo.

Web/PWA: IndexedDB con datos sensibles cifrados mediante Web Crypto y clave desbloqueada por frase local del usuario; no guardar clave sin envolver junto al ciphertext. Bloqueo elimina clave en memoria. Un atacante con XSS durante sesión desbloqueada puede acceder a datos: CSP estricta, sin scripts externos innecesarios y renderizado seguro siguen siendo obligatorios. Este diseño no promete cifrado de extremo a extremo: backend debe procesar finanzas y Gmail. La recuperación de datos confirmados usa servidor; pendientes sin sincronizar pueden perderse si el usuario borra almacenamiento o pierde clave, con advertencia previa al borrado.

## Controles por amenaza

| Amenaza | Control requerido | Prueba |
| --- | --- | --- |
| Acceso a otro usuario / IDOR | Identidad verificada, FK compuestas, RLS, URLs de exportación privadas de corta vida | A intenta leer/escribir IDs de B en cada API y sync |
| Inyección y XSS | Esquemas cerrados, consultas parametrizadas, escape de salida, CSP, no HTML de email | Cadenas SQL/HTML en comercio, notas, búsqueda e importación |
| CSRF y robo de sesión | Cookies protegidas, CSRF/origin, rotación, revocación | Solicitud desde origen ajeno, token vencido y logout |
| Abuso | Límites propuestos: login por IP/identidad, escritura por usuario; backoff y cuotas Gmail | 429 sin filtrar existencia de cuenta; recuperación normal |
| Filtración OAuth | Secrets externos cifrados, IAM mínimo, redacción y rotación | Escaneo repo/logs, token revocado, trabajador sin permiso |
| Push indiscreto | Sin importe/comercio en pantalla bloqueada por defecto | Captura de lockscreen en Android/iOS |
| Email malicioso | Nunca ejecutar HTML/enlaces/instrucciones; parser estructurado, límites de tamaño | Payload con prompt injection, enlaces y adjuntos malformados |
| Dependencia comprometida | Lockfile, auditoría, CI con permisos mínimos, revisión de plugins | Build reproducible y hallazgos resueltos antes de release |

HTTPS obligatorio, cifrado administrado en reposo para DB/backups, cuentas de servicio separadas API/trabajador/migrador. No claves en repositorio, archivos de usuario o bundles. CI despliega con identidad federada cuando sea posible. Logs operativos: request ID, códigos de error, tiempos y contadores; no email completo, tokens, cuerpos, notas o importes completos. Auditoría registra actor, acción, entidad y campos modificados, no copia financiera completa.

## Retención y control del usuario

Propuesta pendiente de aprobación: cuerpos Gmail sólo en memoria durante parser, sin persistencia; candidato normalizado rechazado se purga a los 30 días, con excepción de marcador mínimo de dedupe mientras conector siga activo. Auditoría mínima 180 días; backups cifrados 30 días; finanzas mientras la cuenta exista. Estas son decisiones de producto propuestas, no afirmaciones de obligación legal.

Exportación autenticada; borrado con reautenticación, desconexión de Gmail, cancelación de jobs/push y purga activa en 30 días como objetivo. Backups caducan por su retención; restauración debe reaplicar solicitudes de borrado desde registro separado de supresiones. Permitir revocar integración sin borrar movimientos ya aceptados, con elección explícita de eliminación posterior. Publicar política de privacidad y mecanismo de contacto antes de beta externa.

## Reportar una vulnerabilidad

No publicar datos reales ni secretos en issues. Reportar al propietario por un canal privado acordado. No se ha configurado un servicio de recepción de vulnerabilidades. Un hallazgo crítico bloquea promoción a la siguiente fase hasta corrección y prueba de regresión.
