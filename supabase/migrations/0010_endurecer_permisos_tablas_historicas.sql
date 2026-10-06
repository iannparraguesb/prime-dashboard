-- Endurece las tablas historicas del panel (hallazgo A-02 de
-- docs/AUDITORIA-SEGURIDAD-2026-10-06.md). Idempotente.
--
-- Verificado en produccion el 2026-10-06 con el usuario de rol `lectura`:
-- tenia privilegio INSERT/UPDATE/DELETE sobre estas tablas (concesion por
-- defecto de Supabase). RLS lo frenaba (update -> 0 filas, insert -> "violates
-- row-level security"), pero era la UNICA capa. Una policy de escritura mal
-- escrita bastaba para que el navegador alterara metricas, piezas o la lista
-- blanca.
--
-- Estas tablas las escribe solo la ingesta (tools/*.py) con service_role, que
-- no se ve afectado por estos revokes. El panel escribe unicamente en
-- cuenta_vigilada (competidores) y dashboard_tarea (plan): esas dos NO se tocan.
--
-- Tambien se retira toda lectura a `anon`: hoy RLS ya le devuelve cero filas,
-- pero el panel nunca lee datos sin sesion, asi que no necesita el privilegio.

do $$
declare
  t text;
  tablas text[] := array[
    'anuncio','anuncio_metrica','audiencia_snapshot','config','cuenta','cuenta_metrica',
    'historia','historia_metrica','pieza','pieza_metrica','pieza_pilar','pilar','usuario'];
  vistas text[] := array[
    'v_anuncio','v_anuncio_ultima','v_base_formato','v_campana','v_efecto_palabra_clave',
    'v_pieza_ranking','v_pieza_tasa','v_pieza_ultima','v_pilar_rendimiento'];
begin
  foreach t in array tablas loop
    -- `if exists`: un entorno nuevo sin alguna tabla no aborta la migracion.
    if to_regclass('public.' || t) is not null then
      execute format('revoke insert, update, delete, truncate, references, trigger on public.%I from anon, authenticated', t);
      execute format('revoke all on public.%I from anon', t);
    end if;
  end loop;
  foreach t in array vistas loop
    if to_regclass('public.' || t) is not null then
      execute format('revoke insert, update, delete, truncate, references, trigger on public.%I from anon, authenticated', t);
      execute format('revoke all on public.%I from anon', t);
    end if;
  end loop;
end $$;
