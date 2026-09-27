# telepatia-cli

[![CI](https://github.com/ehoyos-create/telepatia-cli/actions/workflows/ci.yml/badge.svg)](https://github.com/ehoyos-create/telepatia-cli/actions/workflows/ci.yml) [![Licencia: MIT](https://img.shields.io/badge/licencia-MIT-076f42.svg)](LICENSE) ![Node.js 20+](https://img.shields.io/badge/node-%3E%3D20-076f42.svg)

CLI **no oficial** y de código abierto para [Telepatia Scribe](https://scribe.telepatia.ai), el escriba médico con IA.

Desde la terminal puedes:

- consultar tus consultas médicas;
- leer y exportar notas clínicas y transcripciones;
- crear consultas a partir de un audio o grabando con el micrófono;
- gestionar pacientes y plantillas;
- automatizar todo esto en scripts.

Ejecuta `telepatia` sin argumentos y se abre un **menú interactivo**, con el logo y los colores de Telepatia:

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
          ████    ████             v0.1.0 · proyecto comunitario, no oficial
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

Te mueves con las flechas, eliges con Enter y vuelves atrás con Esc. Cada acción del menú también existe como comando, para usar en scripts:

```sh
telepatia consultations                 # listar consultas
telepatia c show <id> > nota.md         # nota clínica en Markdown
telepatia upload consulta.m4a --template "Medicina general"
```

> ⚠️ **Proyecto comunitario, no afiliado a Telepatia.** Usa las mismas APIs privadas que la aplicación web, con **tu cuenta y tus permisos**. Esas APIs pueden cambiar sin aviso. Úsalo conforme a los términos de servicio de Telepatia y a la normativa de datos de salud de tu país (Ley 1581 en Colombia, LGPD en Brasil, LFPDPPP en México, etc.).

## Documentación

| Documento | Contenido |
|---|---|
| **[Guía completa](docs/GUIA.md)** | Instalación, login, cada comando con sus opciones y ejemplos, recetas, automatización, seguridad, solución de problemas, preguntas frecuentes |
| [Cobertura](docs/COBERTURA.md) | Todo lo que hace Telepatia Scribe y qué parte cubre el CLI (y por qué) |
| [API](docs/API.md) | Cómo funciona la API de Telepatia por dentro (referencia técnica no oficial) |
| [Contribuir](CONTRIBUTING.md) · [Seguridad](SECURITY.md) · [Cambios](CHANGELOG.md) | Para desarrolladores |

## Instalación

Requiere **Node.js 20 o superior**. **ffmpeg** es opcional: se usa para convertir audios y para grabar.

```sh
git clone https://github.com/ehoyos-create/telepatia-cli.git
cd telepatia-cli
npm install && npm run build
npm link
```

## Inicio rápido

```sh
telepatia                                        # menú interactivo (lo más fácil)
telepatia login                                  # email + contraseña (o --otp, --device)
telepatia whoami                                 # ¿con qué cuenta estoy?
telepatia consultations                          # últimas consultas
telepatia c show <id>                            # nota clínica en Markdown
telepatia c show <id> -t > consulta.md           # nota + transcripción a un archivo
telepatia upload audio.m4a --template "Medicina general"
telepatia record --template "Medicina general"   # grabar desde el micrófono
telepatia patients search "Pérez"
telepatia templates
```

## Todo lo que puedes hacer

| Área | Comandos |
|---|---|
| **Menú interactivo** | `telepatia` (o `telepatia menu`): consultas, nueva consulta, pacientes, plantillas y cuenta, todo navegable con el teclado |
| **Sesión** | `login` (contraseña + 2FA, `--otp` por email/WhatsApp, `--device` desde la app móvil, `--api-key`) · `logout` · `whoami` · `accounts list/switch` |
| **Consultas** | `consultations list` (buscar, filtrar por estado, paginar, contar) · `show` (nota + códigos CIE + advertencias de la IA) · `transcript` (normal o `--anonymized`) · `export` (Markdown/JSON, varias a la vez) · `documents` · `wait` · `regenerate` · `recover` · `delete` |
| **Crear consultas** | `upload <audio>` (wav, flac, ogg, opus, aiff; mp3, m4a y otros se convierten con ffmpeg; hasta 100 MB) · `record` (micrófono → subida) |
| **Pacientes** | `patients list/search/show/history/create` |
| **Plantillas** | `templates list/show` (secciones e instrucciones de la IA) |
| **Avanzado** | `api graphql` / `api rest`: llamadas directas a la API para lo que el CLI aún no envuelve |

Todos los comandos aceptan `--json`. El progreso se escribe en stderr, así que stdout queda limpio para usar con `| jq` o `> archivo`. Los detalles están en la **[guía completa](docs/GUIA.md)**.

## Lo que no hace, a propósito

- **Editar notas, firmar órdenes o recetas, enviar documentos a pacientes por WhatsApp:** son acciones con efectos clínicos o legales; se hacen mejor en la web.
- **Transcripción en tiempo real al grabar:** `record` graba en local y sube al terminar, para no perder nunca el audio.
- **Login con Google:** usa `--otp` o `--device`.

La lista completa está en [docs/COBERTURA.md](docs/COBERTURA.md).

## Privacidad

- Las credenciales se guardan con permisos `600`, y `logout` las revoca y las borra.
- El CLI no guarda datos de pacientes en caché ni envía telemetría: solo se comunica con los servidores de Telepatia.
- **Nunca incluyas datos de pacientes en issues.**

## Licencia

[MIT](LICENSE). Telepatia, Telepatia Scribe, su logo y sus colores son de sus respectivos dueños; se usan solo para identificar el servicio con el que se integra este proyecto.
