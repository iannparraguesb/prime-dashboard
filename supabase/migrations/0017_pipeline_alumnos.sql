-- Seguimiento de alumnos invitados, de punta a punta. Aditiva e idempotente.
-- Requiere 0008, 0013 y 0016.
--
-- Una fila por codigo de invitacion: si se uso, con que correo se creo la
-- cuenta y en que estado quedo su conexion de Instagram. Solo admin. No
-- devuelve el hash del codigo ni nada del token: solo metadatos publicos de la
-- conexion (los mismos que ve el propio alumno en "Mi Instagram").

create or replace function public.pipeline_alumnos()
returns table (
  id uuid,
  nota text,
  creado_en timestamptz,
  expira_en timestamptz,
  usado_en timestamptz,
  revocado_en timestamptz,
  correo text,
  instagram_username text,
  instagram_estado text,
  ultima_sincronizacion timestamptz,
  instagram_error text
) language plpgsql stable security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.usuario u where u.id = auth.uid() and u.rol = 'admin') then
    raise exception 'sin_permiso';
  end if;
  return query
    select i.id, i.nota, i.creado_en, i.expira_en, i.usado_en, i.revocado_en,
           au.email::text, c.username, c.estado, c.ultima_sincronizacion, c.ultimo_error_publico
    from public.invitacion_alumno i
    left join auth.users au on au.id = i.usado_por
    left join lateral (
      select ic.username, ic.estado, ic.ultima_sincronizacion, ic.ultimo_error_publico
      from public.workspace_miembro m
      join public.workspace w on w.id = m.workspace_id and w.tipo = 'alumno'
      join public.instagram_conexion ic on ic.workspace_id = m.workspace_id
      where m.usuario_id = i.usado_por
      order by ic.actualizado_en desc
      limit 1
    ) c on true
    order by i.creado_en desc
    limit 200;
end $$;

revoke all on function public.pipeline_alumnos() from public, anon;
grant execute on function public.pipeline_alumnos() to authenticated;
