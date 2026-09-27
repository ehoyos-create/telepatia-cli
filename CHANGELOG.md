# Cambios

Formato basado en [Keep a Changelog](https://keepachangelog.com/es-ES/1.1.0/). El proyecto usa [versionado semántico](https://semver.org/lang/es/).

## [Sin publicar]

### Corregido

- La "última consulta" de un paciente ahora usa `lastSession` cuando el servidor devuelve `lastConsultation` vacío.
- Los teléfonos ya no muestran el prefijo `+` duplicado.

## [0.1.0] — 2026-09-27

Primera versión pública.

### Agregado

- **Menú interactivo** (`telepatia` sin argumentos): pantalla de inicio con el isotipo y los colores de Telepatia; navegación con teclado por consultas, nueva consulta, pacientes, plantillas y cuenta.
- **Login**: email y contraseña (con 2FA y selección de institución), código por email o WhatsApp (`--otp`), aprobación desde la app móvil (`--device`) y API key institucional (`--api-key`). Refresco automático de la sesión.
- **Consultas**: listar, buscar, filtrar por estado y paginar; ver la nota clínica en Markdown con códigos CIE y advertencias de la IA; ver la transcripción; exportar a Markdown o JSON; regenerar, destrabar y eliminar consultas.
- **Nueva consulta**: `upload` para audios (wav, flac, ogg, opus, aiff; otros formatos se convierten con ffmpeg) y `record` para grabar desde el micrófono.
- **Pacientes** (listar, buscar, ficha, historial, crear) y **plantillas** (listar y ver secciones).
- `api graphql` / `api rest` para acceso directo a la API.
- Documentación: guía completa, cobertura de funciones, referencia de la API, CONTRIBUTING y SECURITY.
