# Cambios

Formato basado en [Keep a Changelog](https://keepachangelog.com/es-ES/1.1.0/). El proyecto usa [versionado semántico](https://semver.org/lang/es/).

## [0.1.2] — 2026-09-27

### Corregido

- `patients list` (y la pantalla Pacientes del menú) mostraba solo los pacientes con consultas, porque ordenaba por última visita. Ahora usa el orden del servidor, igual que la web, y muestra todos.
- `patients create --country` acepta el código de país (`CO`) o el nombre (`COLOMBIA`) y lo convierte al valor que exige la API. Antes, `--country CO` fallaba.

### Cambiado

- `patients list --sort` ahora acepta `name` o `recent`. `fullName` y `lastVisit` siguen funcionando.

## [0.1.1] — 2026-09-27

### Agregado

- **Modo agente** (AI-first): con `CLAUDECODE` (Claude Code), `TELEPATIA_AGENT=1`, `TELEPATIA_OUTPUT=json`, o sin terminal en stdin ni stdout, los datos salen en JSON compacto sin campos vacíos, los errores son JSON en stderr con `code` y `hint`, y los códigos de salida son estables (2 uso, 3 sesión, 4 no encontrado, 5 timeout, 6 API, 7 falta input). Opciones globales `--json`, `--human`, `--fields` y `--quiet`.
- `telepatia mcp`: servidor MCP por stdio con 14 herramientas (consultas, notas, transcripciones, pacientes, plantillas y crear consultas desde un audio).
- `telepatia skill install`: instala una skill de Claude Code con el flujo de uso del CLI.
- `telepatia schema`: todos los comandos, argumentos, opciones y códigos de salida en JSON.
- Login no interactivo en dos pasos: `login --otp` → `login --code`, `login --device` → `login --wait`, y `login --account` para elegir institución. También `--password-stdin`.
- `record --duration`, y timeouts como `90s`, `5m` o `1h` en `wait` y `upload`.

### Cambiado

- En modo agente, `upload` y `record` devuelven el id sin esperar a la nota; `--wait` fuerza la espera.
- Los comandos de acción (`delete`, `regenerate`, `recover`, `wait`, `export`, `logout`, `accounts switch`) imprimen un resultado JSON con `next` en modo agente.
- Sin terminal en stdin, `delete` exige `--yes` en vez de fallar al intentar preguntar.
- La opción `--json` ahora es global.

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
