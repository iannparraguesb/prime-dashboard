-- Ampliación aditiva del dashboard interno. Requiere la tabla usuario existente.
-- Aplicar tras recuperar el baseline real; no reejecutar 0001 en producción.
create table if not exists public.dashboard_tarea (
  id uuid primary key default gen_random_uuid(),
  usuario_id uuid not null references auth.users(id) on delete cascade,
  titulo text not null check (char_length(titulo) between 1 and 160),
  nota text check (char_length(nota) <= 2000),
  fecha date,
  estado text not null default 'pendiente' check (estado in ('pendiente','en_produccion','publicada')),
  pieza_id text,
  archivada boolean not null default false,
  creado_en timestamptz not null default now()
);
create index if not exists dashboard_tarea_usuario on public.dashboard_tarea(usuario_id, archivada, fecha);
alter table public.dashboard_tarea enable row level security;
revoke all on public.dashboard_tarea from anon;
grant select, insert, update on public.dashboard_tarea to authenticated;
drop policy if exists tarea_propia on public.dashboard_tarea;
create policy tarea_propia on public.dashboard_tarea for all to authenticated
  using (usuario_id = (select auth.uid()) and exists (select 1 from public.usuario u where u.id = (select auth.uid())))
  with check (usuario_id = (select auth.uid()) and exists (select 1 from public.usuario u where u.id = (select auth.uid())));
-- No se concede DELETE: archivar conserva la posibilidad de recuperación.
