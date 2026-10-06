-- Multiusuario y conexión segura de Instagram.
-- FASE A, aditiva: crea el modelo de tenancy sin reasignar todavía las filas
-- históricas ni abrir el dashboard a alumnos. No reejecuta 0001.

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create table if not exists public.workspace (
  id uuid primary key default gen_random_uuid(),
  nombre text not null check (char_length(nombre) between 1 and 120),
  slug text not null unique check (slug ~ '^[a-z0-9][a-z0-9-]{1,62}$'),
  tipo text not null default 'alumno' check (tipo in ('interno','alumno')),
  estado text not null default 'activo' check (estado in ('activo','suspendido','archivado')),
  creado_por uuid references auth.users(id),
  creado_en timestamptz not null default now()
);

create table if not exists public.workspace_miembro (
  workspace_id uuid not null references public.workspace(id) on delete cascade,
  usuario_id uuid not null references auth.users(id) on delete cascade,
  rol text not null check (rol in ('propietario','admin','contenido','lectura')),
  estado text not null default 'activo' check (estado in ('invitado','activo','deshabilitado')),
  creado_en timestamptz not null default now(),
  primary key (workspace_id, usuario_id)
);
create index if not exists workspace_miembro_usuario on public.workspace_miembro(usuario_id, workspace_id) where estado = 'activo';

create table if not exists public.instagram_conexion (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspace(id) on delete cascade,
  instagram_user_id text not null unique,
  username text,
  tipo_cuenta text,
  estado text not null default 'pendiente' check (estado in ('pendiente','activa','vencida','revocada','error')),
  conectada_por uuid not null references auth.users(id),
  token_expira_en timestamptz,
  ultima_sincronizacion timestamptz,
  ultimo_error_publico text check (char_length(ultimo_error_publico) <= 500),
  creado_en timestamptz not null default now(),
  actualizado_en timestamptz not null default now()
);
create index if not exists instagram_conexion_workspace on public.instagram_conexion(workspace_id);

-- Fuera del esquema public/PostgREST: solo workers o callbacks privilegiados.
create table if not exists private.instagram_credencial (
  conexion_id uuid primary key references public.instagram_conexion(id) on delete cascade,
  secreto_id text not null,
  scopes text[] not null default '{}',
  expira_en timestamptz,
  version_clave integer not null default 1,
  rotada_en timestamptz,
  creado_en timestamptz not null default now()
);
revoke all on private.instagram_credencial from public, anon, authenticated;

create table if not exists private.instagram_oauth_estado (
  estado_hash text primary key,
  workspace_id uuid not null references public.workspace(id) on delete cascade,
  solicitado_por uuid not null references auth.users(id),
  redirect_uri text not null,
  expira_en timestamptz not null,
  consumido_en timestamptz,
  creado_en timestamptz not null default now()
);
revoke all on private.instagram_oauth_estado from public, anon, authenticated;
create index if not exists instagram_oauth_estado_expira on private.instagram_oauth_estado(expira_en);

create or replace function public.es_miembro_workspace(objetivo uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.workspace_miembro m
    where m.workspace_id = objetivo and m.usuario_id = auth.uid() and m.estado = 'activo'
  )
$$;

create or replace function public.administra_workspace(objetivo uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.workspace_miembro m
    where m.workspace_id = objetivo and m.usuario_id = auth.uid()
      and m.estado = 'activo' and m.rol in ('propietario','admin')
  )
$$;
revoke all on function public.es_miembro_workspace(uuid) from public;
revoke all on function public.administra_workspace(uuid) from public;
grant execute on function public.es_miembro_workspace(uuid), public.administra_workspace(uuid) to authenticated;

alter table public.workspace enable row level security;
alter table public.workspace_miembro enable row level security;
alter table public.instagram_conexion enable row level security;
revoke all on public.workspace from anon;
revoke all on public.workspace_miembro from anon;
revoke all on public.instagram_conexion from anon;
grant select on public.workspace, public.workspace_miembro, public.instagram_conexion to authenticated;

-- Postgres no tiene `create policy if not exists`: sin el drop previo, aplicar
-- la migracion dos veces (reintento, entorno nuevo) falla en la segunda vuelta.
drop policy if exists workspace_leer_miembro on public.workspace;
create policy workspace_leer_miembro on public.workspace for select to authenticated
  using (public.es_miembro_workspace(id));
drop policy if exists miembro_leer_workspace on public.workspace_miembro;
create policy miembro_leer_workspace on public.workspace_miembro for select to authenticated
  using (public.es_miembro_workspace(workspace_id));
drop policy if exists conexion_leer_miembro on public.instagram_conexion;
create policy conexion_leer_miembro on public.instagram_conexion for select to authenticated
  using (public.es_miembro_workspace(workspace_id));
-- El navegador no crea ni cambia conexiones. OAuth, rotación y desconexión pasan
-- por endpoints de servidor que validan state, membresía y rol.

create or replace view public.v_instagram_conexion with (security_invoker = true) as
select id, workspace_id, instagram_user_id, username, tipo_cuenta, estado,
       token_expira_en, ultima_sincronizacion, ultimo_error_publico,
       conectada_por, creado_en, actualizado_en
from public.instagram_conexion;
grant select on public.v_instagram_conexion to authenticated;

-- FASE B (otra migración, solo después de backfill verificado):
-- 1. Crear el workspace interno y sus membresías por UUID.
-- 2. Añadir workspace_id nullable a cuenta y tablas derivadas.
-- 3. Backfill por cuenta/conexión y verificar cero filas huérfanas.
-- 4. Recrear las vistas con workspace_id + security_invoker.
-- 5. Reemplazar las policies históricas using(true) por es_miembro_workspace.
-- 6. Recién entonces set not null y habilitar onboarding de alumnos.
