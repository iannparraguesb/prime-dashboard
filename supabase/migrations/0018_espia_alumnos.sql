-- Espia para alumnos: cada alumno elige sus propios competidores.
-- Aditiva e idempotente. Requiere 0008 y 0013.
--
-- Se puede aplicar ANTES de desplegar el codigo: para el equipo no cambia nada
-- (sus filas quedan con workspace_id nulo, que es "lista del equipo").
--
-- Modelo:
--   * cuenta_vigilada gana un dueño: workspace_id nulo = lista del equipo;
--     con valor = lista de ese alumno. El dueño lo pone la base a partir de la
--     sesion, nunca el navegador.
--   * El tope de 5 activos y el "no repetir cuenta" pasan a ser POR DUEÑO.
--   * Los datos de una cuenta ajena (cuenta `externa:<usuario>`, sus piezas y
--     metricas) siguen guardandose una sola vez. Un alumno los lee solo
--     mientras vigile esa cuenta: quitarla le corta la lectura.
--
-- El DDL original de cuenta_vigilada no esta en el repo (hallazgo A-01), asi
-- que esta migracion no asume nombres de constraints, triggers ni policies:
-- los busca en el catalogo, y el aislamiento va en una policy RESTRICTIVA que
-- se suma con AND a las que ya existan.

begin;

/* ---------------------------------------------------------------------------
   1. Dueño de cada fila
   --------------------------------------------------------------------------- */

alter table public.cuenta_vigilada
  add column if not exists workspace_id uuid references public.workspace(id) on delete cascade;
create index if not exists cuenta_vigilada_workspace on public.cuenta_vigilada(workspace_id)
  where workspace_id is not null;

-- El usuario termina dentro de una consulta a la API de Instagram: solo el
-- formato que Instagram acepta. `not valid` no revisa las filas viejas (ya
-- cumplen: verificado en produccion el 2026-11-16) pero si toda escritura nueva.
do $$
begin
  if not exists (select 1 from pg_constraint
                 where conrelid = 'public.cuenta_vigilada'::regclass and conname = 'cuenta_vigilada_username_formato') then
    alter table public.cuenta_vigilada
      add constraint cuenta_vigilada_username_formato check (username ~ '^[a-z0-9._]{1,30}$') not valid;
  end if;
end $$;

-- Workspace del alumno que mira. Nulo para el equipo, para quien no tiene
-- Instagram conectado y para un workspace suspendido: las mismas condiciones
-- que mis_cuentas_alumno() (0013), para que desconectar corte tambien Espia.
create or replace function public.mi_workspace_alumno()
returns uuid language sql stable security definer set search_path = '' as $$
  select m.workspace_id
  from public.workspace_miembro m
  join public.workspace w on w.id = m.workspace_id and w.estado = 'activo' and w.tipo = 'alumno'
  where m.usuario_id = auth.uid() and m.estado = 'activo'
    and not exists (select 1 from public.usuario u where u.id = auth.uid())
    and exists (select 1 from public.instagram_conexion c
                where c.workspace_id = m.workspace_id and c.estado in ('activa', 'vencida', 'error'))
  order by m.creado_en, m.workspace_id
  limit 1
$$;
revoke all on function public.mi_workspace_alumno() from public, anon;
grant execute on function public.mi_workspace_alumno() to authenticated;

/* ---------------------------------------------------------------------------
   2. Unicidad y tope por dueño
   --------------------------------------------------------------------------- */

-- Antes el usuario era unico en toda la tabla: dos alumnos no podian vigilar
-- la misma cuenta, ni un alumno una que ya vigilara Leo.
do $$
declare
  r record;
begin
  for r in
    select i.indexrelid::regclass::text as indice, c.conname
    from pg_index i
    left join pg_constraint c on c.conindid = i.indexrelid and c.conrelid = i.indrelid
    where i.indrelid = 'public.cuenta_vigilada'::regclass
      and i.indisunique and not i.indisprimary
      and pg_get_indexdef(i.indexrelid) ilike '%username%'
      and pg_get_indexdef(i.indexrelid) not ilike '%workspace_id%'
  loop
    if r.conname is not null then
      execute format('alter table public.cuenta_vigilada drop constraint %I', r.conname);
    else
      execute format('drop index %s', r.indice);
    end if;
  end loop;
end $$;

create unique index if not exists cuenta_vigilada_dueno_username
  on public.cuenta_vigilada ((coalesce(workspace_id, '00000000-0000-0000-0000-000000000000'::uuid)), username);

-- Una sola funcion para las dos reglas que dependen de quien escribe.
create or replace function public.cuenta_vigilada_reglas()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  n integer;
begin
  -- Sin sesion escribe la ingesta (service_role) o el editor SQL: se respeta
  -- lo que traiga la fila.
  if uid is not null then
    if tg_op = 'UPDATE' then
      new.workspace_id := old.workspace_id;
    elsif exists (select 1 from public.usuario u where u.id = uid) then
      new.workspace_id := null;
    else
      new.workspace_id := public.mi_workspace_alumno();
      -- agregada_por referencia a `usuario`, y un alumno no esta ahi.
      new.agregada_por := null;
      if new.workspace_id is null then
        raise exception 'sin_workspace' using errcode = '42501';
      end if;
    end if;
  end if;

  if new.activa and (tg_op = 'INSERT' or not old.activa) then
    -- Dos altas simultaneas del mismo dueño se ponen en fila: sin esto ambas
    -- cuentan 4 y entran las dos.
    perform pg_advisory_xact_lock(hashtext('cuenta_vigilada:' || coalesce(new.workspace_id::text, 'equipo')));
    select count(*) into n from public.cuenta_vigilada v
      where v.activa and v.id <> new.id and v.workspace_id is not distinct from new.workspace_id;
    if n >= 5 then
      raise exception 'Tope de 5 competidores activos';
    end if;
  end if;
  return new;
end $$;
revoke all on function public.cuenta_vigilada_reglas() from public, anon, authenticated;

-- El trigger anterior contaba los activos de toda la tabla: con la lista de
-- Leo llena, ningun alumno habria podido agregar. Se reconoce por su mensaje,
-- que es el que el servidor traduce ("Tope de ...").
do $$
declare
  r record;
begin
  for r in
    select t.tgname
    from pg_trigger t join pg_proc p on p.oid = t.tgfoid
    where t.tgrelid = 'public.cuenta_vigilada'::regclass and not t.tgisinternal
      and p.prosrc ilike '%tope de%'
  loop
    execute format('drop trigger %I on public.cuenta_vigilada', r.tgname);
  end loop;
end $$;

drop trigger if exists cuenta_vigilada_reglas on public.cuenta_vigilada;
create trigger cuenta_vigilada_reglas before insert or update on public.cuenta_vigilada
  for each row execute function public.cuenta_vigilada_reglas();

/* ---------------------------------------------------------------------------
   3. Quien ve y quien escribe cada lista
   --------------------------------------------------------------------------- */

alter table public.cuenta_vigilada enable row level security;
revoke all on public.cuenta_vigilada from anon;
grant select, insert, update on public.cuenta_vigilada to authenticated;

-- RESTRICTIVA: se cumple ademas de cualquier policy que ya exista. El equipo
-- queda limitado a su lista y cada alumno a la suya, aunque una policy vieja
-- sea mas abierta de lo que se cree.
drop policy if exists cuenta_vigilada_ambito on public.cuenta_vigilada;
create policy cuenta_vigilada_ambito on public.cuenta_vigilada as restrictive for all to authenticated
  using (case when workspace_id is null then (select public.es_autorizado())
              else workspace_id = (select public.mi_workspace_alumno()) end)
  with check (case when workspace_id is null then (select public.es_autorizado())
                   else workspace_id = (select public.mi_workspace_alumno()) end);

-- El alumno lee, agrega y actualiza (quitar = desactivar) su lista. No borra.
drop policy if exists alumno_lee on public.cuenta_vigilada;
create policy alumno_lee on public.cuenta_vigilada for select to authenticated
  using (workspace_id = (select public.mi_workspace_alumno()));
drop policy if exists alumno_agrega on public.cuenta_vigilada;
create policy alumno_agrega on public.cuenta_vigilada for insert to authenticated
  with check (workspace_id = (select public.mi_workspace_alumno()));
drop policy if exists alumno_actualiza on public.cuenta_vigilada;
create policy alumno_actualiza on public.cuenta_vigilada for update to authenticated
  using (workspace_id = (select public.mi_workspace_alumno()))
  with check (workspace_id = (select public.mi_workspace_alumno()));

/* ---------------------------------------------------------------------------
   4. Lectura de los datos de las cuentas que el alumno vigila
   --------------------------------------------------------------------------- */

-- Solo las activas: quitar un competidor corta la lectura de sus datos.
create or replace function public.mis_cuentas_espia()
returns text[] language sql stable security definer set search_path = '' as $$
  select coalesce(array_agg('externa:' || v.username), '{}')
  from public.cuenta_vigilada v
  where v.activa and v.workspace_id = public.mi_workspace_alumno()
$$;
revoke all on function public.mis_cuentas_espia() from public, anon;
grant execute on function public.mis_cuentas_espia() to authenticated;

-- Son datos publicos de Instagram (likes y comentarios): no hay alcance ni
-- guardados de cuentas ajenas. El prefijo `externa:` garantiza que por aca no
-- se llega a la cuenta de Leo ni a la de otro alumno, que usan su id numerico.
drop policy if exists alumno_espia on public.cuenta;
create policy alumno_espia on public.cuenta for select to authenticated
  using (id in (select unnest(public.mis_cuentas_espia())));

drop policy if exists alumno_espia on public.cuenta_metrica;
create policy alumno_espia on public.cuenta_metrica for select to authenticated
  using (cuenta_id in (select unnest(public.mis_cuentas_espia())));

drop policy if exists alumno_espia on public.pieza;
create policy alumno_espia on public.pieza for select to authenticated
  using (cuenta_id in (select unnest(public.mis_cuentas_espia())));

drop policy if exists alumno_espia on public.pieza_metrica;
create policy alumno_espia on public.pieza_metrica for select to authenticated
  using (post_id in (select p.post_id from public.pieza p
                     where p.cuenta_id in (select unnest(public.mis_cuentas_espia()))));

commit;
