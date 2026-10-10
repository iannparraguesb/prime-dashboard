-- Privilegios minimos (revision de seguridad 2026-10-09). Idempotente.
--
-- Verificado en produccion el 2026-10-09:
--  1. `anon` conservaba TODOS los privilegios sobre cuenta_vigilada (incluido
--     TRUNCATE). RLS le devolvia 0 filas, pero TRUNCATE no pasa por RLS: si
--     algun dia se expusiera por una RPC, vaciaria la tabla. El panel nunca
--     lee ni escribe sin sesion.
--  2. `authenticated` tenia TRUNCATE en cuenta_vigilada y dashboard_tarea.
--     Ninguna ruta lo usa; TRUNCATE, REFERENCES y TRIGGER se retiran de todo
--     el esquema public. INSERT/UPDATE/DELETE siguen donde el panel escribe.
--  3. es_admin, es_autorizado y puede_editar eran ejecutables por `anon`.
--     Devuelven false sin sesion, pero `anon` no los necesita: ninguna tabla
--     le concede lectura, asi que ninguna policy se evalua como anon.
--
-- service_role (ingesta) no se ve afectado.

revoke all on public.cuenta_vigilada from anon;

do $$
declare t text;
begin
  for t in select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
           where n.nspname = 'public' and c.relkind in ('r', 'p', 'v', 'm')
  loop
    execute format('revoke truncate, references, trigger on public.%I from anon, authenticated', t);
  end loop;
end $$;

-- Tablas futuras: que no nazcan con estos privilegios.
alter default privileges in schema public revoke truncate, references, trigger on tables from anon, authenticated;

revoke execute on function public.es_admin() from anon, public;
revoke execute on function public.es_autorizado() from anon, public;
revoke execute on function public.puede_editar() from anon, public;
grant execute on function public.es_admin() to authenticated;
grant execute on function public.es_autorizado() to authenticated;
grant execute on function public.puede_editar() to authenticated;
