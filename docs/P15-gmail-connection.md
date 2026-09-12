# P15 — conexión Gmail consciente

Estado: capa funcional de producto preparada sobre P11. No se declara Gmail conectado ni correos leídos hasta que el backend implemente el contrato, se configure Google Cloud y el propietario complete el consentimiento real.

## Objetivo observable

En el espacio privado aparece una sección **Gmail** separada del login de Google. El usuario puede conocer el estado real de la conexión, seleccionar el rango inicial, abrir el consentimiento de Google, solicitar sincronización y desconectar. El preview DEMO nunca inicia OAuth.

El permiso solicitado por este producto es exclusivamente:

`https://www.googleapis.com/auth/gmail.readonly`

Ese scope permite lectura del buzón autorizado. El selector de rango limita lo que Finanzas debe procesar, pero no reduce técnicamente el alcance OAuth mostrado por Google. No se pide contraseña Gmail y el refresh token nunca debe llegar al navegador.

## Contrato HTTP que debe publicar el backend

Todos los endpoints requieren una sesión P05 válida. Las respuestas usan `Cache-Control: no-store` y nunca incluyen access token, refresh token, authorization code ni cuerpo de correo.

### `GET /v1/gmail/connection`

Respuesta cerrada:

```json
{
  "state": "disconnected",
  "scope": "https://www.googleapis.com/auth/gmail.readonly",
  "rangeDays": 30
}
```

Para una conexión activa:

```json
{
  "state": "connected",
  "email": "usuario@example.com",
  "scope": "https://www.googleapis.com/auth/gmail.readonly",
  "rangeDays": 30,
  "lastSyncAt": "2026-09-12T02:00:00.000Z",
  "coverageFrom": "2026-08-13",
  "coverageTo": "2026-09-11"
}
```

Estados aceptados: `disconnected`, `connected`, `reauthorization_required`. El cliente rechaza campos adicionales para evitar que secretos lleguen accidentalmente a la UI.

### `POST /v1/gmail/oauth/start`

Entrada:

```json
{ "rangeDays": 30 }
```

`rangeDays` debe ser entero entre 1 y 365. El servidor crea un flujo OAuth ligado al usuario y devuelve únicamente:

```json
{
  "authorizationUrl": "https://accounts.google.com/o/oauth2/v2/auth?..."
}
```

La UI valida host, ruta y presencia de `gmail.readonly` antes de navegar. El backend mantiene `state`, PKCE cuando corresponda, callback exacto y cualquier secreto del flujo.

### Callback OAuth

El callback pertenece al backend, no a Angular. Debe validar estado de un solo uso, sesión/usuario, redirect URI exacta y cuenta autorizada. Al finalizar puede redirigir de forma limpia a `/#/gmail`. No debe colocar token, code, email financiero ni errores sensibles en query/hash.

El refresh token queda cifrado exclusivamente en backend. Si Google no devuelve refresh token en una reconexión válida, el servidor debe conservar de forma segura el existente en lugar de sustituirlo por vacío.

### `POST /v1/gmail/sync`

Solicita una sincronización para la conexión vigente. Puede responder aceptación sin incluir mensajes. La UI vuelve a consultar `GET /v1/gmail/connection` para mostrar última sincronización y cobertura.

P15 no convierte mensajes a movimientos: esa responsabilidad empieza en P16/P17. Por tanto este endpoint puede limitarse inicialmente a validar la conexión y preparar/ejecutar la lectura controlada necesaria para acreditar OAuth, sin registrar gastos automáticamente.

### `DELETE /v1/gmail/connection`

Revoca/desactiva la conexión para el usuario autenticado, invalida el refresh token cuando sea posible y cancela nuevas tareas. Devuelve `204` sin secretos. Los movimientos ya aceptados en el ledger no se borran por desconectar Gmail.

## Comportamiento de la UI ya preparado

- Preview público: explica que Gmail real solo está disponible en entorno privado.
- Sin sesión: solicita iniciar sesión antes de conectar correo.
- Backend Gmail ausente (`404`/`503`): muestra que la interfaz está preparada, sin simular una conexión.
- Conectado: muestra email autorizado, solo lectura, rango, cobertura y última sincronización.
- Revocación: confirmación explícita antes de desconectar.
- `401`: obliga a volver a iniciar sesión.
- Ningún secreto se persiste en localStorage/IndexedDB por esta capa.

## Configuración externa pendiente para Astra/propietario

Astra puede completar la capa de infraestructura sin rediseñar la UI:

1. Proyecto Google Cloud y Gmail API habilitada.
2. Pantalla de consentimiento OAuth con la información real del proyecto.
3. Cliente OAuth Web y redirect URI HTTPS exacta del staging.
4. Configuración segura del client id/client secret en el servidor.
5. Almacenamiento cifrado del refresh token y aislamiento por usuario.
6. Implementación de los cuatro endpoints anteriores y callback.
7. Revocación, `invalid_grant`, 429/5xx y auditoría sin contenido de mensajes.
8. Validación manual con una cuenta Gmail autorizada por el propietario.

`gmail.readonly` es un scope restringido de Google. Antes de una beta externa deben revisarse los requisitos vigentes de verificación y, cuando corresponda, evaluación de seguridad. El repositorio no debe asumir que una prueba personal elimina esos requisitos.

## Evidencia necesaria para declarar P15 completo

- Login Google por sí solo **no** muestra Gmail conectado.
- Pulsar `Conectar Gmail` abre un consentimiento Google real con `gmail.readonly`.
- Rechazar el consentimiento conserva el uso manual.
- Aceptar vuelve a `/gmail` y `GET /v1/gmail/connection` refleja la cuenta correcta.
- Refrescar navegador no expone tokens y mantiene el estado desde backend.
- `Desconectar Gmail` impide nuevas lecturas.
- Token revocado externamente produce `reauthorization_required` o estado equivalente seguro, sin bucle.
- Ningún log, fixture, screenshot público o respuesta cliente contiene refresh token o cuerpo real de correo.

## Fuera de P15

P15 no implementa parser BCP, dedupe financiero, Gmail Watch/PubSub ni inserción automática de movimientos. Esos bloques permanecen P16/P17. Tampoco modifica Render, migraciones, RLS, bootstrap/runtime ni la infraestructura P10 desde esta rama.
