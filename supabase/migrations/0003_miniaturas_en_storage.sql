-- Las URLs de miniatura que devuelve Instagram son firmadas y CADUCAN: la de
-- prueba del 2026-08-30 expiraba el 2026-09-04, cinco dias despues. Guardarlas
-- crudas garantiza miniaturas rotas la semana siguiente, que es peor que no
-- mostrarlas: parece un bug del panel y no un limite de la fuente.
--
-- Por eso el archivo se descarga a Supabase Storage (bucket `miniaturas`,
-- publico) con tools/ig_miniaturas.py, y en la base vive la ruta, que no caduca.
alter table pieza add column if not exists thumb_path   text;
alter table pieza add column if not exists thumb_origen text;
alter table pieza add column if not exists thumb_bajada_en timestamptz;

comment on column pieza.thumb_path is
  'Ruta dentro del bucket `miniaturas` de Supabase Storage. Es la que sirve el panel: no caduca.';
comment on column pieza.thumb_origen is
  'URL firmada de Instagram desde la que se descargo. Solo para auditoria; caduca en dias.';

create index if not exists ix_pieza_sin_thumb on pieza (post_id) where thumb_path is null;

-- El bucket se crea con la API de Storage, no con SQL:
--   POST {SUPABASE_URL}/storage/v1/bucket
--   {"id":"miniaturas","name":"miniaturas","public":true,
--    "file_size_limit":5242880,
--    "allowed_mime_types":["image/jpeg","image/png","image/webp"]}
