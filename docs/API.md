# Cómo funciona la API de Telepatia Scribe (por dentro)

Esta es una referencia técnica **no oficial**, reconstruida a partir de la aplicación web (`scribe.telepatia.ai`, build `128c0c0e`, septiembre de 2026). Puede cambiar en cualquier momento. Las rutas relativas usan como base las URLs de la tabla siguiente.

## Servicios

| Servicio | URL | Para qué |
|---|---|---|
| authcentral | `https://private.telepatia.ai/authcentral` | Login, tokens y cuentas |
| datalayer | `https://private.telepatia.ai/datalayer/graphql` (+ `wss://` para suscripciones) | GraphQL: consultas, pacientes, plantillas, documentos |
| ai-backend | `https://private.telepatia.ai/ai-backend` | Crear sesiones, subir audio, generar notas, IA clínica |
| scribe-bff | `https://private.telepatia.ai/scribe-bff` | Firmas, envío por WhatsApp, PDFs, PHR compartido |
| emr-data-sync | `https://private.telepatia.ai/emr-data-sync` | Contexto de consultas de EMR externos |

Todas las peticiones autenticadas usan `Authorization: Bearer <accessToken>`. **No se envía ningún header de institución**: la cuenta activa va dentro del JWT (claims `uid`, `accountId`, `institutionalId`, `roles`, `email`, `exp`).

## Autenticación (authcentral)

Todos los endpoints son `POST` con cuerpo JSON.

| Ruta | Cuerpo | Notas |
|---|---|---|
| `/login` | `{email, password}` | Devuelve un `LoginResult` |
| `/2fa/verify` · `/2fa/resend` | `{challengeToken, code}` · `{challengeToken}` | Código de 6 dígitos |
| `/passwordless/start` | `{identifier, channel: auto\|email\|whatsapp, purpose: "login"}` | → `{challengeToken, channel, hint}` |
| `/passwordless/verify` · `/passwordless/resend` | `{challengeToken, code}` | |
| `/account/select` | `{preAuthToken, accountId}` | Cuando `requiresInstitutionSelection` es true |
| `/account/switch` (Bearer) | `{accountId}` | Emite un JWT nuevo para la otra cuenta |
| `/account/available` (Bearer) | `{}` | `{accounts[]}` |
| `/device-auth/start` | `{}` | `{device_code, user_code, expires_in, interval}` |
| `/device-auth/token` | `{device_code}` | 202 = pendiente, 429 = `slow_down`, 410 = expirado, 200 = tokens |
| `/apikey/exchange` (Bearer = API key) | `{}` | `LoginResult` |
| `/token/refresh` | `{refresh_token}` | Rota ambos tokens |
| `/token/derive` | `{refresh_token, client}` | Crea una cadena de tokens independiente por cliente (`scribe-web`, `chrome-extension`) |
| `/token/validate` | `{token}` | `{valid}` |
| `/logout` | `{refresh_token}` | |

`LoginResult` puede traer una de tres cosas:

- `mfaChallenge`: hay que pedir el código de 2FA.
- `requiresInstitutionSelection` con `preAuthToken` y `accounts[]`: hay que elegir cuenta.
- `token`: `{accessToken, refreshToken, expiresAt, payload}`, el login terminó.

La web refresca el token 5 minutos antes de que expire, y trata el refresh token como válido durante unos 7 días.

## GraphQL (datalayer)

Las operaciones que usa el CLI están en [`src/api/queries.ts`](../src/api/queries.ts). Las principales:

- `scribeSessions(filter: {accountId, status[], limit, offset, orderBy, orderDirection, query})`: lista de consultas.
- `scribeSession(id)`: una consulta completa. `medicalRecordMutable` es la nota (JSON por sección) y `medicalRecordOrder` su orden. También trae `transcript`, `effectiveDiagnosisCodes` y `hallucinationWarnings`.
- `updateScribeSession(id, input, updateMode: merge)`: la web elimina una consulta con `input: {status: "deleted"}`.
- `medicalRecordDocuments(filter: {scribeSessionId})`: documentos generados.
- `getPatients`, `searchScribePatients`, `scribePatient`, `timelineByPatient`, `updateOrCreateScribePatient`.
- `scribeSessionConfigurations(filter: {accountIds})` y `scribeSessionConfiguration(id)`: plantillas y sus `nodes` (secciones, con títulos e instrucciones por idioma).
- Suscripciones (`graphql-ws`): `sessionUpdated(sessionId)`, `sessionsUpdated(accountId)`, `medicalRecordDocumentUpdated`.

En total la web usa unas 108 operaciones. También cubren agenda (`appointments`), dictado (`medicalRecordConfigurations`, `reportEvents`), hospitalización (`encounters`), memorias del usuario, auditoría, órdenes médicas y el chat "Intelligence".

### Pacientes: detalles de la API

Comprobado contra el servidor en septiembre de 2026:

- **`lastConsultation` suele venir en `null`**, aunque el paciente tenga consultas. La fecha real está en `lastSession { id createdAt }`, que el CLI usa como respaldo.
- **`getPatients` con `orderBy: "lastVisit"` solo devuelve pacientes con consultas**, y `totalCount` también los excluye. Sin `orderBy`, devuelve todos.
- **`identifications[].country` es el enum `CountryName`** (`COLOMBIA`, `BRAZIL`, `COSTA_RICA`…), no el código ISO. Mandar `"CO"` da error 400.
- **`phoneNumbers[].countryCode` ya incluye el `+`** (`"+57"`).
- **`updateOrCreateScribePatient` es un upsert** por identificación: con el mismo documento devuelve el mismo `id` y no duplica.
- **`softDeleteScribePatient(id: ID!): ScribePatient!`** existe (borrado lógico). El CLI no lo usa y no está probado.
- **`timelineByPatient` recibe `{patientDocumentId, limit, descending}`**, no `patientId`.
- **La introspección está desactivada** (`__schema` y `__type` dan 400). Para descubrir campos sirven los mensajes de error del servidor, que sugieren nombres parecidos ("Did you mean…").

### Otros detalles comprobados

- **`scribeSession.transcript` suele venir en `null`.** La transcripción se obtiene con `GET /download-session-files/anonymized/{id}/transcript` (ai-backend), que la devuelve **anonimizada**. Es la única versión que muestra la web.
- **Cada sección de la nota trae `{title, type, status, content}`.** El `title` ya viene traducido. Una sección vacía llega con `content: ""` o con sub-campos vacíos.
- **Errores**: los de validación de GraphQL llegan con HTTP 400 y `{errors: [{message}]}`. Los de ejecución (por ejemplo "Scribe patient not found") llegan con HTTP 200 y `errors` en el cuerpo.
- **Validar sin efectos**: como no hay introspección, para comprobar un tipo o un enum sin ejecutar una mutación (por ejemplo, sin crear un paciente) se envía con otro campo inválido a propósito. El servidor la rechaza en la validación y reporta todos los errores de tipos.

### Forma de la nota (`medicalRecordMutable`)

Es un objeto con una clave por sección (`chiefComplaint`, `historyOfPresentIllness`, `assessmentPlan`…). Cada valor puede ser:

- un texto
- `{content: string, status}`
- estructurado: `{content: {data: {campo: {title, content}}, order?}}`
- análisis y plan: `{assessment, plan: {content: [{content, severity?, …}]}}`
- escalas: `{content: {data: {scales, variables}}}`

Los títulos salen de los `nodes` de la plantilla. Ver [`src/note.ts`](../src/note.ts).

## Crear una consulta (ai-backend)

1. **El cliente genera el `sessionId`** (UUID) y llama a `POST /audio/sessions`:
   ```json
   { "sessionId": "<uuid>", "threadDocumentId": "<uuid>", "configurationDocumentId": "<id plantilla>",
     "scribePatientDocumentId": "<id paciente, opcional>", "config": { "sampleRate": 16000 },
     "metadata": { "appPlatform": "web", "appVersion": "…" }, "isTelemedicine": false }
   ```
   Un 409 significa que la sesión ya existe y cuenta como éxito.
2. Para subir un archivo: `POST /audio/sessions/{id}/process-audio`, multipart con el campo `audio_file`. Acepta wav, flac, ogg, opus y aiff, de 1 KB a 100 MB, y responde `{totalSegments}`.
3. El estado se sigue por GraphQL (`scribeSession.status` o la suscripción `sessionUpdated`). Estados terminales: `completed`, `completedWithErrors`, `reviewed`, `error`, `cancelled`, `deleted`.

Otros endpoints útiles:

| Ruta | Para qué |
|---|---|
| `POST /audio/sessions/{id}/cancel` `{supportsCancelledStatus: true}` | Cancelar |
| `POST /audio/sessions/{id}/resolve` `{forceEmr, reprocessAll, origin}` | Finalizar una sesión atascada |
| `POST /v1/scribe/generate-emr` `{sessionId, origin: "scribe", templateId?}` | Regenerar la nota |
| `GET /download-session-files/anonymized/{id}/transcript` | Transcripción anonimizada |
| `POST /v1/reference-codes/icd/search` `{query, language, limit}` | Buscar códigos CIE |
| `POST /v1/patient-education/generate` `{sections: [{id, title, text}], language?}` | Educación al paciente |
| `GET /v1/intelligence/scales?language=es` | Escalas clínicas |
| `POST /file-upload/session-files` `{sessionDocumentId, files: [{filename, data(base64)}]}` | Adjuntos |

## Grabación en vivo (WebSocket), sin implementar en el CLI

URL: `wss://private.telepatia.ai/ai-backend/v1/ws/audio/{sessionId}?token=<jwt>`. Cuando la institución tiene activo el flag `use-ws-subprotocol-auth`, el token no va en la URL sino como subprotocolo `telepatia-bearer.<jwt>`.

**Audio que envía el cliente** (frames binarios, 16 kHz mono):

- Por defecto, Opus: paquetes con un prefijo `uint16 LE` de longitud, 50 paquetes (unos 1 s) por mensaje.
- Si no hay Opus, PCM16 LE: 1 s por mensaje (32 000 bytes).
- Con los flags de recuperación activos, cada mensaje va envuelto en msgpack: `{ts: uint64, audio: bin}`.

**Mensajes del cliente al servidor**: `{"type":"ping"}`, `{"type":"stop_recording","data":{...}}`, `stop_pressed`, `append_discard`.

**Mensajes del servidor al cliente**:

- `ready`: el socket está listo; hay que esperarlo antes de enviar audio.
- `transcript {text, is_final, segment_index}`
- `correction`
- `scribe_section_completed`
- `scribe_completed {status}`
- `stop_ack`
- `warning` / `error`
- `reconnect {reason}`
- `pong`

No existe un mensaje de "pausa": para pausar, el cliente simplemente deja de enviar audio.

## Lo que hay en scribe-bff

Todo esto está orientado a la interfaz y requiere confirmaciones humanas, por eso el CLI no lo cubre:

- firma digital de órdenes médicas (`/v1/signatures*`)
- envío por WhatsApp (`/v1/medical-orders/{id}/send-whatsapp`)
- PDFs (`/v1/documents/render`)
- PHR compartido con el paciente (`/v1/phr/shares`)
- subida de documentos desde el celular por QR (`/v1/consultation-uploads`)
