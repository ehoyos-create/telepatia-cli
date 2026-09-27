---
name: telepatia
description: Usa Telepatia Scribe (escriba médico con IA) desde la terminal con el CLI `telepatia` — consultas médicas, notas clínicas, transcripciones, pacientes, plantillas y crear consultas desde un audio. Úsala cuando el usuario mencione Telepatia, Scribe, sus consultas, notas clínicas, historias clínicas, transcripciones de consultas o pacientes.
---

# Telepatia Scribe CLI

`telepatia` habla con la cuenta del usuario en Telepatia Scribe. Los datos son **de salud y sensibles**: no los copies a archivos, issues ni servicios externos salvo que el usuario lo pida.

## Cómo se comporta con un agente

Cuando lo ejecutas tú (`CLAUDECODE` está definido, o no hay terminal en stdin ni stdout) el CLI está en **modo agente**:

- Listas y registros salen en **JSON compacto de una línea**, sin campos vacíos. `--fields a,b.c` recorta aún más.
- Las notas (`consultations show`, `export`) salen en **Markdown**, que es lo que mejor lees. `--json` fuerza JSON crudo (mucho más largo).
- Los comandos de acción imprimen `{"ok":true,...,"next":"<comando sugerido>"}`.
- Los errores son una línea JSON en stderr: `{"error":{"code","message","hint"}}`. Ejecuta el `hint` si tiene sentido.
- Nunca se queda esperando input: si falta algo, sale con código 7 y el `hint` dice qué flag pasar.

Códigos de salida: `0` ok · `2` uso incorrecto · `3` sin sesión (`auth_required`) · `4` no encontrado · `5` timeout (repite el comando) · `6` error de la API · `7` falta input (`needs_input`).

## Sesión

```sh
telepatia whoami                     # código 3 → no hay sesión
telepatia login --otp <email>        # envía un código → pregúntale el código al usuario
telepatia login --code <código>      # completa el login (y el 2FA)
telepatia login --device             # alternativa: el usuario aprueba en la app móvil con userCode
telepatia login --wait               # espera la aprobación (repite si sale con código 5)
telepatia login --account <id>       # si responde status "account_required"
```

Nunca pidas ni manejes la contraseña del usuario; usa `--otp` o `--device`.

## Recetas

```sh
telepatia consultations --limit 10                     # últimas consultas: id, createdAt, status, patient…
telepatia consultations --search "Pérez" --fields id,createdAt,patient.fullName,status
telepatia consultations --count --status completed
telepatia c show <id>                                  # nota clínica (Markdown): secciones, CIE, advertencias
telepatia c show <id> -t                               # + transcripción
telepatia c transcript <id>
telepatia patients search "Pérez"
telepatia patients history <patientId>                 # consultas previas con resumen
telepatia templates                                    # plantillas (id, name)
```

Crear una consulta desde un audio (confirma antes con el usuario que tiene el consentimiento del paciente):

```sh
telepatia upload /ruta/audio.m4a --template "<nombre o id>" [--patient <id>]
# → {"ok":true,"id":"…","status":"processing","next":"telepatia consultations wait <id> --timeout 100s"}
telepatia consultations wait <id> --timeout 100s       # código 5 = sigue procesando: repite
telepatia c show <id>
```

Acciones con efecto (pide confirmación al usuario antes): `consultations regenerate <id>`, `consultations delete <id> --yes`, `patients create`.

## Descubrir más

- `telepatia schema` — todos los comandos, argumentos y opciones en JSON.
- `telepatia <comando> --help` — ayuda de un comando.
- `telepatia api graphql '<query>'` / `telepatia api rest <METHOD> <service> <path>` — acceso directo a la API para lo que no tenga comando.
- `telepatia mcp` — el mismo CLI como servidor MCP (`claude mcp add telepatia -- telepatia mcp`).
