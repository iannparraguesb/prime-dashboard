// Ejecuta 0008 + 0009 + 0013 contra Postgres real (PGlite) sobre una replica
// minima de produccion: equipo con policies es_autorizado(), tablas de
// contenido, Vault simulado, la cuenta de Leo y dos alumnos.
//
// Lo que tiene que ser imposible: que un alumno vea a Leo o a otro alumno, que
// alguien reclame una cuenta ajena, que un state OAuth sirva dos veces o para
// otro usuario, y que el navegador toque tokens.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

const leer = (m) => readFile(new URL(`../supabase/migrations/${m}`, import.meta.url), 'utf8');
const BASE = (await Promise.all(['0008_multiusuario_instagram.sql', '0009_endurecer_permisos_multiusuario.sql'].map(leer))).join('\n');
const M0013 = await leer('0013_alumnos_instagram.sql');

const SHIM = `
  create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
  create schema auth;
  create table auth.users (id uuid primary key, email text);
  create function auth.uid() returns uuid language sql stable as
    $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  grant usage on schema auth to anon, authenticated, service_role;
  grant execute on function auth.uid() to anon, authenticated, service_role;
  grant usage on schema public to anon, authenticated, service_role;
  alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
  alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;

  -- Vault simulado: misma interfaz que supabase_vault.
  create schema vault;
  create table vault.secrets (id uuid primary key default gen_random_uuid(), secret text, name text unique);
  create view vault.decrypted_secrets as select id, name, secret as decrypted_secret from vault.secrets;
  create function vault.create_secret(new_secret text, new_name text default null, new_description text default '')
    returns uuid language sql as $$ insert into vault.secrets (secret, name) values (new_secret, new_name) returning id $$;
  create function vault.update_secret(secret_id uuid, new_secret text default null)
    returns void language sql as $$ update vault.secrets set secret = new_secret where id = secret_id $$;
  revoke all on schema vault from public;

  -- Replica de lo que ya existe en produccion (equipo y contenido).
  create table public.usuario (id uuid primary key, rol text);
  create function public.es_autorizado() returns boolean language sql stable security definer set search_path = public
    as $$ select exists (select 1 from usuario where id = auth.uid()) $$;
  create table public.cuenta (id text primary key, username text, nombre text, es_propia boolean default false);
  create table public.cuenta_metrica (cuenta_id text, fecha_snapshot date, seguidores int);
  create table public.pieza (post_id text primary key, cuenta_id text, pide_palabra_clave boolean);
  create table public.pieza_metrica (post_id text, fecha_snapshot date, alcance int, guardados int);
  create table public.pieza_pilar (post_id text, pilar text);
  create table public.historia (historia_id text primary key, cuenta_id text);
  create table public.historia_metrica (historia_id text, alcance int);
  create table public.audiencia_snapshot (cuenta_id text, corte text, valor int);
  create table public.config (clave text primary key, valor text);
  create table public.pilar (nombre text primary key);
  create table public.anuncio (ad_id text primary key);
  create view public.v_pieza_ranking with (security_invoker = on) as
    select p.post_id, p.cuenta_id, p.pide_palabra_clave, true as apto_ranking,
           (m.guardados::numeric / nullif(m.alcance, 0)) as tasa_guardado, 0::numeric as tasa_compartido, m.alcance
    from public.pieza p join public.pieza_metrica m on m.post_id = p.post_id;
  do $$ declare t text; begin
    foreach t in array array['cuenta','cuenta_metrica','pieza','pieza_metrica','pieza_pilar','historia','historia_metrica','audiencia_snapshot','config','pilar','anuncio','usuario'] loop
      execute format('alter table public.%I enable row level security', t);
      execute format('revoke all on public.%I from anon', t);
      execute format('revoke insert, update, delete on public.%I from authenticated', t);
      execute format('create policy lectura on public.%I for select to authenticated using (public.es_autorizado())', t);
    end loop; end $$;
`;

const U = {
  leo: '00000000-0000-4000-8000-0000000000e0',
  alumnaA: '00000000-0000-4000-8000-00000000000a',
  alumnoB: '00000000-0000-4000-8000-00000000000b',
  nuevo: '00000000-0000-4000-8000-00000000000c',
};
const WS = { A: '10000000-0000-4000-8000-00000000000a', B: '10000000-0000-4000-8000-00000000000b' };
const HASH = (c) => c.repeat(64);

const db = new PGlite();
await db.exec(SHIM);
await db.exec(BASE);
await db.exec(M0013);
await db.exec(`
  insert into auth.users (id, email) values ('${U.leo}','leo@x'),('${U.alumnaA}','ana@x'),('${U.alumnoB}','beto@x'),('${U.nuevo}','nuevo@x');
  insert into public.usuario values ('${U.leo}', 'admin');
  insert into public.workspace (id, nombre, slug) values ('${WS.A}','A','alumna-a'),('${WS.B}','B','alumno-b');
  insert into public.workspace_miembro (workspace_id, usuario_id, rol, estado) values
    ('${WS.A}','${U.alumnaA}','propietario','activo'), ('${WS.B}','${U.alumnoB}','propietario','activo');
  insert into public.instagram_conexion (workspace_id, instagram_user_id, username, estado, conectada_por) values
    ('${WS.A}','ig-a','ana','activa','${U.alumnaA}'), ('${WS.B}','ig-b','beto','activa','${U.alumnoB}');
  insert into public.cuenta (id, username, es_propia) values ('ig-leo','leo_opazo',true),('ig-a','ana',false),('ig-b','beto',false),('externa:rival','rival',false);
  insert into public.cuenta_metrica values ('ig-leo','2026-10-01',108000),('ig-a','2026-10-01',900),('ig-b','2026-10-01',1200);
  insert into public.pieza values ('p-leo','ig-leo',true),('p-a','ig-a',false),('p-b','ig-b',true);
  insert into public.pieza_metrica values ('p-leo','2026-10-01',1000,20),('p-a','2026-10-01',100,5),('p-b','2026-10-01',200,1);
  insert into public.pieza_pilar values ('p-leo','sistema'),('p-a','sistema'),('p-b','venta');
  insert into public.historia values ('h-leo','ig-leo'),('h-a','ig-a'),('h-b','ig-b');
  insert into public.historia_metrica values ('h-leo',500),('h-a',50),('h-b',60);
  insert into public.audiencia_snapshot values ('ig-leo','pais',1),('ig-a','pais',2),('ig-b','pais',3);
  insert into public.config values ('piso_alcance','500');
  insert into public.pilar values ('sistema'),('venta');
  insert into public.anuncio values ('ad-1');
`);

async function como(rol, usuario, sql, params = []) {
  await db.exec('begin');
  try {
    await db.exec(`set local role ${rol}`);
    if (usuario) await db.query(`select set_config('request.jwt.claim.sub', $1, true)`, [usuario]);
    return (await db.query(sql, params)).rows;
  } finally {
    await db.exec('rollback');
  }
}
const ids = (rows, k) => rows.map((r) => r[k]).sort();
const falla = (p, patron) => assert.rejects(p, patron);

test('0013 se aplica dos veces sin error', async () => {
  await db.exec(M0013);
});

test('la alumna A ve solo su cuenta, en todas las tablas de contenido', async () => {
  const a = (sql, k) => como('authenticated', U.alumnaA, sql).then((r) => ids(r, k));
  assert.deepEqual(await a('select id from public.cuenta', 'id'), ['ig-a']);
  assert.deepEqual(await a('select cuenta_id from public.cuenta_metrica', 'cuenta_id'), ['ig-a']);
  assert.deepEqual(await a('select post_id from public.pieza', 'post_id'), ['p-a']);
  assert.deepEqual(await a('select post_id from public.pieza_metrica', 'post_id'), ['p-a']);
  assert.deepEqual(await a('select post_id from public.pieza_pilar', 'post_id'), ['p-a']);
  assert.deepEqual(await a('select historia_id from public.historia', 'historia_id'), ['h-a']);
  assert.deepEqual(await a('select historia_id from public.historia_metrica', 'historia_id'), ['h-a']);
  assert.deepEqual(await a('select cuenta_id from public.audiencia_snapshot', 'cuenta_id'), ['ig-a']);
  assert.deepEqual(await a('select post_id from public.v_pieza_ranking', 'post_id'), ['p-a']);
  assert.deepEqual(await a("select post_id from public.pieza where cuenta_id in ('ig-leo','ig-b')", 'post_id'), []);
});

test('el alumno no ve nada del equipo: anuncios, usuarios ni competencia', async () => {
  assert.deepEqual(await como('authenticated', U.alumnaA, 'select * from public.anuncio'), []);
  assert.deepEqual(await como('authenticated', U.alumnaA, 'select * from public.usuario'), []);
  assert.deepEqual(await como('authenticated', U.alumnaA, "select * from public.cuenta where id like 'externa:%'"), []);
});

test('el alumno lee la configuracion y los pilares; un usuario sin conexion no', async () => {
  assert.equal((await como('authenticated', U.alumnaA, 'select * from public.config')).length, 1);
  assert.equal((await como('authenticated', U.alumnaA, 'select * from public.pilar')).length, 2);
  assert.deepEqual(await como('authenticated', U.nuevo, 'select * from public.config'), []);
  assert.deepEqual(await como('authenticated', U.nuevo, 'select * from public.pieza'), []);
});

test('el equipo sigue viendo todo, y las vistas separan por cuenta', async () => {
  assert.deepEqual(ids(await como('authenticated', U.leo, 'select id from public.cuenta'), 'id'), ['externa:rival', 'ig-a', 'ig-b', 'ig-leo']);
  const pilares = await como('authenticated', U.leo, "select cuenta_id, pilar, n from public.v_pilar_rendimiento where pilar = 'sistema' order by cuenta_id");
  assert.deepEqual(pilares.map((r) => [r.cuenta_id, Number(r.n)]), [['ig-a', 1], ['ig-leo', 1]]);
  const palabra = await como('authenticated', U.leo, "select cuenta_id from public.v_efecto_palabra_clave where cuenta_id = 'ig-leo'");
  assert.equal(palabra.length, 1);
});

test('una conexion revocada deja al alumno sin acceso a sus datos', async () => {
  await db.exec('begin');
  try {
    await db.exec(`update public.instagram_conexion set estado = 'revocada' where instagram_user_id = 'ig-a'`);
    await db.exec('set local role authenticated');
    await db.query(`select set_config('request.jwt.claim.sub', $1, true)`, [U.alumnaA]);
    assert.deepEqual((await db.query('select * from public.pieza')).rows, []);
  } finally {
    await db.exec('rollback');
  }
});

test('crear_estado_oauth: reusa el workspace, crea uno para un alumno nuevo y rechaza al equipo', async () => {
  await db.exec('begin');
  try {
    await db.exec('set local role authenticated');
    await db.query(`select set_config('request.jwt.claim.sub', $1, true)`, [U.nuevo]);
    await db.query(`select public.crear_estado_oauth('${HASH('a')}', 'https://x/cb')`);
    const filas = (await db.query('select w.tipo, m.rol from public.workspace w join public.workspace_miembro m on m.workspace_id = w.id')).rows;
    assert.deepEqual(filas, [{ tipo: 'alumno', rol: 'propietario' }]);
    await db.query(`select public.crear_estado_oauth('${HASH('f')}', 'https://x/cb')`);
    assert.equal((await db.query('select count(*)::int n from public.workspace')).rows[0].n, 1, 'reusa su workspace');
  } finally {
    await db.exec('rollback');
  }
  await falla(como('authenticated', U.leo, `select public.crear_estado_oauth('${HASH('b')}', 'https://x/cb')`), /cuenta_del_equipo/);
  await falla(como('authenticated', U.alumnaA, `select public.crear_estado_oauth('no-es-hash', 'https://x/cb')`), /estado_invalido/);
  await falla(como('anon', null, `select public.crear_estado_oauth('${HASH('c')}', 'https://x/cb')`), /permission denied/);
});

test('un state sirve una sola vez, solo para quien lo pidio y solo 10 minutos', async () => {
  await db.exec('begin');
  try {
    await db.query(`select set_config('request.jwt.claim.sub', $1, true)`, [U.alumnaA]);
    await db.exec(`set local role authenticated; select public.crear_estado_oauth('${HASH('d')}', 'https://x/cb'); reset role;`);
    await db.exec(`set local role authenticated; select public.crear_estado_oauth('${HASH('e')}', 'https://x/cb'); reset role;`);
    await db.exec(`update private.instagram_oauth_estado set expira_en = now() - interval '1 minute' where estado_hash = '${HASH('e')}'`);
    await db.exec('set local role service_role');
    const otro = await db.query(`select * from public.consumir_estado_oauth('${HASH('d')}', '${U.alumnoB}')`);
    assert.equal(otro.rows.length, 0, 'otro usuario no puede consumirlo');
    const una = await db.query(`select * from public.consumir_estado_oauth('${HASH('d')}', '${U.alumnaA}')`);
    assert.equal(una.rows[0].workspace_id, WS.A);
    const dos = await db.query(`select * from public.consumir_estado_oauth('${HASH('d')}', '${U.alumnaA}')`);
    assert.equal(dos.rows.length, 0, 'reutilizado');
    const vencido = await db.query(`select * from public.consumir_estado_oauth('${HASH('e')}', '${U.alumnaA}')`);
    assert.equal(vencido.rows.length, 0, 'vencido');
  } finally {
    await db.exec('rollback');
  }
  await falla(como('authenticated', U.alumnaA, `select * from public.consumir_estado_oauth('${HASH('d')}', '${U.alumnaA}')`), /permission denied/);
});

const guardar = (ws, usuario, ig, token = 'tok') =>
  `select public.guardar_conexion_instagram('${ws}', '${usuario}', '${ig}', 'user', 'BUSINESS', '${token}', now() + interval '60 days', array['instagram_business_basic'])`;

test('guardar conexion: nadie reclama una cuenta ajena ni la de Leo', async () => {
  await falla(como('service_role', null, guardar(WS.A, U.alumnaA, 'ig-b')), /cuenta_en_uso/);
  await falla(como('service_role', null, guardar(WS.A, U.alumnaA, 'ig-leo')), /cuenta_en_uso/);
  await falla(como('service_role', null, guardar(WS.A, U.alumnoB, 'ig-nueva')), /sin_permiso/);
  await falla(como('authenticated', U.alumnaA, guardar(WS.A, U.alumnaA, 'ig-nueva')), /permission denied/);
});

test('guardar conexion: token en Vault, cuenta creada, y cambiar de cuenta revoca la anterior', async () => {
  await db.exec('begin');
  try {
    await db.exec('set local role service_role');
    await db.query(guardar(WS.A, U.alumnaA, 'ig-a', 'token-1'));
    await db.query(guardar(WS.A, U.alumnaA, 'ig-a', 'token-2'));
    let sync = (await db.query('select instagram_user_id, token from public.conexiones_para_sincronizar() order by 1')).rows;
    assert.deepEqual(sync, [{ instagram_user_id: 'ig-a', token: 'token-2' }], 'renovar actualiza el mismo secreto');
    await db.query(guardar(WS.A, U.alumnaA, 'ig-a2', 'token-3'));
    sync = (await db.query('select instagram_user_id from public.conexiones_para_sincronizar() order by 1')).rows;
    assert.deepEqual(sync, [{ instagram_user_id: 'ig-a2' }]);
    const estados = (await db.query("select instagram_user_id, estado from public.instagram_conexion where workspace_id = $1 order by 1", [WS.A])).rows;
    assert.deepEqual(estados, [{ instagram_user_id: 'ig-a', estado: 'revocada' }, { instagram_user_id: 'ig-a2', estado: 'activa' }]);
    await db.exec('reset role');
    assert.equal((await db.query('select count(*)::int n from vault.secrets')).rows[0].n, 1, 'el secreto viejo se borro');
    assert.equal((await db.query("select es_propia from public.cuenta where id = 'ig-a2'")).rows[0].es_propia, false);
  } finally {
    await db.exec('rollback');
  }
});

test('el navegador nunca lee tokens ni la lista de conexiones a sincronizar', async () => {
  await falla(como('authenticated', U.alumnaA, 'select * from public.conexiones_para_sincronizar()'), /permission denied/);
  await falla(como('authenticated', U.alumnaA, 'select * from vault.decrypted_secrets'), /permission denied/);
  await falla(como('authenticated', U.alumnaA, "select public.registrar_sincronizacion(gen_random_uuid(), true)"), /permission denied/);
});

test('desconectar borra el token, revoca la conexion y corta el acceso, sin tocar a B', async () => {
  await db.exec('begin');
  try {
    await db.exec('set local role service_role');
    await db.query(guardar(WS.A, U.alumnaA, 'ig-a', 'token-a'));
    await db.query(guardar(WS.B, U.alumnoB, 'ig-b', 'token-b'));
    await db.exec('reset role; set local role authenticated');
    await db.query(`select set_config('request.jwt.claim.sub', $1, true)`, [U.alumnaA]);
    await db.query('select public.desconectar_instagram()');
    assert.deepEqual((await db.query('select * from public.pieza')).rows, []);
    await db.exec('reset role; set local role service_role');
    const sync = (await db.query('select instagram_user_id, token from public.conexiones_para_sincronizar()')).rows;
    assert.deepEqual(sync, [{ instagram_user_id: 'ig-b', token: 'token-b' }]);
  } finally {
    await db.exec('rollback');
  }
  await falla(como('authenticated', U.leo, 'select public.desconectar_instagram()'), /sin_permiso/);
});

test('registrar_sincronizacion rota el token y marca vencida cuando corresponde', async () => {
  await db.exec('begin');
  try {
    await db.exec('set local role service_role');
    const con = (await db.query(guardar(WS.A, U.alumnaA, 'ig-a', 'viejo'))).rows[0].guardar_conexion_instagram;
    await db.query("select public.registrar_sincronizacion($1, true, null, 'nuevo', now() + interval '60 days')", [con]);
    assert.equal((await db.query('select token from public.conexiones_para_sincronizar()')).rows[0].token, 'nuevo');
    await db.query("select public.registrar_sincronizacion($1, false, 'Tu conexión venció. Vuelve a conectar Instagram.')", [con]);
    assert.equal((await db.query('select estado from public.instagram_conexion where id = $1', [con])).rows[0].estado, 'vencida');
  } finally {
    await db.exec('rollback');
  }
});
