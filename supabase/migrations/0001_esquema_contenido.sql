-- =============================================================================
-- Dashboard de contenido — Prime Club / @leo_opazo
-- Migración 1: esquema base
--
-- Tres decisiones que gobiernan todo este archivo:
--
-- 1. APPEND-ONLY. Una pieza sigue sumando alcance hoy. No existe "el"
--    engagement de un post, existe el que tenía el día que se midió. Por eso
--    las métricas viven en una tabla aparte con (post_id, fecha_snapshot,
--    fuente) como llave, y nunca se sobreescriben.
--
-- 2. NULL NO ES CERO. Un dato que la fuente no entregó se guarda NULL. El
--    Sheet de Windsor usa 'SIN_DATO' y el cargador lo traduce a NULL, jamás a
--    0. Confundirlos arruina cualquier mediana y cualquier decisión que salga
--    de ella.
--
-- 3. LA CAPA DERIVADA VIVE EN VISTAS. Tasas, medianas y multiplicadores se
--    calculan en SQL, no en el cargador. Así, cuando cambie un criterio —el
--    piso de alcance, por ejemplo— se recalcula todo el histórico cambiando
--    una fila de `config`, sin volver a llamar a ninguna API.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Configuración: los criterios de medición son datos, no constantes en código.
-- -----------------------------------------------------------------------------
create table if not exists config (
  clave   text primary key,
  valor   numeric not null,
  nota    text not null
);

insert into config (clave, valor, nota) values
  ('piso_alcance', 500,
   'Alcance mínimo para entrar a rankings y medianas. Sin piso, una pieza con 40 de alcance y 2 guardados marca 5% y encabeza la tabla siendo ruido.'),
  ('mult_reeditar', 1.5,
   'Multiplicador desde el cual una pieza vieja se propone para reedición.'),
  ('mult_pauta', 1.8,
   'Multiplicador desde el cual una pieza con alcance bajo se propone como creativo de pauta.')
on conflict (clave) do nothing;

-- -----------------------------------------------------------------------------
-- Cuentas: la propia y las que se vigilan.
-- -----------------------------------------------------------------------------
create table if not exists cuenta (
  id           text primary key,          -- IG business account id
  username     text not null unique,
  nombre       text,
  es_propia    boolean not null default false,
  creado_en    timestamptz not null default now()
);

create table if not exists cuenta_metrica (
  cuenta_id       text not null references cuenta(id) on delete cascade,
  fecha_snapshot  date not null,
  seguidores      integer,                -- NULL = no medido
  publicaciones   integer,
  fuente          text not null check (fuente in ('windsor','api')),
  primary key (cuenta_id, fecha_snapshot, fuente)
);

-- -----------------------------------------------------------------------------
-- Piezas: identidad estable. Lo que no cambia con el tiempo.
-- -----------------------------------------------------------------------------
create table if not exists pieza (
  post_id            text primary key,
  cuenta_id          text not null references cuenta(id) on delete cascade,
  permalink          text,
  publicado_en       timestamptz,         -- fecha + hora
  fecha_publicacion  date,
  -- Formato canónico. El Sheet dice REEL/CARRUSEL/FEED_IMAGEN y la API dice
  -- VIDEO/IMAGE/CAROUSEL_ALBUM. Se normaliza al cargar y se guarda el crudo.
  formato            text check (formato in ('REEL','CARRUSEL','IMAGEN','OTRO')),
  formato_crudo      text,
  caption            text,
  primera_linea      text,
  duracion_seg       numeric,
  -- Si el caption pide una palabra clave al DM. Es el puente entre el orgánico
  -- y el embudo que setea Rodolfo, así que se guarda como dimensión de primera
  -- clase, no se recalcula en cada consulta.
  pide_palabra_clave boolean,
  palabra_clave      text,
  creado_en          timestamptz not null default now(),
  actualizado_en     timestamptz not null default now()
);

create index if not exists ix_pieza_cuenta_fecha on pieza (cuenta_id, fecha_publicacion desc);
create index if not exists ix_pieza_formato      on pieza (formato);

-- -----------------------------------------------------------------------------
-- Métricas: append-only. Una fila por (pieza, día de medición, fuente).
-- Ninguna columna calculada. Solo lo que la fuente respondió.
-- -----------------------------------------------------------------------------
create table if not exists pieza_metrica (
  post_id                text not null references pieza(post_id) on delete cascade,
  fecha_snapshot         date not null,
  fuente                 text not null check (fuente in ('windsor','api')),
  alcance                integer,
  vistas                 integer,
  impresiones            integer,
  guardados              integer,
  compartidos            integer,
  comentarios            integer,
  likes                  integer,
  interacciones_totales  integer,
  visitas_perfil         integer,
  seguidores_ganados     integer,
  tiempo_medio_visto_seg numeric,
  alcance_pagado         integer,
  -- Qué métricas pidió el extractor y la fuente no devolvió. Sirve para saber
  -- si un NULL es "no se midió" o "la fuente no lo soporta para este formato".
  metricas_faltantes     text[] not null default '{}',
  cargado_en             timestamptz not null default now(),
  primary key (post_id, fecha_snapshot, fuente)
);

create index if not exists ix_metrica_snapshot on pieza_metrica (fecha_snapshot desc);

-- -----------------------------------------------------------------------------
-- Pilares: clasificación léxica. Una pieza puede estar en varios.
-- -----------------------------------------------------------------------------
create table if not exists pilar (
  nombre text primary key,
  orden  integer not null default 0
);

create table if not exists pieza_pilar (
  post_id text not null references pieza(post_id) on delete cascade,
  pilar   text not null references pilar(nombre) on delete cascade,
  primary key (post_id, pilar)
);

-- -----------------------------------------------------------------------------
-- Audiencia e historias. Solo las alimenta la API; Windsor no las trae.
-- -----------------------------------------------------------------------------
create table if not exists audiencia_snapshot (
  cuenta_id      text not null references cuenta(id) on delete cascade,
  fecha_snapshot date not null,
  corte          text not null check (corte in ('city','country','age','gender')),
  clave          text not null,
  valor          integer not null,
  primary key (cuenta_id, fecha_snapshot, corte, clave)
);

create table if not exists historia (
  historia_id    text primary key,
  cuenta_id      text not null references cuenta(id) on delete cascade,
  permalink      text,
  publicado_en   timestamptz,
  formato        text
);

create table if not exists historia_metrica (
  historia_id        text not null references historia(historia_id) on delete cascade,
  fecha_snapshot     date not null,
  alcance            integer,
  respuestas         integer,
  navegacion         integer,
  visitas_perfil     integer,
  seguidores_ganados integer,
  interacciones      integer,
  primary key (historia_id, fecha_snapshot)
);

-- =============================================================================
-- CAPA DERIVADA — vistas. Acá vive la doctrina de medición.
-- =============================================================================

-- La observación más reciente de cada pieza, prefiriendo la API cuando existe
-- para la misma fecha (trae más columnas que Windsor).
create or replace view v_pieza_ultima as
select distinct on (m.post_id)
  m.*
from pieza_metrica m
order by m.post_id,
         m.fecha_snapshot desc,
         (case when m.fuente = 'api' then 0 else 1 end);

-- Tasas por pieza. Toda tasa es NULL si falta cualquiera de sus dos términos:
-- dividir por un alcance ausente y devolver 0 sería inventar un fracaso.
create or replace view v_pieza_tasa as
select
  p.post_id,
  p.cuenta_id,
  p.permalink,
  p.fecha_publicacion,
  p.formato,
  p.primera_linea,
  p.pide_palabra_clave,
  u.fecha_snapshot,
  u.fuente,
  u.alcance,
  u.vistas,
  u.guardados,
  u.compartidos,
  u.comentarios,
  u.likes,
  u.visitas_perfil,
  u.seguidores_ganados,
  u.metricas_faltantes,
  case when u.alcance > 0 and u.guardados    is not null
       then u.guardados::numeric    / u.alcance end as tasa_guardado,
  case when u.alcance > 0 and u.compartidos  is not null
       then u.compartidos::numeric  / u.alcance end as tasa_compartido,
  case when u.alcance > 0 and u.comentarios  is not null
       then u.comentarios::numeric  / u.alcance end as tasa_comentario,
  case when u.alcance > 0 and u.likes        is not null
       then u.likes::numeric        / u.alcance end as tasa_like,
  case when u.alcance > 0 and u.visitas_perfil is not null
       then u.visitas_perfil::numeric / u.alcance end as tasa_visita_perfil,
  -- Apto para ranking: superó el piso. Se resuelve contra `config`, así que
  -- mover el piso recalcula todo el histórico sin tocar una línea de código.
  (u.alcance >= (select valor from config where clave = 'piso_alcance'))
    as apto_ranking
from pieza p
join v_pieza_ultima u on u.post_id = p.post_id;

-- Base por formato: MEDIANA, nunca promedio. Una pieza que explota en Explorar
-- arrastra el promedio y hace ver mejor a todo el conjunto.
create or replace view v_base_formato as
select
  cuenta_id,
  formato,
  count(*)                                                             as n,
  percentile_cont(0.5) within group (order by tasa_guardado)           as mediana_guardado,
  percentile_cont(0.5) within group (order by tasa_compartido)         as mediana_compartido,
  percentile_cont(0.5) within group (order by alcance)                 as mediana_alcance
from v_pieza_tasa
where apto_ranking and tasa_guardado is not null
group by cuenta_id, formato;

-- Ranking final. El multiplicador se calcula contra la mediana del MISMO
-- formato: un reel y un carrusel no juegan el mismo deporte, y con la base por
-- formato un reel de hace dos años y el de ayer sí se pueden comparar.
create or replace view v_pieza_ranking as
select
  t.*,
  b.mediana_guardado                              as base_formato,
  case when b.mediana_guardado > 0 and t.tasa_guardado is not null
       then t.tasa_guardado / b.mediana_guardado end as multiplicador
from v_pieza_tasa t
left join v_base_formato b
  on b.cuenta_id = t.cuenta_id and b.formato = t.formato;

-- Rendimiento por pilar.
create or replace view v_pilar_rendimiento as
select
  pp.pilar,
  count(*)                                                     as n,
  percentile_cont(0.5) within group (order by r.tasa_guardado) as mediana_guardado,
  percentile_cont(0.5) within group (order by r.tasa_compartido) as mediana_compartido,
  percentile_cont(0.5) within group (order by r.alcance)       as mediana_alcance
from v_pieza_ranking r
join pieza_pilar pp on pp.post_id = r.post_id
where r.apto_ranking
group by pp.pilar;

-- El CTA al DM: ¿cuesta alcance pedir la palabra clave? Se mide, no se opina.
create or replace view v_efecto_palabra_clave as
select
  pide_palabra_clave,
  count(*)                                                   as n,
  percentile_cont(0.5) within group (order by tasa_guardado) as mediana_guardado,
  percentile_cont(0.5) within group (order by alcance)       as mediana_alcance
from v_pieza_ranking
where apto_ranking and pide_palabra_clave is not null
group by pide_palabra_clave;

-- =============================================================================
-- RLS — la v1 es de solo lectura. Leo lee; nadie escribe desde el navegador.
-- La ingesta entra con la service key, que se salta RLS por diseño.
-- =============================================================================
alter table cuenta             enable row level security;
alter table cuenta_metrica     enable row level security;
alter table pieza              enable row level security;
alter table pieza_metrica      enable row level security;
alter table pilar              enable row level security;
alter table pieza_pilar        enable row level security;
alter table audiencia_snapshot enable row level security;
alter table historia           enable row level security;
alter table historia_metrica   enable row level security;
alter table config             enable row level security;

do $$
declare t text;
begin
  foreach t in array array['cuenta','cuenta_metrica','pieza','pieza_metrica','pilar',
                           'pieza_pilar','audiencia_snapshot','historia',
                           'historia_metrica','config']
  loop
    execute format('drop policy if exists %I on %I', 'lectura_' || t, t);
    execute format(
      'create policy %I on %I for select to anon, authenticated using (true)',
      'lectura_' || t, t);
  end loop;
end $$;
