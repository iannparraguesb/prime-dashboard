-- Pestaña "Negocio": gasto Meta, agendas y leads de GHL, llamadas del setter.
-- Aditiva e idempotente. No toca ninguna tabla existente.
--
-- Quién ve qué:
--   * LECTURA solo para usuarios con rol 'admin' en public.usuario (hoy: Leo e Iann).
--     Estas tablas tienen nombres de prospectos e ingresos del negocio; el rol
--     'lectura' (setter, cuenta de pruebas) no las ve, ni por API ni por PostgREST.
--   * ESCRITURA solo la ingesta (tools/finanzas_a_supabase.py) con service_role,
--     que no se ve afectada por RLS ni por estos revokes. El panel no escribe aquí.
--
-- Minimización: no se guardan email ni teléfono. El panel no los necesita y el
-- detalle completo sigue en GHL.

create table if not exists public.negocio_gasto_diario (
  fecha date not null,
  campana_id text not null,
  campana text not null,
  tipo text not null check (tipo in ('DM Ads','VSL','Retargeting','Otra')),
  moneda text not null,
  gasto numeric not null,
  impresiones integer,
  clics integer,
  conversaciones integer,
  conv_reales integer,
  registros integer,
  cargado_en timestamptz not null default now(),
  primary key (fecha, campana_id)
);

create table if not exists public.negocio_dolar (
  mes date primary key,
  clp_por_usd numeric not null check (clp_por_usd > 0),
  dias integer not null,
  fuente text not null
);

create table if not exists public.negocio_agenda (
  id text primary key,
  creado date not null,
  cambio_etapa date not null,
  nombre text,
  fuente_ghl text,
  origen text not null,
  utm_source text,
  utm_medium text,
  utm_campaign text,
  utm_content text,
  pipeline text,
  etapa text,
  estado text,
  valor numeric
);
create index if not exists negocio_agenda_creado on public.negocio_agenda(creado);

create table if not exists public.negocio_lead (
  id text primary key,
  creado date not null,
  fuente text,
  origen text not null
);
create index if not exists negocio_lead_creado on public.negocio_lead(creado);

create table if not exists public.negocio_llamada (
  id text primary key,
  fecha date not null,
  prospecto text not null,
  fuente text,
  detalle text,
  asistio text,
  nota numeric,
  resultado text,
  plan text,
  monto_usd numeric,
  objecion text,
  seguimiento text
);

-- Cobertura de cada fuente: lo que está fuera de [cubre_desde, cubre_hasta] es
-- "sin dato", no cero. El panel la usa para decidir entre un número y un guion.
create table if not exists public.negocio_carga (
  fuente text primary key check (fuente in ('meta','ghl','setter','dolar')),
  cubre_desde date not null,
  cubre_hasta date not null,
  cargado_en timestamptz not null default now(),
  nota text
);

do $$
declare
  t text;
  tablas text[] := array['negocio_gasto_diario','negocio_dolar','negocio_agenda','negocio_lead','negocio_llamada','negocio_carga'];
begin
  foreach t in array tablas loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon', t);
    execute format('revoke insert, update, delete, truncate, references, trigger on public.%I from authenticated', t);
    execute format('grant select on public.%I to authenticated', t);
    execute format('drop policy if exists %I on public.%I', t || '_admin_lee', t);
    execute format(
      'create policy %I on public.%I for select to authenticated using ('
      || 'exists (select 1 from public.usuario u where u.id = (select auth.uid()) and u.rol = ''admin''))',
      t || '_admin_lee', t);
  end loop;
end $$;
