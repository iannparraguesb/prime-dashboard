# Conexión segura de Instagram para alumnos

Estado: diseño e infraestructura Fase A listos; onboarding bloqueado hasta completar Fase B/C y cerrar S01–S03/S07.

## Objetivo

Permitir que cada alumno conecte una sola cuenta profesional de Instagram y vea únicamente sus propios datos, sin exponer tokens ni alterar el dashboard interno de Iann/Leo.

## Flujo de producto

1. Un administrador crea el workspace del alumno y su membresía por UUID de Supabase Auth.
2. El alumno entra a Configuración → Instagram y pulsa **Conectar Instagram**.
3. El backend valida sesión y membresía, crea un `state` aleatorio de un solo uso, guarda únicamente su hash con TTL de 10 minutos y redirige a Meta OAuth.
4. Meta vuelve al callback permitido. El backend consume el `state` atómicamente, intercambia el código, descubre la cuenta Business/Creator y comprueba que no esté conectada a otro workspace.
5. El token queda en Supabase Vault o en almacenamiento privado cifrado. La tabla pública conserva solo el ID opaco del secreto y metadatos no sensibles.
6. Se encola la primera sincronización con `workspace_id` y `conexion_id` obligatorios.
7. El dashboard muestra estado, usuario, expiración y última sincronización; nunca muestra tokens ni errores crudos de Meta.
8. Desconectar revoca el token y detiene trabajos futuros, pero archiva los datos históricos.

## Contrato de seguridad

- `anon` no lee datos.
- Las consultas normales usan el JWT del usuario; no `service_role`.
- Workers/callbacks pueden usar privilegios, pero deben resolver explícitamente `workspace_id` + `conexion_id`.
- Ningún endpoint acepta un `usuario_id` como fuente de identidad.
- Toda caché, lock, job y webhook incluye workspace/conexión en su clave.
- Los errores públicos no contienen headers, códigos OAuth ni payloads de proveedor.
- La misma cuenta de Instagram no puede pertenecer a dos workspaces.
- No existe fallback del tipo “sin workspace → workspace interno”.

## Fases de implementación

### Fase A — completada y probada contra Postgres real, no aplicada en Supabase

Verificada el 2026-10-05 con `pruebas/multiusuario-db.test.mjs`: ejecuta la
migración en PGlite (Postgres 18 en WebAssembly) con roles y `auth.uid()` de
Supabase, y prueba el aislamiento con dos alumnos (14 casos). Se validó con
mutaciones: abrir una policy con `using (true)`, quitar `security_invoker`,
dar lectura a `anon` o a `private`, permitir escritura desde el navegador,
dejar entrar a invitados o quitar el `unique` de la cuenta de Instagram hace
fallar la suite. Corre en CI dentro de `npm run test:unit`.

Corregido al ejecutarla: las `create policy` no tenían guarda y la migración
fallaba al aplicarse por segunda vez.

Pendiente para Fase C: el esquema `private` no está expuesto por PostgREST, así
que el callback OAuth no puede escribir el token directamente aunque use
`service_role`. Hacen falta funciones `security definer` en `public` con
`execute` concedido solo a `service_role` (guardar estado, consumir estado,
guardar credencial en Vault).

Migración `0008_multiusuario_instagram.sql`:

- `workspace`
- `workspace_miembro`
- `instagram_conexion`
- `private.instagram_credencial`
- `private.instagram_oauth_estado`
- helpers RLS y vista pública con `security_invoker`

Es aditiva y no cambia las tablas actuales.

### Fase B — requerida antes de alumnos

1. Crear workspace interno.
2. Asociar a Iann y Leo por UUID, nunca por email embebido en SQL.
3. Añadir `workspace_id` nullable a `cuenta` y propagarlo a todas las tablas derivadas.
4. Importar la conexión actual de Leo y mover el token al almacén privado.
5. Backfill de todas las filas históricas.
6. Recrear vistas con `workspace_id` y `security_invoker`.
7. Actualizar servidor y workers para seleccionar siempre workspace/conexión.
8. Verificar cero filas huérfanas y paridad exacta de cifras del panel interno.

### Fase C — aislamiento obligatorio

1. Reemplazar las policies históricas `USING (true)` por membresía del workspace.
2. Revocar grants amplios y dejar métricas como lectura para `authenticated`.
3. Fijar `workspace_id NOT NULL` tras validar el backfill.
4. Implementar endpoints OAuth, rotación y desconexión.
5. Pruebas cruzadas con dos alumnos: A nunca puede leer/escribir B.
6. Resolver S07 con sincronización programada, monitoreo de frescura y alerta de token.
7. Solo entonces habilitar el CTA de conexión en producción.

## Pruebas de aceptación

- Sin sesión: 401.
- Usuario sin membresía: 403.
- Alumno A no obtiene filas, conexiones, tareas o métricas de B.
- A no puede insertar o mover registros al workspace de B.
- `state` inválido, vencido, reutilizado o concurrente falla cerrado.
- Ninguna respuesta, log, fuente o build contiene secretos.
- Desconectar A no afecta a Leo ni a B.
- La ingesta de A no altera totales, medianas o cachés de Leo.
- Iann y Leo conservan exactamente `n_piezas`, `n_en_ventana` y `snapshot` tras el backfill.

## Variables futuras (solo servidor)

- `META_APP_ID`
- `META_APP_SECRET`
- `META_OAUTH_REDIRECT_URI`
- Referencia a Vault/KMS para credenciales

Nunca usar prefijo `VITE_` para secretos OAuth.
