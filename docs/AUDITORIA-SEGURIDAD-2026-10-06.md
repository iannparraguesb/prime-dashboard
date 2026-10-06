# Auditoría de seguridad — Prime Dashboard

**Fecha:** 6 de octubre de 2026 · **Auditor:** Claude Code · **Responsable de cuentas:** Iann

**Alcance:** código de `prime-dashboard` (servidor, frontend, migraciones, CI), base Supabase de producción
(`vqeaicwojsmcelgcuuuh`), Storage, Auth, historial Git de `prime-dashboard` y del workspace `Prime club`,
dependencias y scripts de ingesta (`Prime club/tools/*.py`).

**Método:** evidencia directa. Las pruebas contra producción fueron **no destructivas**: lecturas, y escrituras
con filtros que no coinciden con ninguna fila o que reescriben una fila con su mismo valor. No se modificaron datos.
No se hicieron pruebas de carga ni de denegación de servicio.

**Veredicto:** apto para producción **interna** (Iann y Leo) una vez aplicada la `0010` y cerrado el registro
abierto. **No apto todavía para alumnos**: faltan A-01, el flujo OAuth y la ingesta alojada.

---

## Resumen

| Severidad | Abiertos | Corregidos hoy |
|---|---|---|
| Crítica | 0 | 0 |
| Alta | 1 | 0 |
| Media | 4 | 1 (pendiente de aplicar) |
| Baja | 2 | 2 |
| Informativa | 2 | — |

## Controles verificados que funcionan

| Control | Evidencia |
|---|---|
| `anon` no obtiene datos | 0 filas en las 28 tablas y vistas expuestas; `permission denied` en las 5 multiusuario |
| Tokens fuera de la API | `private.instagram_credencial` y `private.instagram_oauth_estado` → 404, también con `Accept-Profile: private` (406) |
| Aislamiento entre alumnos | 14 pruebas contra Postgres real (PGlite) validadas con 7 mutaciones; corren en CI |
| Escritura bloqueada en tablas multiusuario | Usuario logueado: `permission denied` (403) en insert/update/delete — migración 0009 |
| Servidor sin privilegios | `server.mjs` no usa `service_role`; reenvía el JWT del usuario y RLS decide |
| Identidad antes del trabajo | JWT validado contra `/auth/v1/user` y lista blanca antes de cualquier consulta; 401/403 |
| Rol de lectura respetado | `/api/competidores` rechaza escrituras con rol `lectura` (403) |
| Rate limit falla cerrado | Sin Upstash en Vercel devuelve 503; por IP (120/min) antes de la identidad y por usuario (60 lect./15 escr.) después |
| Entradas acotadas | Body máximo 16 KiB (413), longitudes y UUID validados |
| Cabeceras | CSP, HSTS, `nosniff`, `frame-ancestors 'none'`, `Referrer-Policy`; `no-store` en `/api` |
| Errores sin detalle de proveedor | Mensajes públicos breves con ID de incidente; el log no guarda cuerpos ni URLs |
| Secretos fuera de Git | 0 tokens, claves o contraseñas en **todo el historial** de ambos repos (1.225 objetos) ni en `dist/` |
| Storage no listable ni escribible por anon | Listar → `[]`; subir → `violates row-level security` |
| Logs de cron | Sin tokens volcados |

---

## Hallazgos

### A-01 · Alta · La seguridad real no es reproducible desde el repositorio · ABIERTO

`supabase/migrations/0001_esquema_contenido.sql:292` concede `TO anon, authenticated USING (true)` en las tablas
base. Producción no se comporta así (anon recibe 0 filas), porque la lista blanca, sus funciones y las policies
vigentes se aplicaron a mano y **no están en el repo**. Tampoco está el DDL de `cuenta_vigilada`, `usuario`,
`dashboard_tarea`, las vistas de anuncios ni el cuerpo de las vistas de `0006` (quedó como comentario).

**Impacto:** un entorno nuevo, una restauración o un migrador automático reaplicando `0001` reabre lectura pública.

**Remediación:** extraer el esquema vivo (`pg_dump --schema-only` o `supabase db pull` con la cadena de conexión),
versionarlo como migración base, eliminar las policies `USING (true)` y montar una prueba que recree la base desde
cero en PGlite y verifique que anon no lee nada. Requiere `SUPABASE_DB_URL` en el `.env` (ver checklist §0).

### A-02 · Media · Tablas históricas con una sola capa de protección · CORREGIDO Y APLICADO 2026-10-06

El usuario de rol `lectura` tenía privilegio `INSERT/UPDATE/DELETE` en 13 tablas (concesión por defecto de
Supabase). RLS lo frenaba (update → 0 filas, insert → `violates row-level security`), pero era la única barrera.

**Remediación:** `supabase/migrations/0010_endurecer_permisos_tablas_historicas.sql` revoca escritura a `anon` y
`authenticated` y toda lectura a `anon`, excepto en `cuenta_vigilada` y `dashboard_tarea`, que son las únicas donde
escribe el panel. Probada en réplica: idempotente; competidores, plan e ingesta siguen funcionando.

### A-03 · Media · Registro abierto en Supabase Auth · CORREGIDO 2026-10-06

`/auth/v1/settings` → `disable_signup: false`. Cualquiera puede crear una cuenta con correo. Exige confirmación y la
lista blanca impide ver datos, pero cada cuenta creada obtiene un JWT `authenticated` y queda a una policy mal escrita
de leer algo. El modelo del producto es por invitación.

**Remediación:** Supabase → Authentication → Sign In / Providers → desactivar **Allow new users to sign up**. Las
cuentas de alumnos se crean por invitación desde el servidor.

### A-04 · Media · Bucket `miniaturas` público · ABIERTO (bloquea alumnos)

Las URLs de miniaturas son permanentes y no requieren sesión. Hoy contiene portadas de publicaciones públicas de
Leo y competidores: riesgo bajo. Con alumnos, quien conserve una URL mantiene acceso tras logout o desconexión.

**Remediación:** antes de alumnos, bucket privado con policies por workspace y URLs firmadas de corta duración.

### A-05 · Media · La ingesta depende del Mac de Iann · ABIERTO

`cron` no puede leer `~/Desktop` (TCC de macOS): historias y competencia no se capturaron entre el 30 de agosto y el
22 de septiembre. Es un problema de **disponibilidad**, no de confidencialidad, pero en producción el panel muestra
datos viejos sin avisar.

**Remediación inmediata:** Acceso total al disco para `/usr/sbin/cron`. **Definitiva:** cron de Vercel por cuenta
conectada, con estado de frescura visible y alerta de token.

### A-06 · Media · Almacenamiento de tokens OAuth sin implementar · ABIERTO (diseño)

El esquema `private` no está expuesto por PostgREST, así que el callback no puede escribir el token aunque use
`service_role`. **Remediación:** funciones `security definer` en `public` con `execute` solo para `service_role`, y
el token cifrado en Supabase Vault. Es el primer bloque del paso 2.

### A-07 · Baja · Permisos de archivo de `.env` · CORREGIDO

Los tres `.env`/`.env.local` eran `644` (legibles por cualquier usuario local). Ahora `600`.

### A-08 · Baja · Dependencia de desarrollo vulnerable · CORREGIDO

`source-map-js` (alta, solo desarrollo, no llega al build). `npm audit fix`: 0 vulnerabilidades, build y 50 pruebas OK.

### A-09 · Baja · Token de Instagram en la query string · ABIERTO

`tools/ig_competencia.py:84` y los demás scripts pasan `access_token` en la URL, que puede quedar en logs de
proxies. **Remediación:** enviarlo en la cabecera `Authorization: Bearer`, que la Graph API acepta.

### A-10 · Informativa · Datos de pauta versionados en `Prime club`

12 archivos de `data/` (insights de Meta, públicos personalizados, píxeles) están en Git. El repo **no tiene remoto**,
así que no están expuestos. Si algún día se publica, sacarlos antes con `git rm --cached` y reescritura de historial.
`data/` no está en `.gitignore`.

### A-11 · Informativa · Rate limit por IP sin cabecera

Si `x-vercel-forwarded-for` faltara, todas las peticiones compartirían el bucket `unknown`. En Vercel la cabecera
siempre llega; queda anotado para cualquier otro hosting.

---

## Checklist hasta producción

Responsables: **Claude Code** construye, prueba, commitea y aplica; **Iann** hace lo que exige su cuenta o su decisión.

### §0 · Habilitar a Claude Code (Iann)

- [ ] Agregar `SUPABASE_DB_URL` al `.env` de `Prime club` (Project Settings → Database → Connection string → URI).
      Desbloquea A-01 y que las migraciones las aplique Claude Code sin copiar y pegar.
- [x] Autorizar a Claude Code a hacer commit y push en `prime-dashboard` (ya no ejecuta Codex).

### §1 · Producción interna (Iann y Leo)

- [x] **Iann** — aplicar `0010` en el SQL Editor · verificado: escritura del navegador → 403 en las 13 tablas
- [x] **Iann** — desactivar registro abierto (A-03) · verificado: `disable_signup: true`
- [ ] **Iann** — Acceso total al disco para `/usr/sbin/cron` (A-05)
- [x] **Claude Code** — commit de lo pendiente (`fcde5e2`, `a4649cb`): migraciones 0008–0010, pruebas multiusuario, arreglos de
      `theme.css` y `Login.tsx`, README, `docs/`, `package.json`
- [ ] **Claude Code** — decidir con Iann qué hacer con `src/views/Competencia.tsx` (cambio sin commitear de origen
      desconocido), `.agents/`, `.claude/`, `skills-lock.json` y `PROMPT-CODEX-DESPLIEGUE.md`
- [x] Upstash conectado por la integración de Vercel (`KV_REST_API_*`; el código ahora acepta ese nombre)
- [x] Proyecto en Vercel con variables de Supabase solo en Production · desplegado en `https://prime-dashboard-gamma.vercel.app`
- [x] **Claude Code** — tres puertas: `/api/health` 200 · `/api/salud` sin sesión 401 · producción = base (172 en ventana)
- [ ] **Iann** — vincular la cuenta de GitHub `iannparraguesb` en Vercel → Account Settings → Authentication. Hasta
      entonces los despliegues por `git push` quedan *Blocked* (autor sin permiso) y se despliega por CLI sin Git
- [ ] **Iann** — comprar dominio y conectarlo · **Claude Code** verifica HSTS y CSP en el dominio
- [ ] **Claude Code** — mover el token de Instagram a cabecera (A-09)
- [ ] **Iann** — renovar el token de Instagram antes del **29 de octubre**

### §2 · Base para alumnos

- [ ] **Claude Code** — A-01: esquema vivo versionado, `USING (true)` eliminado, prueba de base desde cero
- [ ] **Claude Code** — Fase B: workspace interno, Iann y Leo como miembros, `workspace_id` en tablas de datos, backfill
      con paridad exacta de cifras del panel
- [ ] **Claude Code** — Fase C: policies de datos por `es_miembro_workspace`, `workspace_id not null`
- [ ] **Claude Code** — A-04: bucket privado y URLs firmadas

### §3 · Conexión de Instagram

- [ ] **Iann** — app de Meta con *Instagram API with Instagram Login*; `META_APP_ID` y el secret de Instagram
- [ ] **Iann** — registrar `https://<dominio>/api/instagram/callback`
- [ ] **Claude Code** — A-06: RPCs `security definer` solo para `service_role` + token en Vault
- [ ] **Claude Code** — Conectar → callback con `state` de un uso (hash, 10 min) → token de larga duración →
      renovación antes de 60 días → desconectar y borrar
- [ ] **Claude Code** — pruebas: `state` vencido, reutilizado o concurrente falla cerrado; ninguna respuesta ni log
      contiene tokens
- [ ] **Claude Code** — callbacks de desautorización y borrado de datos con verificación de firma

### §4 · Automático, sin depender de nosotros

- [ ] **Claude Code** — cron de Vercel: sincronización incremental por conexión, lotes acotados, lock por conexión
- [ ] **Claude Code** — frescura visible ("datos actualizados el…"), alerta de token por vencer, estado por fuente
- [ ] **Claude Code** — retirar la dependencia de `ig_dump.py` en el Mac

### §5 · Apertura a alumnos

- [ ] **Iann** — política de privacidad, términos y procedimiento de borrado publicados en el dominio
- [ ] **Iann** — verificación de negocio y App Review de Meta (2–4 semanas; empezar en §3)
- [ ] **Claude Code** — piloto con 3–5 alumnos cargados como testers de la app
- [ ] **Claude Code** — re-auditoría con dos alumnos reales antes de abrir a todos

---

## Riesgo residual aceptado para producción interna

Con §1 completo, el riesgo restante es A-01 (reproducibilidad) y A-04 (miniaturas públicas de contenido ya público).
Ninguno expone datos hoy: anon no lee nada en producción y las miniaturas son portadas de posts públicos. Ambos deben
cerrarse antes de que entre el primer alumno.
