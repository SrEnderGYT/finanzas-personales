# P03 · Prototipo de almacenamiento cifrado

Alcance autorizado antes de la puerta de revisión: guardar comandos sintéticos cifrados, bloquear y recuperar en el dispositivo. **No implementa sincronización con servidor, autenticación de usuario ni core financiero.** Un comando pendiente no se presenta como transacción bancaria confirmada.

## Implementación

| Plataforma | Implementación                                                                                                                                                                   | Evidencia y límite                                                                                                       |
| ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Web/PWA    | IndexedDB v1, sobres AES-256-GCM con IV aleatorio, AAD ligada al ID, PBKDF2-SHA256 600.000 iteraciones, salt aleatorio, CryptoKey no exportable                                  | Tests unitarios y navegador real Chromium; frase >=12 caracteres; claves sólo en memoria                                 |
| Android    | SQLite/SQLCipher con comprobación de cifrado, secreto SQL administrado por plugin; sal de dispositivo en SecureStorage/Android Keystore; PIN local + sal derivan clave del sobre | Integración de plugins real en proyecto Gradle; CI debe validar APK del commit; prueba física pendiente                  |
| iOS        | SQLite/SQLCipher, Keychain con acceso whenPasscodeSetThisDeviceOnly, sin sincronización iCloud; PIN local para el sobre cifrado                                                  | Proyecto SwiftPM con plugins y permiso Face ID; build simulador no acredita TestFlight ni prueba física                  |
| Biometría  | Plugin nativo comprueba inscripción fuerte y solicita Face ID/Touch ID/biometría Android; no usa fallback silencioso a credencial del SO                                         | Prototipo de verificación separado; no reemplaza PIN ni afirma que el secreto esté ligado criptográficamente a biometría |

El almacén web no contiene importes/conceptos/PIN/frase en claro. Se conserva metadata mínima (versión, salt, verificador cifrado) e IDs aleatorios. Native exige dispositivo con bloqueo configurado. PIN local 6–12 dígitos, nunca PIN bancario. Si el sistema no confirma SQLite cifrada, se rechazan escrituras; no hay fallback a SQLite plana.

La inserción por ID es atómica (`IndexedDB.add` o PK SQL con ON CONFLICT DO NOTHING). Cinco reintentos idénticos conservan un comando; reutilizar ID con importe diferente devuelve conflicto, sin última escritura gana. Bloqueo vacía la referencia a clave y la vista; salida de pantalla y ocultación de documento bloquean. Las inserciones ya iniciadas sólo escriben ciphertext.

## Cómo probar

1. Abrir Configuración → Probar guardado cifrado, en el preview web o APK DEMO.
2. Crear frase de prueba (web) o PIN local (nativo con bloqueo de dispositivo). No introducir datos reales.
3. Desconectar internet, guardar importe ficticio y comprobar pendientes locales.
4. Cerrar/reabrir, desbloquear y comprobar el registro.
5. Reconectar: el comando permanece pendiente local. La sincronización real corresponde a P09 después de revisar el core.

## Pruebas y aceptación

- Tests contra IndexedDB simulada: persistencia cifrada, cinco reintentos concurrentes, conflicto de importe, bloqueo, reapertura, clave errónea, AAD contra intercambio de IDs y detección de ciphertext alterado.
- E2E con Chromium persistente: modo offline, guardar, cerrar proceso completo del navegador, relanzar perfil offline, desbloquear y recuperar exactamente un registro; reconectar conserva un pendiente. No se simula un servidor para declarar sync terminado.
- Capturas: [guardado offline](evidence/P03/encrypted-offline.png) y [reapertura](evidence/P03/reopened.png).
- Compilaciones nativas y artifacts de CI deben asociarse al commit P03. Un APK P01 sin los plugins no sirve como evidencia de P03.

## Riesgos y trabajo posterior

Es un prototipo para datos sintéticos. El límite de intentos de UI (cinco fallos/30 s) vive en memoria y puede reiniciarse; no es defensa definitiva contra fuerza bruta. Biometría no libera directamente la clave, por lo que no hay afirmación de vinculación hardware/biometría. Falta validar cancelación, cambio de huella/Face ID, restauración, pérdida de clave y comportamiento de fondo en dispositivos físicos.

Sin frase/sal de dispositivo, no hay recuperación de pendientes; borrar almacenamiento puede perder pruebas. RLS, sesiones, recuperación con servidor, rotación y sincronización permanecen fuera de P03. No se han utilizado datos reales. Plugins revisados: sqlite8.1.1, biometric-auth10.0.0, secure-storage8.0.0 (MIT); revisar obligaciones de distribución de SQLCipher antes de publicar binarios definitivos.

**Detenerse para revisión después de entregar preview, capturas, APK y resultados. No comenzar P04 hasta la revisión solicitada por el propietario.**
