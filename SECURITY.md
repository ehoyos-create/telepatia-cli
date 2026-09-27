# Política de seguridad

`telepatia-cli` maneja credenciales y datos de salud, así que tomamos en serio los reportes de seguridad.

## Cómo reportar una vulnerabilidad

- **No abras un issue público.** Usa [GitHub Security Advisories](https://github.com/ehoyos-create/telepatia-cli/security/advisories/new) ("Report a vulnerability") de este repositorio.
- Describe el problema, cómo reproducirlo y su posible impacto.
- **No incluyas datos reales de pacientes** ni credenciales en el reporte.

Te responderemos lo antes posible y coordinaremos la publicación del arreglo.

## Alcance

- **Cubierto:** el código de este repositorio. Por ejemplo, el manejo de credenciales, permisos de archivos, fugas de datos en logs o salidas, y dependencias vulnerables.
- **No cubierto:** los servidores de Telepatia. Si encuentras una vulnerabilidad en Telepatia Scribe (la plataforma), repórtala directamente a Telepatia, no aquí. Este proyecto no está afiliado a ellos.

## Buenas prácticas para usuarios

- Ejecuta `telepatia logout` en equipos compartidos.
- No compartas `~/.config/telepatia/credentials.json` ni el valor de `TELEPATIA_TOKEN`.
- No pegues salidas del CLI con información de pacientes en issues, chats ni foros.
