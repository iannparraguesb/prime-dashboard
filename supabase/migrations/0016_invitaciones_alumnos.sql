-- Codigos de invitacion para que un alumno cree su propia cuenta. Aditiva e
-- idempotente. Requiere 0013.
--
-- El registro abierto de Supabase Auth sigue DESACTIVADO: la cuenta la crea el
-- servidor con service_role despues de validar el codigo. Asi se mantiene la
-- regla de 0013: todo usuario fuera del equipo entro por invitacion.
--
--   * Se guarda solo el HASH del codigo. Nadie lo lee, ni siquiera admin.
--   * Un codigo sirve una vez, vence y se puede revocar mientras no se use.
--   * Reservar -> crear la cuenta -> confirmar. Si crear la cuenta falla, el
--     servidor libera la reserva; si el servidor se cae en el medio, la reserva
--     caduca sola a los 5 minutos y el codigo vuelve a servir.

create table if not exists public.invitacion_alumno (
  id           uuid primary key default gen_random_uuid(),
  codigo_hash  text not null unique check (codigo_hash ~ '^[0-9a-f]{64}$'),
  nota         text not null check (char_length(nota) between 1 and 120),
  creado_por   uuid not null,
  creado_en    timestamptz not null default now(),
  expira_en    timestamptz not null,
  reservado_en timestamptz,
  usado_por    uuid unique,
  usado_en     timestamptz,
  revocado_en  timestamptz
);

alter table public.invitacion_alumno enable row level security;
revoke all on public.invitacion_alumno from anon, authenticated;
-- Lectura por columnas: el hash queda fuera incluso para admin.
grant select (id, nota, creado_en, expira_en, reservado_en, usado_en, revocado_en) on public.invitacion_alumno to authenticated;

drop policy if exists invitacion_admin_lee on public.invitacion_alumno;
create policy invitacion_admin_lee on public.invitacion_alumno for select to authenticated
  using (exists (select 1 from public.usuario u where u.id = (select auth.uid()) and u.rol = 'admin'));

/* Admin: crear y revocar. Las escrituras van solo por estas funciones. */

create or replace function public.crear_invitacion_alumno(p_hash text, p_nota text, p_dias integer default 14)
returns table (id uuid, expira_en timestamptz) language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.usuario u where u.id = auth.uid() and u.rol = 'admin') then
    raise exception 'sin_permiso';
  end if;
  if p_hash !~ '^[0-9a-f]{64}$' then raise exception 'codigo_invalido'; end if;
  if p_dias is null or p_dias < 1 or p_dias > 60 then raise exception 'vigencia_invalida'; end if;
  return query
    insert into public.invitacion_alumno as i (codigo_hash, nota, creado_por, expira_en)
    values (p_hash, btrim(p_nota), auth.uid(), now() + make_interval(days => p_dias))
    returning i.id, i.expira_en;
end $$;
revoke all on function public.crear_invitacion_alumno(text, text, integer) from public, anon;
grant execute on function public.crear_invitacion_alumno(text, text, integer) to authenticated;

create or replace function public.revocar_invitacion_alumno(p_id uuid)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.usuario u where u.id = auth.uid() and u.rol = 'admin') then
    raise exception 'sin_permiso';
  end if;
  update public.invitacion_alumno set revocado_en = now()
    where id = p_id and usado_en is null and revocado_en is null;
  return found;
end $$;
revoke all on function public.revocar_invitacion_alumno(uuid) from public, anon;
grant execute on function public.revocar_invitacion_alumno(uuid) to authenticated;

/* Servidor (service_role): el registro. */

-- Atomico: dos registros concurrentes con el mismo codigo, gana uno.
create or replace function public.reservar_invitacion_alumno(p_hash text)
returns uuid language sql security definer set search_path = '' as $$
  update public.invitacion_alumno set reservado_en = now()
  where codigo_hash = p_hash
    and usado_en is null and revocado_en is null and expira_en > now()
    and (reservado_en is null or reservado_en < now() - interval '5 minutes')
  returning id
$$;

create or replace function public.confirmar_invitacion_alumno(p_id uuid, p_usuario uuid)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  update public.invitacion_alumno set usado_por = p_usuario, usado_en = now()
    where id = p_id and usado_en is null and reservado_en is not null;
  return found;
end $$;

create or replace function public.liberar_invitacion_alumno(p_id uuid)
returns void language sql security definer set search_path = '' as $$
  update public.invitacion_alumno set reservado_en = null where id = p_id and usado_en is null
$$;

revoke all on function public.reservar_invitacion_alumno(text) from public, anon, authenticated;
revoke all on function public.confirmar_invitacion_alumno(uuid, uuid) from public, anon, authenticated;
revoke all on function public.liberar_invitacion_alumno(uuid) from public, anon, authenticated;
grant execute on function public.reservar_invitacion_alumno(text) to service_role;
grant execute on function public.confirmar_invitacion_alumno(uuid, uuid) to service_role;
grant execute on function public.liberar_invitacion_alumno(uuid) to service_role;
