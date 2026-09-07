-- Postgres crea las vistas con SECURITY DEFINER por defecto: se ejecutan con los
-- permisos de quien las creó y se saltan el RLS de quien consulta. El linter de
-- Supabase lo marca como ERROR.
--
-- Con las políticas actuales (`using (true)`) no cambia nada visible, pero deja
-- una puerta abierta: si mañana el RLS se restringe por cuenta, estas vistas
-- seguirían devolviéndolo todo. security_invoker las hace respetar al que llama.
alter view v_pieza_ultima         set (security_invoker = on);
alter view v_pieza_tasa           set (security_invoker = on);
alter view v_base_formato         set (security_invoker = on);
alter view v_pieza_ranking        set (security_invoker = on);
alter view v_pilar_rendimiento    set (security_invoker = on);
alter view v_efecto_palabra_clave set (security_invoker = on);
