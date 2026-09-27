# Qué hace Telepatia Scribe y qué cubre este CLI

Este mapa sale del análisis de la aplicación web (`scribe.telepatia.ai`, build `128c0c0e`, septiembre 2026). Muchas funciones están detrás de *feature flags* por institución (LaunchDarkly), así que **puede que tu cuenta no tenga todas**.

Estado: ✅ cubierto · 🟡 parcial o solo vía `telepatia api` · ❌ no cubierto (y por qué)

## Cuenta y acceso

| Función en Telepatia | CLI |
|---|---|
| Login con email y contraseña, 2FA por código | ✅ `login` |
| Login sin contraseña (código por email o WhatsApp) | ✅ `login --otp` |
| Login por QR / dispositivo, aprobando desde la app móvil | ✅ `login --device` |
| Login con Google | ❌ requiere el SDK de Google en el navegador. Alternativa: `--otp` o `--device` |
| Intercambio de API key institucional | ✅ `login --api-key` (existe en el backend; la web no lo usa) |
| Varias instituciones: elegir y cambiar | ✅ `accounts`, `login --account` |
| Registro, invitaciones, recuperar contraseña | ❌ son flujos de una sola vez; hazlos en la web |

## Consultas (el núcleo)

| Función | CLI |
|---|---|
| Historial de consultas, búsqueda, filtro por estado | ✅ `consultations list` |
| Ver la nota clínica generada | ✅ `consultations show` |
| Transcripción (la web muestra la versión anonimizada) | ✅ `consultations transcript` |
| Exportar | ✅ `consultations export` (Markdown/JSON). La web exporta al EMR o a PDF |
| Crear una consulta subiendo un audio | ✅ `upload` |
| Grabar en vivo desde el micrófono | 🟡 `record` graba localmente y sube al terminar. **No** muestra la transcripción en tiempo real como la web (ver abajo) |
| Teleconsulta (capturar el audio de otra pestaña) | ❌ específico del navegador. Puedes grabar el audio del sistema y usar `upload --telemedicine` |
| Regenerar nota, recuperar consulta atascada, eliminar | ✅ `regenerate`, `recover`, `delete` |
| Documentos generados por consulta | ✅ `consultations documents` |
| Editar secciones de la nota, editar por voz | ❌ requiere un editor. La web lo hace mejor |
| Varias plantillas por consulta, añadir audio a una consulta existente | ❌ por ahora |
| Adjuntar archivos o imágenes a la consulta | 🟡 `api rest POST ai-backend /file-upload/session-files` |
| Sugerencias CIE-10/11, auditoría de calidad, alertas CDSS, protocolos | 🟡 los códigos y advertencias aparecen en `show`; el resto solo vía `api` |
| Educación al paciente (texto "amigable") | 🟡 `api rest POST ai-backend /v1/patient-education/generate` |
| Órdenes médicas y recetas, firma digital, envío por WhatsApp | ❌ implican firma legal y envío a pacientes; conviene hacerlo con la interfaz |
| Compartir la historia con el paciente (PHR por WhatsApp) | ❌ mismo motivo |

## Pacientes, plantillas y más

| Función | CLI |
|---|---|
| Lista, búsqueda, ficha e historial de pacientes | ✅ `patients` |
| Crear paciente | ✅ `patients create` (en lote: receta en la [guía](GUIA.md#crear-pacientes-en-lote-desde-un-csv)) |
| Eliminar paciente | ❌ todavía no; hazlo en la web (la API tiene `softDeleteScribePatient`) |
| Ver plantillas y sus secciones | ✅ `templates` |
| Crear o editar plantillas, generar una plantilla desde archivos | ❌ usa la web (editor visual) |
| Telepatia Intelligence (chat clínico, escalas) | 🟡 escalas vía `api rest GET ai-backend /v1/intelligence/scales?language=es` |
| Dictado de informes (`/dictation`) | ❌ WebSocket de dictado en tiempo real |
| Hospitalización (`/inpatients`), triage, integraciones EMR (Tasy, extensión de Chrome) | ❌ específicas de cada institución |
| Agenda de citas | 🟡 `api graphql` (`appointments`) |

## ¿Por qué `record` no transcribe en vivo?

La web envía el audio por un WebSocket (`wss://…/ai-backend/v1/ws/audio/{sessionId}`) en paquetes Opus con prefijo de longitud, o en PCM16. Según los flags de la institución, a veces van envueltos en msgpack con marcas de tiempo, y el cierre usa un protocolo de confirmación (`stop_ack`). El formato no se declara: el servidor lo detecta. Replicarlo sin documentación oficial es frágil. Si falla a mitad de una consulta real, perderías el audio.

Por eso `record` graba localmente (FLAC 16 kHz mono) y sube con el mismo endpoint que el botón "Subir audio" de la web, que es robusto y admite reintentos. El protocolo está documentado en [API.md](API.md) por si alguien quiere implementar el modo en vivo.

## Qué NO hace el CLI, a propósito

- No evita permisos ni límites: todo pasa por tu sesión y lo que tu institución tenga habilitado.
- No toca endpoints públicos de terceros (validación de documentos, PHR compartido).
- No guarda datos de pacientes en disco salvo que tú lo pidas.
