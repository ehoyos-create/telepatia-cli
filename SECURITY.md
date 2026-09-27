# Política de seguridad

`telepatia-cli` maneja credenciales y datos de salud, así que tomamos en serio los reportes de seguridad.

## Cómo reportar una vulnerabilidad

- **No abras un issue público.** Usa [GitHub Security Advisories](https://github.com/ehoyos-create/telepatia-cli/security/advisories/new) ("Report a vulnerability") de este repositorio.
- Describe el problema, cómo reproducirlo y su posible impacto.
- **No incluyas datos reales de pacientes** ni credenciales en el reporte.

Te responderemos lo antes posible y coordinaremos la publicación del arreglo.

## Alcance

- **Cubierto:** el código de este repositorio. Por ejemplo, el manejo de credenciales, permisos de archivos, fugas de datos en logs o salidas, el servidor MCP (herramientas que expongan más de lo debido o que un agente pueda usar para borrar o modificar datos sin confirmación) y dependencias vulnerables.
- **No cubierto:** los servidores de Telepatia. Si encuentras una vulnerabilidad en Telepatia Scribe (la plataforma), repórtala directamente a Telepatia, no aquí. Este proyecto no está afiliado a ellos.

## Buenas prácticas para usuarios

- Ejecuta `telepatia logout` en equipos compartidos.
- No compartas `~/.config/telepatia/credentials.json`, `pending-login.json` ni el valor de `TELEPATIA_TOKEN`.
- Con agentes de IA (`telepatia mcp`, la skill), cuando usas el CLI desde Claude u otro agente de IA, lo que el agente lee (notas, transcripciones, nombres) entra en la conversación y lo procesa el proveedor del modelo. Hazlo solo si tu institución y la normativa de datos de salud de tu país lo permiten, y con cuentas que tengan los acuerdos adecuados (por ejemplo, un BAA o un DPA).
- No pegues salidas del CLI con información de pacientes en issues, chats ni foros.
