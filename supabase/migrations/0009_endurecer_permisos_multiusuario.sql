-- Endurece los permisos de 0008. Idempotente: se puede aplicar mas de una vez.
--
-- Por que existe: Supabase concede por defecto ALL sobre cada tabla nueva de
-- `public` a anon y authenticated, y EXECUTE sobre cada funcion nueva. 0008 hizo
-- `grant select` a authenticated pero nunca revoco el resto, y `revoke ... from
-- public` no quita esos grants explicitos. Verificado contra produccion el
-- 2026-10-06:
--   - authenticated podia intentar insert/update/delete; solo RLS lo frenaba
--     (insert -> "violates row-level security", update/delete -> 0 filas).
--   - anon podia ejecutar es_miembro_workspace (devolvia false, sin fuga).
-- Con esto, escribir desde el navegador falla por PERMISO, antes de llegar a RLS:
-- dos capas en vez de una. Las escrituras legitimas (OAuth, alta de alumnos)
-- pasan por el servidor con service_role.

revoke insert, update, delete, truncate, references, trigger
  on public.workspace, public.workspace_miembro, public.instagram_conexion
  from anon, authenticated;
revoke all on public.workspace, public.workspace_miembro, public.instagram_conexion from anon;
revoke all on public.v_instagram_conexion from anon;
revoke insert, update, delete, truncate, references, trigger
  on public.v_instagram_conexion from authenticated;

revoke execute on function public.es_miembro_workspace(uuid), public.administra_workspace(uuid)
  from public, anon;
grant execute on function public.es_miembro_workspace(uuid), public.administra_workspace(uuid)
  to authenticated;
