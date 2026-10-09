-- Banco de ideas de la Mesa de trabajo. Aditiva e idempotente.
--
-- Una sola lista compartida (no por usuario): Leo e Iann trabajan el mismo banco.
--   * LECTURA: cualquier usuario del panel (public.usuario).
--   * ESCRITURA: solo rol 'admin'. Sin DELETE: descartar es un estado, asi una
--     sugerencia descartada no vuelve a aparecer y nada se pierde.
--
-- `clave_sugerencia` identifica una idea generada por el panel (p. ej.
-- "propia:carrusel:17912345"). Es unica: guardar o descartar la misma sugerencia
-- dos veces no duplica filas.

create table if not exists public.idea (
  id uuid primary key default gen_random_uuid(),
  titulo text not null check (char_length(titulo) between 1 and 200),
  formato text not null check (formato in ('historia','carrusel','reel','post')),
  estado text not null default 'idea' check (estado in ('idea','en_produccion','lista','publicada','descartada')),
  hook text check (char_length(hook) <= 300),
  nota text check (char_length(nota) <= 3000),
  origen text not null default 'manual' check (origen in ('manual','sugerida','propia','competencia')),
  motivo text check (char_length(motivo) <= 500),
  clave_sugerencia text unique check (char_length(clave_sugerencia) <= 160),
  referencia_url text check (referencia_url ~ '^https://'),
  referencia_thumb text check (referencia_thumb ~ '^https://'),
  referencia_cuenta text check (char_length(referencia_cuenta) <= 60),
  fecha_plan date,
  creado_por uuid references auth.users(id) on delete set null default auth.uid(),
  creado_en timestamptz not null default now(),
  actualizado_en timestamptz not null default now()
);
create index if not exists idea_estado on public.idea(estado, actualizado_en desc);

create or replace function public.idea_tocar() returns trigger language plpgsql as $$
begin
  new.actualizado_en := now();
  return new;
end $$;
drop trigger if exists idea_tocar on public.idea;
create trigger idea_tocar before update on public.idea for each row execute function public.idea_tocar();

alter table public.idea enable row level security;
revoke all on public.idea from anon;
revoke delete, truncate, references, trigger on public.idea from authenticated;
grant select, insert, update on public.idea to authenticated;

drop policy if exists idea_lee on public.idea;
create policy idea_lee on public.idea for select to authenticated
  using (exists (select 1 from public.usuario u where u.id = (select auth.uid())));

drop policy if exists idea_admin_crea on public.idea;
create policy idea_admin_crea on public.idea for insert to authenticated
  with check (exists (select 1 from public.usuario u where u.id = (select auth.uid()) and u.rol = 'admin'));

drop policy if exists idea_admin_edita on public.idea;
create policy idea_admin_edita on public.idea for update to authenticated
  using (exists (select 1 from public.usuario u where u.id = (select auth.uid()) and u.rol = 'admin'))
  with check (exists (select 1 from public.usuario u where u.id = (select auth.uid()) and u.rol = 'admin'));
