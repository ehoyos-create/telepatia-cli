# Contribuir a telepatia-cli

¡Gracias por ayudar! Esta guía resume cómo trabajar en el proyecto.

## Entorno

```sh
npm install
npm run dev -- --help     # ejecuta el código fuente con tsx, sin compilar
npm test                  # tests unitarios (node:test)
npm run typecheck
npm run build             # compila a dist/
```

La estructura del código está explicada en [docs/GUIA.md](docs/GUIA.md#estructura-del-código) y el funcionamiento de la API en [docs/API.md](docs/API.md).

## Reglas importantes

1. **Nunca subas datos de pacientes**: ni en tests, fixtures, capturas, issues ni PRs. Usa datos inventados.
2. **Nunca subas credenciales ni tokens.**
3. **Mantén el CLI conservador con acciones sensibles.** Todo lo que borra o modifica datos pide confirmación. Firmar documentos o enviar mensajes a pacientes queda fuera del alcance, salvo que se discuta antes en un issue.
4. **Sin telemetría ni servicios de terceros.** El CLI solo debe hablar con los servidores de Telepatia.
5. **Mensajes al usuario en español**; código y comentarios en inglés.
6. Los mensajes de progreso van a **stderr**. En **stdout** va solo el resultado, para que se pueda usar con pipes.
7. **Pensado para agentes.** Cada comando debe funcionar igual de bien si lo ejecuta Claude:
   - imprime datos con `printJson` cuando `wantJson()` es verdadero, y reporta las acciones con `done({...}, mensaje)`, incluyendo `next` si hay un paso siguiente;
   - lanza `CliError(mensaje, EXIT.X, hint)` con el código de salida adecuado y un `hint` que sea un comando ejecutable;
   - nunca bloquees esperando input sin terminal: sal con `EXIT.NEEDS_INPUT` y di qué opción pasar, o parte el flujo en pasos (como `login --otp` → `login --code`);
   - si agregas un comando que un agente usaría, agrégalo también como herramienta en `src/mcp.ts` y en `skills/telepatia/SKILL.md`. `telepatia schema` se genera solo.

## Si Telepatia cambió su API

Las operaciones GraphQL están en `src/api/queries.ts` y los endpoints REST en `src/api/aiBackend.ts` y `src/auth/authcentral.ts`. Si algo dejó de funcionar:

1. Abre scribe.telepatia.ai con las herramientas de desarrollador (pestaña Red).
2. Compara la petición que hace la web con la que hace el CLI.
3. Actualiza el código y [docs/API.md](docs/API.md).

Para probar contra el servidor real usa tu propia sesión e imprime solo errores, conteos o la forma de los datos, **nunca datos de pacientes**. La introspección de GraphQL está desactivada. Para comprobar un tipo sin efectos (por ejemplo, sin crear un paciente), envía la mutación con otro campo inválido a propósito: el servidor la rechaza en la validación y reporta todos los errores de tipos.

## Pull requests

- Una funcionalidad o arreglo por PR.
- Agrega tests cuando cambies lógica pura (por ejemplo `src/note.ts`).
- Actualiza la documentación (`docs/GUIA.md`, `docs/COBERTURA.md`) si cambias comandos u opciones.

## Publicar una versión

1. Anota los cambios en `CHANGELOG.md`, en la sección `[Sin publicar]`, y renómbrala a `[X.Y.Z] — fecha`.
2. Cambia la versión en `package.json`, `package-lock.json`, `src/config.ts` (`VERSION`) y en la vista previa del banner de `README.md` y `docs/GUIA.md`.
3. Haz commit y push a `main`, y espera a que el CI quede en verde.
4. Crea el release con las notas de esa versión del CHANGELOG: `gh release create vX.Y.Z --title vX.Y.Z --notes-file notas.md`.
