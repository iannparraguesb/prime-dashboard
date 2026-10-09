-- Alumnos: conexion de Instagram (Instagram Login) y acceso a SU contenido.
-- Aditiva e idempotente. Requiere 0008 y la extension supabase_vault.
--
-- Modelo de acceso:
--   * Equipo (filas en public.usuario): sin cambios. Sus policies `lectura_*`
--     con es_autorizado() siguen igual; ven todo.
--   * Alumno: usuario autenticado que NO esta en public.usuario y es miembro
--     activo de un workspace con una conexion de Instagram. Las policies nuevas
--     SOLO SUMAN lectura sobre las filas de su propia cuenta (cuenta_id = su
--     instagram_user_id). No ve anuncios, negocio, ideas, competencia ni otras
--     cuentas.
--
-- Tokens: en Supabase Vault. La tabla publica nunca los tiene. Solo funciones
-- security definer ejecutables por service_role los leen o escriben.

/* ---------------------------------------------------------------------------
   1. Cuentas que ve el alumno
   --------------------------------------------------------------------------- */

-- Se usa envuelta en (select ...) dentro de las policies: se evalua una vez por
-- consulta, no por fila. Para el equipo devuelve '{}' y la policy no suma nada.
create or replace function public.mis_cuentas_alumno()
returns text[] language sql stable security definer set search_path = '' as $$
  select coalesce(array_agg(c.instagram_user_id), '{}')
  from public.instagram_conexion c
  join public.workspace w on w.id = c.workspace_id and w.estado = 'activo' and w.tipo = 'alumno'
  join public.workspace_miembro m on m.workspace_id = c.workspace_id
  where m.usuario_id = auth.uid() and m.estado = 'activo'
    and c.estado in ('activa', 'vencida', 'error')
$$;
revoke all on function public.mis_cuentas_alumno() from public, anon;
grant execute on function public.mis_cuentas_alumno() to authenticated;

do $$
declare
  t text;
begin
  -- Tablas con cuenta_id (o id) directo.
  foreach t in array array['cuenta_metrica','pieza','historia','audiencia_snapshot'] loop
    execute format('drop policy if exists alumno_lee on public.%I', t);
    execute format('create policy alumno_lee on public.%I for select to authenticated
      using (cuenta_id in (select unnest(public.mis_cuentas_alumno())))', t);
  end loop;
end $$;

drop policy if exists alumno_lee on public.cuenta;
create policy alumno_lee on public.cuenta for select to authenticated
  using (id in (select unnest(public.mis_cuentas_alumno())));

drop policy if exists alumno_lee on public.pieza_metrica;
create policy alumno_lee on public.pieza_metrica for select to authenticated
  using (post_id in (select p.post_id from public.pieza p where p.cuenta_id in (select unnest(public.mis_cuentas_alumno()))));

drop policy if exists alumno_lee on public.pieza_pilar;
create policy alumno_lee on public.pieza_pilar for select to authenticated
  using (post_id in (select p.post_id from public.pieza p where p.cuenta_id in (select unnest(public.mis_cuentas_alumno()))));

drop policy if exists alumno_lee on public.historia_metrica;
create policy alumno_lee on public.historia_metrica for select to authenticated
  using (historia_id in (select h.historia_id from public.historia h where h.cuenta_id in (select unnest(public.mis_cuentas_alumno()))));

-- Parametros del analisis (piso de alcance, ventana) y nombres de pilares: no
-- son datos de nadie, el alumno los necesita para que su panel calcule igual.
drop policy if exists alumno_lee on public.config;
create policy alumno_lee on public.config for select to authenticated
  using (cardinality((select public.mis_cuentas_alumno())) > 0);
drop policy if exists alumno_lee on public.pilar;
create policy alumno_lee on public.pilar for select to authenticated
  using (cardinality((select public.mis_cuentas_alumno())) > 0);

/* ---------------------------------------------------------------------------
   2. Vistas por cuenta. Antes agregaban todas las cuentas visibles: con
   alumnos, los pilares de Leo se mezclarian con los de ellos.
   --------------------------------------------------------------------------- */

drop view if exists public.v_pilar_rendimiento;
create view public.v_pilar_rendimiento with (security_invoker = on) as
  select r.cuenta_id, pp.pilar,
    count(*) as n,
    percentile_cont(0.5) within group (order by r.tasa_guardado::double precision) as mediana_guardado,
    percentile_cont(0.5) within group (order by r.tasa_compartido::double precision) as mediana_compartido,
    percentile_cont(0.5) within group (order by r.alcance::double precision) as mediana_alcance
  from public.v_pieza_ranking r
  join public.pieza_pilar pp on pp.post_id = r.post_id
  where r.apto_ranking
  group by r.cuenta_id, pp.pilar;

drop view if exists public.v_efecto_palabra_clave;
create view public.v_efecto_palabra_clave with (security_invoker = on) as
  select cuenta_id, pide_palabra_clave,
    count(*) as n,
    percentile_cont(0.5) within group (order by tasa_guardado::double precision) as mediana_guardado,
    percentile_cont(0.5) within group (order by alcance::double precision) as mediana_alcance
  from public.v_pieza_ranking
  where apto_ranking and pide_palabra_clave is not null
  group by cuenta_id, pide_palabra_clave;

revoke all on public.v_pilar_rendimiento, public.v_efecto_palabra_clave from anon;
revoke insert, update, delete, truncate, references, trigger on public.v_pilar_rendimiento, public.v_efecto_palabra_clave from authenticated;
grant select on public.v_pilar_rendimiento, public.v_efecto_palabra_clave to authenticated;

/* ---------------------------------------------------------------------------
   3. Flujo OAuth
   --------------------------------------------------------------------------- */

-- Workspace del alumno: se crea en su primera conexion. El equipo no tiene
-- workspace de alumno: Leo se sincroniza por su propio camino.
create or replace function public.asegurar_workspace_alumno()
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  ws uuid;
begin
  if uid is null then raise exception 'sin_sesion'; end if;
  if exists (select 1 from public.usuario where id = uid) then raise exception 'cuenta_del_equipo'; end if;
  select m.workspace_id into ws
    from public.workspace_miembro m join public.workspace w on w.id = m.workspace_id
    where m.usuario_id = uid and m.estado = 'activo' and m.rol = 'propietario' and w.tipo = 'alumno'
    order by m.creado_en limit 1;
  if ws is not null then
    if (select estado from public.workspace where id = ws) <> 'activo' then raise exception 'workspace_suspendido'; end if;
    return ws;
  end if;
  insert into public.workspace (nombre, slug, tipo, creado_por)
    values (coalesce((select split_part(email, '@', 1) from auth.users where id = uid), 'Alumno'),
            'alumno-' || replace(uid::text, '-', ''), 'alumno', uid)
    returning id into ws;
  insert into public.workspace_miembro (workspace_id, usuario_id, rol, estado) values (ws, uid, 'propietario', 'activo');
  return ws;
end $$;
revoke all on function public.asegurar_workspace_alumno() from public, anon;
grant execute on function public.asegurar_workspace_alumno() to authenticated;

-- Guarda el HASH del state (nunca el state). Vence en 10 minutos.
create or replace function public.crear_estado_oauth(p_hash text, p_redirect text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  ws uuid := public.asegurar_workspace_alumno();
begin
  if p_hash !~ '^[0-9a-f]{64}$' then raise exception 'estado_invalido'; end if;
  delete from private.instagram_oauth_estado where expira_en < now() - interval '1 day';
  insert into private.instagram_oauth_estado (estado_hash, workspace_id, solicitado_por, redirect_uri, expira_en)
    values (p_hash, ws, auth.uid(), p_redirect, now() + interval '10 minutes');
end $$;
revoke all on function public.crear_estado_oauth(text, text) from public, anon;
grant execute on function public.crear_estado_oauth(text, text) to authenticated;

-- Consumo atomico: un state sirve una sola vez, solo para quien lo pidio y
-- solo dentro de los 10 minutos. Dos callbacks concurrentes: gana uno.
create or replace function public.consumir_estado_oauth(p_hash text, p_usuario uuid)
returns table (workspace_id uuid, redirect_uri text) language sql security definer set search_path = '' as $$
  update private.instagram_oauth_estado e set consumido_en = now()
  where e.estado_hash = p_hash and e.solicitado_por = p_usuario
    and e.consumido_en is null and e.expira_en > now()
  returning e.workspace_id, e.redirect_uri
$$;
revoke all on function public.consumir_estado_oauth(text, uuid) from public, anon, authenticated;
grant execute on function public.consumir_estado_oauth(text, uuid) to service_role;

-- Guarda (o renueva) la conexion. El instagram_user_id viene de Meta, nunca
-- del navegador: por eso solo service_role puede llamarla.
create or replace function public.guardar_conexion_instagram(
  p_workspace uuid, p_usuario uuid, p_ig text, p_username text, p_tipo text,
  p_token text, p_expira timestamptz, p_scopes text[])
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  con uuid;
  sec uuid;
begin
  if not exists (select 1 from public.workspace_miembro m join public.workspace w on w.id = m.workspace_id
                 where m.workspace_id = p_workspace and m.usuario_id = p_usuario and m.estado = 'activo'
                   and m.rol in ('propietario','admin') and w.tipo = 'alumno' and w.estado = 'activo') then
    raise exception 'sin_permiso';
  end if;
  if exists (select 1 from public.instagram_conexion where instagram_user_id = p_ig and workspace_id <> p_workspace) then
    raise exception 'cuenta_en_uso';
  end if;
  -- La cuenta de Leo (o cualquier cuenta del equipo / competencia) no se puede reclamar.
  if exists (select 1 from public.cuenta where id = p_ig and (es_propia or id like 'externa:%')) then
    raise exception 'cuenta_en_uso';
  end if;

  -- Una cuenta por workspace: si conecta otra, la anterior queda revocada.
  update public.instagram_conexion set estado = 'revocada', actualizado_en = now()
    where workspace_id = p_workspace and instagram_user_id <> p_ig and estado <> 'revocada';
  delete from vault.secrets where id in (
    select cr.secreto_id::uuid from private.instagram_credencial cr
    join public.instagram_conexion c on c.id = cr.conexion_id
    where c.workspace_id = p_workspace and c.instagram_user_id <> p_ig);
  delete from private.instagram_credencial where conexion_id in (
    select id from public.instagram_conexion where workspace_id = p_workspace and instagram_user_id <> p_ig);

  insert into public.instagram_conexion (workspace_id, instagram_user_id, username, tipo_cuenta, estado, conectada_por, token_expira_en, ultimo_error_publico)
    values (p_workspace, p_ig, p_username, p_tipo, 'activa', p_usuario, p_expira, null)
    on conflict (instagram_user_id) do update set username = excluded.username, tipo_cuenta = excluded.tipo_cuenta,
      estado = 'activa', token_expira_en = excluded.token_expira_en, ultimo_error_publico = null, actualizado_en = now()
    returning id into con;

  select secreto_id::uuid into sec from private.instagram_credencial where conexion_id = con;
  if sec is null then
    sec := vault.create_secret(p_token, 'instagram_' || con::text, 'Token de Instagram de un alumno');
    insert into private.instagram_credencial (conexion_id, secreto_id, scopes, expira_en) values (con, sec::text, p_scopes, p_expira);
  else
    perform vault.update_secret(sec, p_token);
    update private.instagram_credencial set scopes = p_scopes, expira_en = p_expira, rotada_en = now() where conexion_id = con;
  end if;

  insert into public.cuenta (id, username, es_propia) values (p_ig, p_username, false)
    on conflict (id) do update set username = excluded.username;
  return con;
end $$;
revoke all on function public.guardar_conexion_instagram(uuid, uuid, text, text, text, text, timestamptz, text[]) from public, anon, authenticated;
grant execute on function public.guardar_conexion_instagram(uuid, uuid, text, text, text, text, timestamptz, text[]) to service_role;

-- El alumno desconecta su propia cuenta: se borra el token; los datos quedan
-- archivados (sin acceso mientras la conexion este revocada).
create or replace function public.desconectar_instagram()
returns void language plpgsql security definer set search_path = '' as $$
declare
  ws uuid;
begin
  select m.workspace_id into ws from public.workspace_miembro m join public.workspace w on w.id = m.workspace_id
    where m.usuario_id = auth.uid() and m.estado = 'activo' and m.rol in ('propietario','admin') and w.tipo = 'alumno'
    limit 1;
  if ws is null then raise exception 'sin_permiso'; end if;
  delete from vault.secrets where id in (
    select cr.secreto_id::uuid from private.instagram_credencial cr
    join public.instagram_conexion c on c.id = cr.conexion_id where c.workspace_id = ws);
  delete from private.instagram_credencial where conexion_id in (select id from public.instagram_conexion where workspace_id = ws);
  update public.instagram_conexion set estado = 'revocada', actualizado_en = now() where workspace_id = ws;
end $$;
revoke all on function public.desconectar_instagram() from public, anon;
grant execute on function public.desconectar_instagram() to authenticated;

/* ---------------------------------------------------------------------------
   4. Worker de sincronizacion (GitHub Actions, service_role)
   --------------------------------------------------------------------------- */

create or replace function public.conexiones_para_sincronizar()
returns table (conexion_id uuid, instagram_user_id text, username text, token text,
               token_expira_en timestamptz, token_actualizado_en timestamptz)
language sql security definer set search_path = '' as $$
  select c.id, c.instagram_user_id, c.username, s.decrypted_secret, c.token_expira_en,
         coalesce(cr.rotada_en, cr.creado_en)
  from public.instagram_conexion c
  join public.workspace w on w.id = c.workspace_id and w.estado = 'activo'
  join private.instagram_credencial cr on cr.conexion_id = c.id
  join vault.decrypted_secrets s on s.id = cr.secreto_id::uuid
  where c.estado in ('activa', 'error')
$$;
revoke all on function public.conexiones_para_sincronizar() from public, anon, authenticated;
grant execute on function public.conexiones_para_sincronizar() to service_role;

create or replace function public.registrar_sincronizacion(
  p_conexion uuid, p_ok boolean, p_error text default null, p_token text default null, p_expira timestamptz default null)
returns void language plpgsql security definer set search_path = '' as $$
declare
  sec uuid;
begin
  if p_token is not null then
    select secreto_id::uuid into sec from private.instagram_credencial where conexion_id = p_conexion;
    perform vault.update_secret(sec, p_token);
    update private.instagram_credencial set expira_en = p_expira, rotada_en = now() where conexion_id = p_conexion;
    update public.instagram_conexion set token_expira_en = p_expira where id = p_conexion;
  end if;
  update public.instagram_conexion set
    ultima_sincronizacion = case when p_ok then now() else ultima_sincronizacion end,
    ultimo_error_publico = case when p_ok then null else left(p_error, 500) end,
    estado = case when p_ok then 'activa' when p_error like 'Tu conexión venció%' then 'vencida' else 'error' end,
    actualizado_en = now()
  where id = p_conexion and estado <> 'revocada';
end $$;
revoke all on function public.registrar_sincronizacion(uuid, boolean, text, text, timestamptz) from public, anon, authenticated;
grant execute on function public.registrar_sincronizacion(uuid, boolean, text, text, timestamptz) to service_role;
