-- Metas mensuales del negocio. Aditiva e idempotente.
--
-- Una fila por mes y metrica. Sin metas cargadas, el panel no muestra ninguna:
-- no hay una meta por defecto escrita en el codigo. Solo admin las lee y las
-- edita, igual que el resto de la pestaña Negocio.

create table if not exists public.meta_mensual (
  mes            date not null check (extract(day from mes) = 1),
  metrica        text not null check (metrica in ('ingresos_usd', 'ventas', 'agendas', 'asistieron', 'conversaciones')),
  objetivo       numeric not null check (objetivo > 0 and objetivo < 100000000),
  actualizado_en timestamptz not null default now(),
  actualizado_por uuid default auth.uid(),
  primary key (mes, metrica)
);

create or replace function public.meta_mensual_tocar() returns trigger language plpgsql as $$
begin
  new.actualizado_en := now();
  new.actualizado_por := auth.uid();
  return new;
end $$;
drop trigger if exists meta_mensual_tocar on public.meta_mensual;
create trigger meta_mensual_tocar before insert or update on public.meta_mensual
  for each row execute function public.meta_mensual_tocar();

alter table public.meta_mensual enable row level security;
revoke all on public.meta_mensual from anon;
revoke truncate, references, trigger on public.meta_mensual from authenticated;
grant select, insert, update, delete on public.meta_mensual to authenticated;

do $$
declare
  accion text;
begin
  foreach accion in array array['select', 'insert', 'update', 'delete'] loop
    execute format('drop policy if exists %I on public.meta_mensual', 'meta_mensual_admin_' || accion);
  end loop;
end $$;

create policy meta_mensual_admin_select on public.meta_mensual for select to authenticated
  using (exists (select 1 from public.usuario u where u.id = (select auth.uid()) and u.rol = 'admin'));
create policy meta_mensual_admin_insert on public.meta_mensual for insert to authenticated
  with check (exists (select 1 from public.usuario u where u.id = (select auth.uid()) and u.rol = 'admin'));
create policy meta_mensual_admin_update on public.meta_mensual for update to authenticated
  using (exists (select 1 from public.usuario u where u.id = (select auth.uid()) and u.rol = 'admin'))
  with check (exists (select 1 from public.usuario u where u.id = (select auth.uid()) and u.rol = 'admin'));
create policy meta_mensual_admin_delete on public.meta_mensual for delete to authenticated
  using (exists (select 1 from public.usuario u where u.id = (select auth.uid()) and u.rol = 'admin'));
