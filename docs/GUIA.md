# Guía completa de telepatia-cli

Este documento explica todo lo que hace el CLI: cómo instalarlo, cómo iniciar sesión, cada comando con sus opciones y ejemplos, flujos de trabajo típicos, automatización, seguridad, solución de problemas y cómo funciona por dentro.

> **Aviso.** `telepatia-cli` es un proyecto comunitario, **no oficial y sin afiliación con Telepatia**. Usa las mismas APIs privadas que la aplicación web [scribe.telepatia.ai](https://scribe.telepatia.ai), con tu cuenta y tus permisos. Esas APIs pueden cambiar sin aviso. Eres responsable de usarlo conforme a los términos de servicio de Telepatia y a la normativa de protección de datos de salud que te aplique.

---

## Índice

1. [¿Qué es y para qué sirve?](#1-qué-es-y-para-qué-sirve)
2. [Requisitos e instalación](#2-requisitos-e-instalación)
3. [Conceptos básicos](#3-conceptos-básicos)
   - [El menú interactivo](#el-menú-interactivo)
4. [Iniciar sesión](#4-iniciar-sesión)
5. [Referencia de comandos](#5-referencia-de-comandos)
   - [Autenticación y cuentas](#51-autenticación-y-cuentas)
   - [Consultas](#52-consultas)
   - [Crear consultas: upload y record](#53-crear-consultas-upload-y-record)
   - [Pacientes](#54-pacientes)
   - [Plantillas](#55-plantillas)
   - [Acceso directo a la API](#56-acceso-directo-a-la-api)
6. [Flujos de trabajo y recetas](#6-flujos-de-trabajo-y-recetas)
7. [Salida, scripting y códigos de salida](#7-salida-scripting-y-códigos-de-salida)
8. [Variables de entorno](#8-variables-de-entorno)
9. [Seguridad y privacidad](#9-seguridad-y-privacidad)
10. [Solución de problemas](#10-solución-de-problemas)
11. [Limitaciones conocidas](#11-limitaciones-conocidas)
12. [Preguntas frecuentes](#12-preguntas-frecuentes)
13. [Cómo funciona por dentro](#13-cómo-funciona-por-dentro)

---

## 1. ¿Qué es y para qué sirve?

[Telepatia Scribe](https://scribe.telepatia.ai) es un escriba médico con IA: escucha la consulta, la transcribe y redacta la nota clínica según una plantilla. `telepatia-cli` te deja hacer lo principal desde la terminal:

| Quieres… | Comando |
|---|---|
| Usarlo todo desde un menú, sin memorizar comandos | `telepatia` |
| Ver tus consultas recientes o buscar una | `telepatia consultations` |
| Leer la nota clínica de una consulta | `telepatia c show <id>` |
| Obtener la transcripción | `telepatia c transcript <id>` |
| Exportar notas a Markdown o JSON (copias, análisis, tu propio EMR) | `telepatia c export …` |
| Generar una nota a partir de un audio que ya grabaste | `telepatia upload audio.m4a` |
| Grabar una consulta desde el micrófono del computador | `telepatia record` |
| Buscar pacientes, ver su ficha e historial, crear pacientes | `telepatia patients …` |
| Ver tus plantillas y qué secciones generan | `telepatia templates …` |
| Regenerar una nota o destrabar una consulta atascada | `telepatia c regenerate` / `c recover` |
| Automatizar todo lo anterior en scripts | `--json`, variables de entorno |
| Llamar funciones de Telepatia que el CLI aún no envuelve | `telepatia api graphql` / `api rest` |

**Para qué no sirve**: no reemplaza la aplicación web para editar notas, firmar órdenes médicas, enviar documentos a pacientes ni configurar plantillas. En [COBERTURA.md](COBERTURA.md) está el mapa completo de qué cubre y qué no.

---

## 2. Requisitos e instalación

### Requisitos

- **Node.js 20 o superior**. Compruébalo con `node -v` y descárgalo en [nodejs.org](https://nodejs.org).
- **Una cuenta de Telepatia Scribe** activa.
- **ffmpeg** (opcional). Lo necesitas para dos cosas:
  - convertir audios en formatos que Telepatia no acepta directamente (mp3, m4a, mp4, webm…);
  - grabar con `telepatia record`.

| Sistema | Instalar ffmpeg |
|---|---|
| macOS | `brew install ffmpeg` |
| Ubuntu/Debian | `sudo apt install ffmpeg` |
| Windows | `winget install ffmpeg` o `choco install ffmpeg` |

### Instalación desde el código fuente

```sh
git clone https://github.com/ehoyos-create/telepatia-cli.git
cd telepatia-cli
npm install
npm run build
npm link          # deja disponible el comando `telepatia` en tu sistema
```

Comprueba que quedó instalado:

```sh
telepatia --version
telepatia --help
```

Si no quieres usar `npm link`, ejecuta el CLI directamente con `node dist/index.js <comando>`.

### Actualizar

```sh
git pull && npm install && npm run build
```

### Desinstalar

```sh
telepatia logout        # revoca la sesión y borra tus credenciales locales
npm unlink -g telepatia-cli
```

---

## 3. Conceptos básicos

| Concepto | Qué es |
|---|---|
| **Cuenta / institución** | Tu usuario pertenece a una o más instituciones (clínicas, hospitales, o tu cuenta personal). Cada combinación usuario + institución es una *cuenta* con su propio `accountId`. Todo lo que ves (consultas, pacientes, plantillas) depende de la cuenta activa. |
| **Consulta** (sesión) | Cada encuentro grabado. Tiene un `id`, un estado, una transcripción y una nota clínica. En la API se llama `scribeSession`. |
| **Estado de la consulta** | `recording` (grabando) → `stopped` / `allChunksReceived` → `processing` → `completed`. Otros posibles: `completedWithErrors`, `reviewed`, `error`, `cancelled`, `deleted`. |
| **Plantilla** | Define qué secciones tiene la nota (motivo de consulta, examen físico, análisis y plan…) y con qué instrucciones las redacta la IA. Hay que elegir una al crear una consulta. |
| **Nota clínica** | El resultado estructurado por secciones. El CLI la muestra como Markdown. |
| **Transcripción** | El texto de lo que se habló. |
| **Paciente** | Registro con nombre e identificación. Una consulta puede o no estar asociada a un paciente. |

Los identificadores (`id`) son cadenas largas. Los ves en la primera columna de cada listado y en la salida `--json`.

---

### El menú interactivo

La forma más fácil de usar el CLI es ejecutar `telepatia` **sin argumentos** (o `telepatia menu`). Se abre una pantalla de inicio con el logo y los colores de Telepatia, y un menú que se maneja con el teclado:

```text
  █████████▄▄▄    ▄▄▄█████████
  █████████████▄▄█████████████
           ▀▀██████▀▀
            ▄██████▄               ████████ ███████ ██      ███████ ██████   █████  ████████ ██  █████
           ████▀▀████                 ██    ██      ██      ██      ██   ██ ██   ██    ██    ██ ██   ██
           ███▀  ▀███                 ██    █████   ██      █████   ██████  ███████    ██    ██ ███████
          ████    ████                ██    ██      ██      ██      ██      ██   ██    ██    ██ ██   ██
          ████    ████                ██    ███████ ███████ ███████ ██      ██   ██    ██    ██ ██   ██
          ████    ████
          ████    ████             Scribe · tu consulta, desde la terminal
          ████    ████             v0.1.2 · proyecto comunitario, no oficial
          ████    ████
           ▀▀▀    ▀▀▀              ● medico@ejemplo.com · Clínica Ejemplo

┌  ▀█▀ telepatia › inicio
│
◆  ¿Qué quieres hacer?
│  ● Nueva consulta (grabar o subir audio)
│  ○ Mis consultas
│  ○ Buscar consulta
│  ○ Pacientes
│  ○ Plantillas
│  ○ Mi cuenta
│  ○ Salir
└
```

| Tecla | Acción |
|---|---|
| ↑ ↓ | Moverse entre opciones |
| Enter | Elegir |
| Esc o Ctrl+C | Volver atrás (en el menú principal: salir) |
| Escribir | En campos de texto (búsquedas, rutas, códigos) |

**Qué hay en cada opción:**

| Opción | Qué puedes hacer |
|---|---|
| **Nueva consulta** | **Grabar ahora** con el micrófono (Enter para terminar) o **subir un audio** que ya tengas; puedes arrastrar el archivo a la terminal. Luego eliges la plantilla y el paciente: buscar uno existente, crear uno nuevo o dejarla sin paciente. El CLI sube el audio, espera la nota y la muestra. |
| **Mis consultas** | Lista paginada (15 por página) con paciente, fecha, estado y plantilla. Al abrir una consulta puedes: ver la nota, ver la transcripción, **copiar la nota al portapapeles**, guardarla como archivo Markdown, regenerarla, destrabarla si quedó procesando o eliminarla (con confirmación). |
| **Buscar consulta** | Igual que "Mis consultas", filtrando por texto (por ejemplo el nombre del paciente). |
| **Pacientes** | Buscar por nombre o documento, o ver todos tus pacientes. Muestra la ficha (documento, teléfono, email) y el historial de consultas; puedes abrir cualquiera de ellas. |
| **Plantillas** | Ver tus plantillas y, para cada una, sus secciones con las instrucciones que sigue la IA. |
| **Mi cuenta** | Ver con qué email e institución estás conectado, cambiar de institución o cerrar sesión. |

Si no has iniciado sesión, el menú empieza pidiéndote entrar: con email y contraseña, con un código por email o WhatsApp, o aprobando desde la app móvil. Si tu sesión expira mientras lo usas, te vuelve a pedir el login sin cerrarse.

**Diseño.** La pantalla de inicio muestra el logo de Telepatia junto al nombre. Se adapta al ancho de la terminal: con 105 columnas o más van lado a lado; en ventanas medianas, el logo va encima del nombre; en ventanas angostas, solo el logo con el nombre en texto.

**Colores.** El menú usa la paleta de Telepatia (el verde Telepatia `#076F42` y su escala, crema y tonos oliva), tomada de su sistema de diseño público. En terminales con color de 24 bits (iTerm2, Warp, Ghostty, VS Code, Windows Terminal, la Terminal de macOS reciente) se ve con degradados; en terminales más básicas usa colores aproximados. Para desactivar los colores, define `NO_COLOR=1`.

**Cuándo usar comandos en vez del menú.** Para scripts, automatizaciones y para redirigir la salida (`> nota.md`, `| jq`), usa los comandos de la [sección 5](#5-referencia-de-comandos). El menú solo se abre cuando ejecutas `telepatia` sin argumentos en una terminal interactiva.

---

## 4. Iniciar sesión

El CLI tiene cuatro formas de iniciar sesión. Todas terminan igual: quedan guardados un *access token* (dura poco) y un *refresh token* (unos 7 días), y el CLI renueva el access token solo cuando hace falta.

### 4.1 Email y contraseña (por defecto)

```sh
telepatia login
# Email: medico@ejemplo.com
# Contraseña: ********        (no se muestra al escribir)
```

- Si tu cuenta tiene **verificación en dos pasos**, te pedirá el código de 6 dígitos que llega a tu correo.
- Si perteneces a **varias instituciones**, te mostrará una lista numerada para que elijas. Para evitar la pregunta, usa `--account <accountId>`.

También puedes pasar el email directamente: `telepatia login medico@ejemplo.com`.

### 4.2 Sin contraseña (código por email o WhatsApp)

```sh
telepatia login --otp
telepatia login --otp --channel whatsapp
```

Recibes un código y lo escribes en la terminal. Si no te llega, escribe `r` para que te lo reenvíen. Tienes 5 intentos. El canal WhatsApp solo funciona si tu cuenta lo tiene habilitado.

### 4.3 Aprobar desde la app móvil (flujo de dispositivo)

```sh
telepatia login --device
#   Código: ABCD-1234
#   Aprueba el inicio de sesión desde la app móvil de Telepatia Scribe.
```

El CLI espera hasta que apruebes el inicio de sesión en la app del celular o hasta que el código expire. Es útil en servidores o equipos compartidos, porque no escribes la contraseña en ellos. Depende de que Telepatia lo tenga habilitado para tu cuenta.

### 4.4 API key institucional

```sh
telepatia login --api-key <clave>
# o bien
TELEPATIA_API_KEY=<clave> telepatia login
```

Solo sirve si tu institución te dio una API key. El backend de Telepatia tiene este mecanismo, pero la aplicación web no lo usa, así que puede que no esté disponible para todos.

### 4.5 Sin prompts, para scripts

```sh
TELEPATIA_EMAIL=medico@ejemplo.com TELEPATIA_PASSWORD='…' telepatia login
```

Si tu cuenta tiene 2FA, igual te pedirá el código. Para usos puntuales puedes saltarte el login por completo con un access token ya emitido:

```sh
TELEPATIA_TOKEN=<access token> telepatia c list
```

Con `TELEPATIA_TOKEN` el CLI **no** refresca el token: cuando expira, tienes que conseguir otro.

### 4.6 ¿Dónde se guarda la sesión?

| Sistema | Archivo |
|---|---|
| macOS / Linux | `~/.config/telepatia/credentials.json` (o `$XDG_CONFIG_HOME/telepatia/`) |
| Windows | `%APPDATA%\telepatia\credentials.json` |

El archivo se crea con permisos `600` (solo tu usuario puede leerlo). Puedes cambiar la carpeta con `TELEPATIA_CONFIG_DIR`.

---

## 5. Referencia de comandos

Convenciones:

- `<obligatorio>` y `[opcional]`.
- Casi todos los comandos aceptan `--json` para obtener la respuesta completa en JSON.
- Abreviaturas: `consultations` → `c`, `patients` → `p`, `templates` → `t`.
- Ayuda de cualquier comando: `telepatia <comando> --help`.

### 5.1 Autenticación y cuentas

#### `telepatia login [email]`

Inicia sesión. Ver la [sección 4](#4-iniciar-sesión).

| Opción | Descripción |
|---|---|
| `--otp` | Login sin contraseña, con código por email o WhatsApp |
| `--channel <canal>` | Con `--otp`: `auto` (por defecto), `email` o `whatsapp` |
| `--device` | Aprobar desde la app móvil |
| `--api-key <clave>` | Intercambiar una API key institucional |
| `--account <accountId>` | Elegir institución sin que te pregunte |

#### `telepatia logout`

Revoca el refresh token en el servidor y borra el archivo de credenciales.

#### `telepatia whoami [--json]`

Muestra con qué usuario y cuenta estás autenticado: email, `uid`, `accountId`, institución, roles, país y cuándo expira el token actual.

```text
email           medico@ejemplo.com
accountId       6650c…
institution     Clínica Ejemplo
roles           doctor
tokenExpiresAt  2026-09-27T18:05:00.000Z
```

#### `telepatia accounts [list] [--json]`

Lista las cuentas o instituciones a las que perteneces. La activa aparece marcada con `*`.

#### `telepatia accounts switch <accountId>`

Cambia la cuenta activa. Todos los comandos siguientes usan esa institución.

---

### 5.2 Consultas

#### `telepatia consultations [list]`

Lista tus consultas, las más recientes primero. Muestra id, fecha, paciente, estado y plantilla.

| Opción | Por defecto | Descripción |
|---|---|---|
| `-s, --search <texto>` | — | Búsqueda en el servidor (nombre del paciente, etc.) |
| `-n, --limit <n>` | 20 | Cuántas mostrar |
| `--offset <n>` | 0 | Saltar las primeras N (para paginar) |
| `--status <estados>` | todos excepto cancelados y eliminados | Lista separada por comas, p. ej. `completed,reviewed` |
| `--count` | — | Solo muestra el total |
| `--json` | — | Salida JSON |

```sh
telepatia c                                  # últimas 20
telepatia c -s "García" -n 50                # buscar
telepatia c --status error,completedWithErrors
telepatia c --count                          # ¿cuántas consultas tengo?
telepatia c -n 20 --offset 20                # página 2
```

#### `telepatia consultations show <id>`

Muestra la nota clínica en Markdown:

- encabezado con paciente, id, fecha, estado y plantilla;
- cada sección de la nota, con los títulos de tu plantilla;
- códigos diagnósticos (CIE), si los hay;
- **advertencias de verificación**: frases que la IA de Telepatia marcó como posiblemente no respaldadas por la conversación.

| Opción | Descripción |
|---|---|
| `-t, --transcript` | Añade la transcripción al final |
| `--json` | Devuelve el objeto completo de la consulta, con todos los campos crudos |

```sh
telepatia c show 7f3e…
telepatia c show 7f3e… -t > consulta.md
```

Ejemplo de salida:

```markdown
# María Pérez

- **Consulta:** 7f3e…
- **Fecha:** 26/9/26, 10:15
- **Estado:** completed
- **Plantilla:** Medicina general

## Motivo de consulta

Dolor de cabeza de 3 días.

## Análisis y plan

**Análisis:**
Cefalea tensional…

**Plan:**
- Acetaminofén 500 mg cada 8 horas
- Control en 1 semana
```

Si una sección todavía se está generando, aparece como `_(processing)_`.

#### `telepatia consultations transcript <id>`

Imprime solo la transcripción.

| Opción | Descripción |
|---|---|
| `--anonymized` | Pide siempre la versión **anonimizada** del servidor (sin datos identificables). |

Normalmente Telepatia entrega la transcripción **anonimizada**, igual que en la web, y el CLI lo indica con el aviso "(transcripción anonimizada por Telepatia)". Si alguna consulta trae la transcripción completa, el CLI muestra esa.

#### `telepatia consultations export <ids...>`

Exporta una o varias consultas.

| Opción | Por defecto | Descripción |
|---|---|---|
| `-f, --format <fmt>` | `md` | `md` (Markdown legible) o `json` (datos completos) |
| `-o, --out <archivo>` | salida estándar | Archivo de destino. Con varios ids se usa como prefijo: `<out>-<id>.<fmt>` |
| `-t, --transcript` | — | Incluir la transcripción (solo en `md`) |

```sh
telepatia c export 7f3e… -o nota.md
telepatia c export 7f3e… 9a1b… -f json -o respaldo/consulta
#   → respaldo/consulta-7f3e….json, respaldo/consulta-9a1b….json
```

Los archivos se crean con permisos `600`.

#### `telepatia consultations documents <id> [--json]`

Lista los documentos que Telepatia generó para la consulta, por ejemplo una nota por cada plantilla o reportes, con su propósito, especialidad e idioma.

#### `telepatia consultations wait <id> [--timeout <min>]`

Espera, revisando cada 5 segundos, a que la consulta llegue a un estado final, y va mostrando los cambios de estado. El tiempo máximo por defecto es 30 minutos.

#### `telepatia consultations regenerate <id> [--template <id>]`

Pide a Telepatia que vuelva a generar la nota a partir de la transcripción. Con `--template` puedes generarla con otra plantilla. Después usa `wait` y `show`.

#### `telepatia consultations recover <id>`

Pide al servidor que finalice una consulta que quedó atascada, por ejemplo en `processing` o `stopped` durante mucho tiempo. Equivale al botón "recuperar" de la web. Muestra qué acciones tomó el servidor y el nuevo estado.

#### `telepatia consultations delete <id> [-y]`

Elimina la consulta: la marca como `deleted`, igual que la web. Te muestra el paciente y la fecha y pide confirmación. Con `-y, --yes` no pregunta.

---

### 5.3 Crear consultas: `upload` y `record`

> **Consentimiento.** Grabar y procesar la voz de un paciente requiere su consentimiento. Asegúrate de tenerlo según la normativa de tu país y las políticas de tu institución.

#### `telepatia upload <audio>`

Crea una consulta nueva a partir de un archivo de audio, lo sube, espera a que Telepatia transcriba y genere la nota, y la imprime en Markdown.

| Opción | Descripción |
|---|---|
| `--template <id\|nombre>` | Plantilla. Acepta el id o el nombre exacto (sin distinguir mayúsculas). Si no la indicas: con una sola plantilla se usa esa; si tienes varias, te pregunta (o da error si no hay terminal interactiva). |
| `--patient <id>` | Asociar la consulta a un paciente existente |
| `--telemedicine` | Marcarla como teleconsulta |
| `--external-id <id>` | Id de la consulta en tu propio sistema o EMR, para cruzar datos |
| `--no-wait` | No esperar: imprime el id de la consulta y termina |
| `--timeout <min>` | Espera máxima (por defecto 30) |
| `--json` | Imprimir la consulta final en JSON |

**Formatos:**

| Caso | Qué pasa |
|---|---|
| wav, flac, ogg, opus, aiff/aif | Se suben tal cual |
| mp3, m4a, mp4, webm, etc. | Se convierten automáticamente con ffmpeg a FLAC 16 kHz mono, sin pérdida y más liviano. Sin ffmpeg, da un error que explica cómo instalarlo |
| Tamaño | Entre 1 KB y 100 MB. Una hora de audio en FLAC 16 kHz mono ocupa unos 50–60 MB |

```sh
telepatia upload consulta.m4a --template "Medicina general" > nota.md
telepatia upload consulta.wav --template 64f… --patient 65a… --no-wait
```

El progreso (plantilla elegida, id creado, estados) se imprime en stderr. Así, redirigir con `>` solo guarda la nota.

#### `telepatia record`

Graba desde el micrófono con ffmpeg y, al terminar, sube la consulta igual que `upload`.

```sh
telepatia record --template "Medicina general" --patient 65a…
# ● Grabando 03:42  (Enter para terminar)
```

Para terminar, presiona **Enter** o **Ctrl+C**. ffmpeg cierra el archivo correctamente en ambos casos.

| Opción | Descripción |
|---|---|
| `--template <id\|nombre>` | Plantilla (igual que en `upload`) |
| `--patient <id>` | Paciente existente |
| `--device <nombre>` | Micrófono. Por defecto el del sistema en macOS y Linux. **En Windows es obligatorio** |
| `-o, --out <archivo>` | Guardar además el audio en ese archivo `.flac` |
| `--no-upload` | Solo grabar, sin subir |
| `--no-wait` | Subir sin esperar la nota |

Cómo ver los nombres de los micrófonos:

| Sistema | Comando |
|---|---|
| macOS | `ffmpeg -f avfoundation -list_devices true -i ""` (usa el índice o el nombre) |
| Linux (PulseAudio/PipeWire) | `pactl list short sources` |
| Windows | `ffmpeg -list_devices true -f dshow -i dummy` y luego `--device "Micrófono (Realtek…)"` |

En macOS, la primera vez el sistema pedirá permiso de micrófono para tu terminal (Terminal, iTerm, etc.).

**¿Por qué no transcribe en tiempo real?** La web envía el audio por un WebSocket con un formato no documentado que cambia según la configuración de cada institución. Si esa réplica fallara a mitad de una consulta, perderías el audio. `record` graba en local y sube al final: es más lento de ver, pero no pierde nada. Si la subida falla, el audio sigue en disco y puedes reintentar con `upload`.

---

### 5.4 Pacientes

#### `telepatia patients [list]`

| Opción | Por defecto | Descripción |
|---|---|---|
| `-n, --limit <n>` | 25 | Cuántos |
| `--offset <n>` | 0 | Paginación |
| `--sort <orden>` | orden del servidor | `name` (alfabético) o `recent` (última consulta primero). Ojo: con `recent` solo aparecen los pacientes que ya tienen consultas; es un comportamiento de la API de Telepatia |
| `--json` | — | Incluye `totalCount` |

#### `telepatia patients search <texto> [-n N] [--json]`

Busca por nombre o número de identificación.

#### `telepatia patients show <id> [--json]`

Ficha del paciente: nombre, identificaciones, teléfonos, emails, última consulta y fecha de creación.

#### `telepatia patients history <id> [--json]`

Historial de consultas del paciente, con fecha, estado, médico y resumen. Con `c show` puedes abrir cualquiera de ellas.

#### `telepatia patients create <nombre>`

Crea un paciente (o actualiza uno existente con la misma identificación) e imprime su id.

| Opción | Descripción |
|---|---|
| `--id-type <tipo>` | Tipo de documento: CC, CPF, DNI… |
| `--id-value <número>` | Número de documento |
| `--country <país>` | País del documento: código de 2 letras (`CO`, `BR`, `MX`…) o nombre en inglés (`COLOMBIA`, `COSTA_RICA`…). El CLI lo convierte al formato que exige Telepatia |
| `--json` | Salida JSON |

```sh
ID=$(telepatia patients create "María Pérez" --id-type CC --id-value 123456 --country CO)
telepatia upload consulta.m4a --patient "$ID" --template "Medicina general"
```

---

### 5.5 Plantillas

#### `telepatia templates [list] [--json]`

Lista tus plantillas con su id, nombre, tipo y especialidades. Usa el id o el nombre en `upload --template`.

#### `telepatia templates show <id> [--lang es|en|pt] [--json]`

Muestra las secciones de la plantilla en orden, con las instrucciones que sigue la IA para redactar cada una. Sirve para entender por qué una nota sale como sale.

Crear o editar plantillas se hace en la web: `scribe.telepatia.ai/templates`.

---

### 5.6 Acceso directo a la API

Para lo que el CLI no cubre todavía. Usa tu sesión y renueva el token automáticamente. En [API.md](API.md) están los servicios y endpoints conocidos.

#### `telepatia api graphql <query> [-v <json>]`

Ejecuta una consulta GraphQL contra el *datalayer*. Tanto `<query>` como `-v` aceptan `@archivo`.

```sh
telepatia api gql 'query($id: ID!){ scribeSession(id:$id){ id status createdAt } }' -v '{"id":"7f3e…"}'
telepatia api gql @mi-consulta.graphql -v @vars.json
```

#### `telepatia api rest <método> <servicio> <ruta> [-d <json>]`

Petición REST autenticada. Servicios: `ai-backend`, `scribe-bff`, `authcentral`.

```sh
# Catálogo de escalas clínicas
telepatia api rest GET ai-backend "/v1/intelligence/scales?language=es"

# Buscar códigos CIE
telepatia api rest POST ai-backend /v1/reference-codes/icd/search -d '{"query":"migraña","language":"es","limit":5}'

# Redactar indicaciones en lenguaje sencillo para el paciente
telepatia api rest POST ai-backend /v1/patient-education/generate \
  -d '{"sections":[{"id":"plan","title":"Plan","text":"Acetaminofén 500 mg c/8h"}],"language":"es"}'
```

> Con `api` puedes llamar endpoints que **modifican datos**. Revisa bien lo que envías.

---

## 6. Flujos de trabajo y recetas

Los ejemplos usan [`jq`](https://jqlang.github.io/jq/) para procesar JSON.

### Nota del día al portapapeles (macOS)

```sh
telepatia c show "$(telepatia c -n 1 --json | jq -r '.[0].id')" | pbcopy
```

### Respaldo de todas las consultas completadas

```sh
mkdir -p respaldo
telepatia c --status completed,reviewed -n 500 --json \
  | jq -r '.[].id' \
  | xargs telepatia c export -f json -o respaldo/consulta
```

### Procesar una carpeta de audios

```sh
for f in audios/*.m4a; do
  telepatia upload "$f" --template "Medicina general" > "notas/$(basename "$f" .m4a).md"
done
```

Para no esperar consulta por consulta, sube todo con `--no-wait`, guarda los ids y luego usa `wait` y `export`:

```sh
for f in audios/*; do telepatia upload "$f" --template "Medicina general" --no-wait; done > ids.txt
while read id; do telepatia c wait "$id" && telepatia c export "$id" -o "notas/$id.md"; done < ids.txt
```

### Todas las consultas de un paciente

```sh
PID=$(telepatia patients search "María Pérez" --json | jq -r '.[0].id')
telepatia patients history "$PID"
```

### Detectar consultas con problemas y recuperarlas

```sh
telepatia c --status error,completedWithErrors,stopped --json | jq -r '.[].id' \
  | while read id; do telepatia c recover "$id"; done
```

### Revisar advertencias de la IA antes de firmar

```sh
telepatia c show <id> --json | jq '.hallucinationWarnings'
```

### Transcripciones anonimizadas para docencia o investigación

```sh
telepatia c transcript <id> --anonymized > caso-anonimo.txt
```

Revisa igual el resultado antes de compartirlo.

---

## 7. Salida, scripting y códigos de salida

- **stdout** lleva solo el resultado: tablas, Markdown, JSON o ids.
- **stderr** lleva el progreso, las confirmaciones y los errores.

Por eso `telepatia c show <id> > nota.md` guarda solo la nota, y `| jq` funciona sin ruido.

- `--json` devuelve los datos **tal como los entrega la API**, con todos los campos. Es la forma recomendada de integrar con otras herramientas.
- Los colores se desactivan cuando la salida no es una terminal o cuando defines `NO_COLOR=1`.
- Los comandos que preguntan algo (contraseña, elegir plantilla o institución, confirmar un borrado) necesitan una terminal interactiva. En scripts, pasa esos valores con opciones (`--template`, `--account`, `-y`) o variables de entorno.

| Código de salida | Significado |
|---|---|
| `0` | Éxito |
| `1` | Error: sin sesión, error de la API, archivo inválido, tiempo agotado… |
| `130` | Cancelado por el usuario (Ctrl+C en un prompt) |

---

## 8. Variables de entorno

| Variable | Uso |
|---|---|
| `TELEPATIA_EMAIL` / `TELEPATIA_PASSWORD` | Login con email y contraseña sin prompts |
| `TELEPATIA_API_KEY` | Login con API key institucional |
| `TELEPATIA_TOKEN` | Usar este access token directamente, sin sesión guardada y sin refresco |
| `TELEPATIA_CONFIG_DIR` | Carpeta donde se guardan las credenciales |
| `NO_COLOR` | Desactivar colores |
| `TELEPATIA_WEB_URL` | URL de la web (por defecto `https://scribe.telepatia.ai`) |
| `TELEPATIA_AUTH_URL` | Servicio de autenticación |
| `TELEPATIA_AI_BACKEND_URL` | Backend de IA |
| `TELEPATIA_DATALAYER_URL` | API GraphQL |
| `TELEPATIA_SCRIBE_BFF_URL` | Servicio scribe-bff |

Las variables `*_URL` solo sirven para apuntar a otros entornos, como staging, si tienes acceso.

---

## 9. Seguridad y privacidad

El CLI trabaja con **datos de salud**, así que su diseño es conservador:

- **Credenciales**: se guardan en un archivo con permisos `600`, nunca en el historial de la terminal. La contraseña se escribe oculta y no se guarda: solo se guardan los tokens. `logout` revoca la sesión en el servidor y borra el archivo.
- **Sin caché de datos clínicos**: el CLI no guarda consultas, notas ni pacientes en disco. Solo escribe archivos cuando tú lo pides (`export -o`, `record -o`), siempre con permisos `600`.
- **Sin telemetría**: el CLI solo se comunica con los servidores de Telepatia (`private.telepatia.ai`). No envía métricas ni errores a terceros.
- **Audio**: `record` graba en un directorio temporal del sistema. Si quieres conservar la grabación, usa `-o`. Si quieres borrarla, recuerda que el directorio temporal lo limpia el sistema operativo, no el CLI.
- **Equipos compartidos**: prefiere `login --device` o `--otp` y ejecuta `logout` al terminar.
- **Al reportar errores**: nunca pegues salidas con nombres, documentos, transcripciones ni notas de pacientes en issues públicos.

¿Encontraste un problema de seguridad? Ver [SECURITY.md](../SECURITY.md).

---

## 10. Solución de problemas

| Mensaje | Causa y solución |
|---|---|
| `No has iniciado sesión. Ejecuta: telepatia login` | No hay sesión guardada. Inicia sesión. |
| `Tu sesión expiró` | El refresh token venció (unos 7 días sin uso) o fue revocado. Vuelve a iniciar sesión. |
| `Email o contraseña incorrectos.` | Revisa los datos. Si entras con Google en la web, usa `login --otp` o `--device`. |
| `Tu email no está verificado.` | Confirma la cuenta desde el correo de Telepatia. |
| `Demasiados intentos.` (429) | Límite de intentos del servidor. Espera unos minutos. |
| `Error de la API: … → 403` | Tu cuenta o institución no tiene permiso para esa función, o no está habilitada para ti. |
| `GraphQL: …` | El servidor rechazó la consulta. Si es un error de campo o tipo, Telepatia probablemente cambió su API: abre un issue. |
| `Indica la plantilla con --template` | Tienes varias plantillas y no hay terminal interactiva. Mira las disponibles con `telepatia templates`. |
| `Formato … no soportado` | Instala ffmpeg o convierte el audio a wav o flac. |
| `El archivo pesa … el máximo es 100 MB` | Divide el audio o conviértelo a FLAC mono 16 kHz: `ffmpeg -i in.wav -ac 1 -ar 16000 out.flac`. |
| `Tiempo de espera agotado` | La consulta sigue procesándose. Revisa luego con `c show <id>` o `c wait <id> --timeout 60`. Si no avanza, usa `c recover <id>`. |
| `record` no graba nada o falla | Revisa el permiso de micrófono de tu terminal (macOS), el nombre del dispositivo (`--device`) y que ffmpeg funcione. |
| `la petición tardó demasiado` | Problema de red. Reintenta. |

---

## 11. Limitaciones conocidas

- **No es oficial**: depende de APIs privadas que Telepatia puede cambiar en cualquier momento.
- **No hay transcripción en vivo** en `record` (ver la [sección 5.3](#53-crear-consultas-upload-y-record)).
- **No hay login con Google.** Alternativas: `--otp` o `--device`.
- **No se pueden editar notas.** Hazlo en la web; el CLI sirve para leer, exportar y regenerar.
- **Órdenes médicas, recetas, firma digital, envío por WhatsApp y PHR** no están incluidos, a propósito: son acciones con efectos legales o que llegan al paciente y conviene hacerlas con la interfaz.
- **Funciones por institución** (hospitalización, triage, dictado, integraciones con EMR): dependen de configuración que el CLI no controla.
- **`--search`** usa la búsqueda del servidor; su comportamiento exacto depende de Telepatia.

En [COBERTURA.md](COBERTURA.md) está la tabla completa.

---

## 12. Preguntas frecuentes

**¿Es seguro? ¿Mis datos pasan por otro lado?**
No pasan por ningún otro lado. El CLI corre en tu computador y habla directamente con los servidores de Telepatia, igual que tu navegador. Es código abierto: puedes auditar cada línea.

**¿Necesito una cuenta especial?**
No. Sirve tu cuenta normal de Telepatia Scribe. Lo que puedes hacer depende de tu plan e institución.

**¿Puedo usarlo en un servidor o en una integración?**
Sí, con `--json`, las variables de entorno y `login --device` o `--api-key`. Ten en cuenta las limitaciones de una API no oficial y las obligaciones legales sobre datos de salud.

**¿Las consultas creadas con el CLI se ven en la web?**
Sí. Son consultas normales de tu cuenta. En sus metadatos quedan marcadas como creadas desde `cli`.

**¿Qué pasa si Telepatia cambia su API?**
Algunos comandos pueden fallar hasta que se actualice el CLI. Abre un issue sin datos de pacientes.

**¿Puedo usar mi propia IA con las transcripciones?**
Sí: `c transcript` o `c export -f json` te dan los datos. Hazlo solo con proveedores y acuerdos que cumplan la normativa de datos de salud.

---

## 13. Cómo funciona por dentro

Resumen; el detalle técnico está en [API.md](API.md).

```
telepatia-cli ──► authcentral   (login, tokens, cuentas)
              ├─► datalayer     (GraphQL: consultas, notas, pacientes, plantillas)
              └─► ai-backend    (crear consulta, subir audio, regenerar, transcripción anonimizada)
```

1. **Login**: authcentral entrega un access token (JWT) y un refresh token. La institución activa va dentro del JWT. El CLI renueva el token 5 minutos antes de que expire y, si una petición devuelve 401 o 403, lo renueva y reintenta una vez.
2. **Lecturas** (consultas, notas, pacientes, plantillas): consultas GraphQL copiadas de las que usa la web (`src/api/queries.ts`).
3. **Nota clínica**: llega como JSON por secciones (`medicalRecordMutable`), con varias formas posibles (texto, estructurada, análisis y plan, escalas). `src/note.ts` la convierte a Markdown con los títulos de tu plantilla. Nunca descarta información: lo que no reconoce lo muestra como JSON.
4. **Crear consulta**: el CLI genera el id (UUID), registra la sesión en ai-backend con la plantilla elegida, sube el audio (`process-audio`) y consulta el estado por GraphQL hasta que termina.

### Estructura del código

```
src/
├── index.ts              punto de entrada, manejo de errores
├── config.ts             URLs de servicios, rutas de configuración
├── errors.ts             CliError / HttpError
├── ui.ts                 tablas, prompts y confirmaciones (modo comando)
├── theme.ts              paleta de Telepatia → colores de terminal (truecolor/256/16)
├── tui/
│   ├── app.ts            menú interactivo (pantallas y navegación)
│   ├── banner.ts         pantalla de inicio: logo y wordmark
│   └── render.ts         Markdown → terminal, etiquetas de estado
├── note.ts               JSON de la nota → Markdown
├── sessions.ts           obtener/esperar consultas, resolver plantillas
├── audio.ts              validación y conversión de audio (ffmpeg)
├── auth/
│   ├── authcentral.ts    cliente de autenticación
│   ├── session.ts        tokens válidos, refresco automático
│   ├── store.ts          archivo de credenciales (600)
│   └── jwt.ts            lectura de claims
├── api/
│   ├── http.ts           fetch autenticado con reintento en 401/403
│   ├── graphql.ts        cliente GraphQL
│   ├── queries.ts        operaciones GraphQL
│   └── aiBackend.ts      endpoints REST del backend de IA
└── commands/             un archivo por grupo de comandos
test/                     tests unitarios (node:test)
```

¿Quieres contribuir? Ver [CONTRIBUTING.md](../CONTRIBUTING.md).
