-- `thumb_path` se agrego a `pieza` en la migracion 0003, despues de que las
-- vistas existieran, asi que la columna no llegaba al panel.
--
-- No basta `create or replace view`: Postgres no permite insertar una columna
-- en medio del listado, y `v_pieza_ranking` hace `select t.*` sobre
-- `v_pieza_tasa`, asi que agregarla alli corre las columnas de la vista de
-- arriba. Hay que recrear la cadena completa, en orden de dependencia.
--
-- Se vuelve a fijar `security_invoker = on` en todas: al recrear una vista se
-- pierde la opcion y volveria el hallazgo ERROR del linter de Supabase.
drop view if exists v_efecto_palabra_clave cascade;
drop view if exists v_pilar_rendimiento    cascade;
drop view if exists v_base_formato         cascade;
drop view if exists v_pieza_ranking        cascade;
drop view if exists v_pieza_tasa           cascade;

create view v_pieza_tasa as
select
  p.post_id, p.cuenta_id, p.permalink, p.fecha_publicacion, p.formato,
  p.primera_linea, p.pide_palabra_clave, p.palabra_clave,
  p.thumb_path,
  u.fecha_snapshot, u.fuente, u.alcance, u.vistas, u.guardados, u.compartidos,
  u.comentarios, u.likes, u.visitas_perfil, u.seguidores_ganados,
  u.metricas_faltantes,
  case when u.alcance > 0 and u.guardados is not null
       then u.guardados::numeric / u.alcance end as tasa_guardado,
  case when u.alcance > 0 and u.compartidos is not null
       then u.compartidos::numeric / u.alcance end as tasa_compartido,
  case when u.alcance > 0 and u.comentarios is not null
       then u.comentarios::numeric / u.alcance end as tasa_comentario,
  case when u.alcance > 0 and u.likes is not null
       then u.likes::numeric / u.alcance end as tasa_like,
  case when u.alcance > 0 and u.visitas_perfil is not null
       then u.visitas_perfil::numeric / u.alcance end as tasa_visita_perfil,
  (u.alcance >= (select valor from config where clave = 'piso_alcance'))
    as apto_ranking
from pieza p
join v_pieza_ultima u on u.post_id = p.post_id;

create view v_base_formato as
select
  cuenta_id, formato,
  count(*) as n,
  percentile_cont(0.5) within group (order by tasa_guardado)   as mediana_guardado,
  percentile_cont(0.5) within group (order by tasa_compartido) as mediana_compartido,
  percentile_cont(0.5) within group (order by alcance)         as mediana_alcance
from v_pieza_tasa
where apto_ranking and tasa_guardado is not null
group by cuenta_id, formato;

create view v_pieza_ranking as
select
  t.*,
  b.mediana_guardado as base_formato,
  case when b.mediana_guardado > 0 and t.tasa_guardado is not null
       then t.tasa_guardado / b.mediana_guardado end as multiplicador
from v_pieza_tasa t
left join v_base_formato b
  on b.cuenta_id = t.cuenta_id and b.formato = t.formato;

create view v_pilar_rendimiento as
select
  pp.pilar,
  count(*) as n,
  percentile_cont(0.5) within group (order by r.tasa_guardado)   as mediana_guardado,
  percentile_cont(0.5) within group (order by r.tasa_compartido) as mediana_compartido,
  percentile_cont(0.5) within group (order by r.alcance)         as mediana_alcance
from v_pieza_ranking r
join pieza_pilar pp on pp.post_id = r.post_id
where r.apto_ranking
group by pp.pilar;

create view v_efecto_palabra_clave as
select
  pide_palabra_clave,
  count(*) as n,
  percentile_cont(0.5) within group (order by tasa_guardado) as mediana_guardado,
  percentile_cont(0.5) within group (order by alcance)       as mediana_alcance
from v_pieza_ranking
where apto_ranking and pide_palabra_clave is not null
group by pide_palabra_clave;

alter view v_pieza_tasa           set (security_invoker = on);
alter view v_base_formato         set (security_invoker = on);
alter view v_pieza_ranking        set (security_invoker = on);
alter view v_pilar_rendimiento    set (security_invoker = on);
alter view v_efecto_palabra_clave set (security_invoker = on);
