// Ejecuta 0018 contra Postgres real (PGlite) sobre una replica de produccion:
// cuenta_vigilada como existe hoy (usuario unico en toda la tabla, tope global
// de 5, policies del equipo), la lista de Leo y dos alumnos conectados.
//
// Lo que tiene que ser imposible: que un alumno vea o toque la lista de Leo o
// la de otro alumno, que elija el dueño de una fila, que lea datos de una
// cuenta que no vigila, y que la lista de uno le quite cupo a otro.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

const leer = (m) => readFile(new URL(`../supabase/migrations/${m}`, import.meta.url), 'utf8');
const PREVIAS = (await Promise.all(
  ['0008_multiusuario_instagram.sql', '0009_endurecer_permisos_multiusuario.sql', '0013_alumnos_instagram.sql'].map(leer))).join('\n');
const M0018 = await leer('0018_espia_alumnos.sql');

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

  create schema vault;
  create table vault.secrets (id uuid primary key default gen_random_uuid(), secret text, name text unique);
  create view vault.decrypted_secrets as select id, name, secret as decrypted_secret from vault.secrets;
  create function vault.create_secret(new_secret text, new_name text default null, new_description text default '')
    returns uuid language sql as $$ insert into vault.secrets (secret, name) values (new_secret, new_name) returning id $$;
  create function vault.update_secret(secret_id uuid, new_secret text default null)
    returns void language sql as $$ update vault.secrets set secret = new_secret where id = secret_id $$;
  revoke all on schema vault from public;

  create table public.usuario (id uuid primary key, rol text);
  create function public.es_autorizado() returns boolean language sql stable security definer set search_path = public
    as $$ select exists (select 1 from usuario where id = auth.uid()) $$;
  create function public.puede_editar() returns boolean language sql stable security definer set search_path = public
    as $$ select exists (select 1 from usuario where id = auth.uid() and rol in ('admin', 'editor')) $$;
  create table public.cuenta (id text primary key, username text, nombre text, es_propia boolean default false);
  create table public.cuenta_metrica (cuenta_id text, fecha_snapshot date, seguidores int);
  create table public.pieza (post_id text primary key, cuenta_id text, pide_palabra_clave boolean);
  create table public.pieza_metrica (post_id text, fecha_snapshot date, alcance int, guardados int, likes int);
  create table public.pieza_pilar (post_id text, pilar text);
  create table public.historia (historia_id text primary key, cuenta_id text);
  create table public.historia_metrica (historia_id text, alcance int);
  create table public.audiencia_snapshot (cuenta_id text, corte text, valor int);
  create table public.config (clave text primary key, valor text);
  create table public.pilar (nombre text primary key);
  create view public.v_pieza_ranking with (security_invoker = on) as
    select p.post_id, p.cuenta_id, p.pide_palabra_clave, true as apto_ranking,
           (m.guardados::numeric / nullif(m.alcance, 0)) as tasa_guardado, 0::numeric as tasa_compartido, m.alcance
    from public.pieza p join public.pieza_metrica m on m.post_id = p.post_id;
  create view public.v_pieza_ultima with (security_invoker = on) as
    select distinct on (post_id) * from public.pieza_metrica order by post_id, fecha_snapshot desc;
  do $$ declare t text; begin
    foreach t in array array['cuenta','cuenta_metrica','pieza','pieza_metrica','pieza_pilar','historia','historia_metrica','audiencia_snapshot','config','pilar','usuario'] loop
      execute format('alter table public.%I enable row level security', t);
      execute format('revoke all on public.%I from anon', t);
      execute format('revoke insert, update, delete on public.%I from authenticated', t);
      execute format('create policy lectura on public.%I for select to authenticated using (public.es_autorizado())', t);
    end loop; end $$;

  -- cuenta_vigilada como esta en produccion antes de 0018.
  create table public.cuenta_vigilada (
    id uuid primary key default gen_random_uuid(),
    username text not null unique,
    url text, nombre text, nota text,
    agregada_por uuid references public.usuario(id),
    agregada_en timestamptz not null default now(),
    activa boolean not null default true,
    estado text not null default 'pendiente',
    ultimo_error text, analizada_en timestamptz);
  alter table public.cuenta_vigilada enable row level security;
  revoke all on public.cuenta_vigilada from anon;
  create policy lectura on public.cuenta_vigilada for select to authenticated using (public.es_autorizado());
  create policy escritura on public.cuenta_vigilada for all to authenticated
    using (public.puede_editar()) with check (public.puede_editar());
  create function public.limitar_competidores() returns trigger language plpgsql as $$
  begin
    if new.activa and (select count(*) from public.cuenta_vigilada where activa and id <> new.id) >= 5 then
      raise exception 'Tope de 5 competidores activos';
    end if;
    return new;
  end $$;
  create trigger tope_competidores before insert or update on public.cuenta_vigilada
    for each row execute function public.limitar_competidores();
`;

const U = {
  leo: '00000000-0000-4000-8000-0000000000e0',
  lector: '00000000-0000-4000-8000-0000000000e1',
  ana: '00000000-0000-4000-8000-00000000000a',
  beto: '00000000-0000-4000-8000-00000000000b',
  sinIg: '00000000-0000-4000-8000-00000000000c',
};
const WS = {
  A: '10000000-0000-4000-8000-00000000000a',
  B: '10000000-0000-4000-8000-00000000000b',
  C: '10000000-0000-4000-8000-00000000000c',
};

const db = new PGlite();
await db.exec(SHIM);
await db.exec(PREVIAS);
await db.exec(`
  insert into auth.users (id, email) values ('${U.leo}','leo@x'),('${U.lector}','lector@x'),('${U.ana}','ana@x'),('${U.beto}','beto@x'),('${U.sinIg}','nuevo@x');
  insert into public.usuario values ('${U.leo}', 'admin'), ('${U.lector}', 'lectura');
  insert into public.workspace (id, nombre, slug) values ('${WS.A}','A','alumna-a'),('${WS.B}','B','alumno-b'),('${WS.C}','C','alumno-c');
  insert into public.workspace_miembro (workspace_id, usuario_id, rol, estado) values
    ('${WS.A}','${U.ana}','propietario','activo'), ('${WS.B}','${U.beto}','propietario','activo'), ('${WS.C}','${U.sinIg}','propietario','activo');
  insert into public.instagram_conexion (workspace_id, instagram_user_id, username, estado, conectada_por) values
    ('${WS.A}','ig-a','ana','activa','${U.ana}'), ('${WS.B}','ig-b','beto','activa','${U.beto}');
  insert into public.cuenta (id, username, es_propia) values
    ('ig-leo','leo_opazo',true),('ig-a','ana',false),('ig-b','beto',false),
    ('externa:rival1','rival1',false),('externa:coach','coach',false),('externa:otro','otro',false);
  insert into public.cuenta_metrica values ('ig-leo','2026-11-01',108000),('externa:rival1','2026-11-01',5000),('externa:coach','2026-11-01',900),('externa:otro','2026-11-01',70);
  insert into public.pieza values ('p-leo','ig-leo',true),('p-a','ig-a',false),('p-b','ig-b',false),
    ('p-rival1','externa:rival1',null),('p-coach','externa:coach',null),('p-otro','externa:otro',null);
  insert into public.pieza_metrica values ('p-leo','2026-11-01',1000,20,90),('p-a','2026-11-01',100,5,9),
    ('p-rival1','2026-11-01',null,null,300),('p-coach','2026-11-01',null,null,40),('p-otro','2026-11-01',null,null,7);
  -- La lista de Leo, llena: 5 activas.
  insert into public.cuenta_vigilada (username, estado) values
    ('rival1','listo'),('rival2','listo'),('rival3','listo'),('rival4','listo'),('rival5','listo');
`);
await db.exec(M0018);

/** Corre `pasos` como ese rol y usuario dentro de una transaccion que siempre
 *  se deshace: ninguna prueba deja estado para la siguiente. */
async function sesion(rol, usuario, pasos) {
  await db.exec('begin');
  try {
    await db.exec(`set local role ${rol}`);
    await db.query(`select set_config('request.jwt.claim.sub', $1, true)`, [usuario ?? '']);
    const q = async (sql, params = []) => (await db.query(sql, params)).rows;
    return await pasos(q);
  } finally {
    await db.exec('rollback');
  }
}
const como = (usuario, pasos) => sesion('authenticated', usuario, pasos);
/** Un error dentro de la transaccion la aborta. El savepoint deja seguir. */
async function rechaza(q, sql, patron) {
  await q('savepoint intento');
  await assert.rejects(q(sql), patron);
  await q('rollback to savepoint intento');
}
const col = (rows, k) => rows.map((r) => r[k]).sort();
const agregar = (q, username) => q(`insert into public.cuenta_vigilada (username) values ('${username}') returning id, workspace_id`);

test('0018 se aplica dos veces sin error y deja un solo trigger de tope', async () => {
  await db.exec(M0018);
  const { rows } = await db.query(
    `select tgname from pg_trigger where tgrelid = 'public.cuenta_vigilada'::regclass and not tgisinternal`);
  assert.deepEqual(rows.map((r) => r.tgname), ['cuenta_vigilada_reglas']);
});

test('la lista de Leo queda como estaba: sus 5, sin dueño, y el equipo las ve', async () => {
  const filas = await como(U.leo, (q) => q('select username, workspace_id from public.cuenta_vigilada'));
  assert.deepEqual(col(filas, 'username'), ['rival1', 'rival2', 'rival3', 'rival4', 'rival5']);
  assert.ok(filas.every((f) => f.workspace_id === null));
  assert.equal((await como(U.lector, (q) => q('select 1 from public.cuenta_vigilada'))).length, 5);
});

test('un alumno parte con la lista vacia aunque la de Leo este llena, y puede agregar', async () => {
  await como(U.ana, async (q) => {
    assert.deepEqual(await q('select * from public.cuenta_vigilada'), []);
    const [fila] = await agregar(q, 'coach');
    assert.equal(fila.workspace_id, WS.A);
    assert.deepEqual(col(await q('select username from public.cuenta_vigilada'), 'username'), ['coach']);
  });
});

test('el dueño lo pone la base: un alumno no puede escribir en la lista de otro ni en la del equipo', async () => {
  await como(U.ana, async (q) => {
    const [ajena] = await q(`insert into public.cuenta_vigilada (username, workspace_id) values ('coach', '${WS.B}') returning workspace_id`);
    assert.equal(ajena.workspace_id, WS.A, 'ignora el workspace que mando el navegador');
    const [equipo] = await q(`insert into public.cuenta_vigilada (username, workspace_id) values ('otro', null) returning workspace_id`);
    assert.equal(equipo.workspace_id, WS.A);
    // Tampoco la mueve despues.
    const [movida] = await q(`update public.cuenta_vigilada set workspace_id = '${WS.B}' where username = 'coach' returning workspace_id`);
    assert.equal(movida.workspace_id, WS.A);
  });
  await como(U.leo, async (q) => {
    const [fila] = await q(`update public.cuenta_vigilada set workspace_id = '${WS.A}' where username = 'rival1' returning workspace_id`);
    assert.equal(fila.workspace_id, null, 'el equipo tampoco mueve una fila a un alumno');
  });
});

test('cada alumno ve solo su lista; el equipo no ve las de los alumnos', async () => {
  await db.exec('begin');
  try {
    await db.exec(`insert into public.cuenta_vigilada (username, workspace_id) values ('coach', '${WS.A}'), ('otro', '${WS.B}')`);
    const ver = async (usuario) => {
      await db.exec('savepoint s; set local role authenticated');
      await db.query(`select set_config('request.jwt.claim.sub', $1, true)`, [usuario]);
      const filas = (await db.query('select username from public.cuenta_vigilada')).rows;
      await db.exec('rollback to savepoint s');
      return col(filas, 'username');
    };
    assert.deepEqual(await ver(U.ana), ['coach']);
    assert.deepEqual(await ver(U.beto), ['otro']);
    assert.deepEqual(await ver(U.leo), ['rival1', 'rival2', 'rival3', 'rival4', 'rival5']);
    // Escribir sobre la fila de otro no afecta ninguna.
    await db.exec('set local role authenticated');
    await db.query(`select set_config('request.jwt.claim.sub', $1, true)`, [U.beto]);
    assert.equal((await db.query(`update public.cuenta_vigilada set activa = false where username = 'coach' returning id`)).rows.length, 0);
    assert.equal((await db.query(`update public.cuenta_vigilada set activa = false where username = 'rival1' returning id`)).rows.length, 0);
    assert.equal((await db.query(`delete from public.cuenta_vigilada where username in ('coach', 'rival1', 'otro') returning id`)).rows.length, 0,
      'ni las ajenas ni la propia: un alumno no borra');
  } finally {
    await db.exec('rollback');
  }
});

test('la misma cuenta la pueden vigilar Leo y varios alumnos, pero no dos veces el mismo dueño', async () => {
  await como(U.ana, async (q) => {
    await agregar(q, 'rival1');
    await rechaza(q, `insert into public.cuenta_vigilada (username) values ('rival1')`, /duplicate key|unique/i);
  });
  await db.exec('begin');
  try {
    await db.exec(`insert into public.cuenta_vigilada (username, workspace_id) values ('rival1', '${WS.A}'), ('rival1', '${WS.B}')`);
    assert.equal((await db.query(`select count(*)::int n from public.cuenta_vigilada where username = 'rival1'`)).rows[0].n, 3);
  } finally {
    await db.exec('rollback');
  }
});

test('el tope de 5 es por dueño, y reactivar una quitada tambien cuenta', async () => {
  await como(U.ana, async (q) => {
    for (const u of ['c1', 'c2', 'c3', 'c4', 'c5']) await agregar(q, u);
    await rechaza(q, `insert into public.cuenta_vigilada (username) values ('c6')`, /Tope de 5/);
    await q(`update public.cuenta_vigilada set activa = false where username = 'c1'`);
    await agregar(q, 'c6');
    await rechaza(q, `update public.cuenta_vigilada set activa = true where username = 'c1'`, /Tope de 5/);
    // Cambiar el estado de una activa no es un alta: no choca con el tope.
    await q(`update public.cuenta_vigilada set estado = 'pendiente' where username = 'c6'`);
  });
  // La lista del equipo sigue con su propio tope.
  await como(U.leo, (q) => rechaza(q, `insert into public.cuenta_vigilada (username) values ('sexto')`, /Tope de 5/));
});

test('solo se aceptan usuarios con formato de Instagram', async () => {
  await como(U.ana, async (q) => {
    for (const malo of ['Con.Mayuscula', 'a){id},media', 'con espacio', '', 'x'.repeat(31)]) {
      await rechaza(q, `insert into public.cuenta_vigilada (username) values ('${malo}')`, /cuenta_vigilada_username_formato/);
    }
    await agregar(q, 'nombre.valido_9');
  });
});

test('el alumno lee los datos de las cuentas que vigila, y nada mas', async () => {
  await como(U.ana, async (q) => {
    const externas = () => q(`select id from public.cuenta where id like 'externa:%'`).then((r) => col(r, 'id'));
    assert.deepEqual(await externas(), [], 'sin vigilar a nadie no ve ninguna cuenta ajena');
    await agregar(q, 'coach');
    await agregar(q, 'rival1');
    assert.deepEqual(await externas(), ['externa:coach', 'externa:rival1']);
    assert.deepEqual(col(await q('select id from public.cuenta'), 'id'), ['externa:coach', 'externa:rival1', 'ig-a']);
    assert.deepEqual(col(await q('select post_id from public.pieza'), 'post_id'), ['p-a', 'p-coach', 'p-rival1']);
    assert.deepEqual(col(await q('select post_id from public.pieza_metrica'), 'post_id'), ['p-a', 'p-coach', 'p-rival1']);
    assert.deepEqual(col(await q('select post_id from public.v_pieza_ultima'), 'post_id'), ['p-a', 'p-coach', 'p-rival1']);
    assert.deepEqual(col(await q(`select cuenta_id from public.cuenta_metrica where cuenta_id like 'externa:%'`), 'cuenta_id'), ['externa:coach', 'externa:rival1']);
    // Ni la cuenta de Leo, ni la de otro alumno, ni una ajena que no vigila.
    assert.deepEqual(await q(`select 1 from public.pieza where cuenta_id in ('ig-leo', 'ig-b', 'externa:otro')`), []);
    assert.deepEqual(await q(`select 1 from public.cuenta_metrica where cuenta_id = 'ig-leo'`), []);
    // Quitar corta la lectura.
    await q(`update public.cuenta_vigilada set activa = false where username = 'coach'`);
    assert.deepEqual(await externas(), ['externa:rival1']);
    assert.deepEqual(col(await q('select post_id from public.pieza'), 'post_id'), ['p-a', 'p-rival1']);
  });
});

test('lo que vigila un alumno no le abre nada a otro', async () => {
  await db.exec('begin');
  try {
    await db.exec(`insert into public.cuenta_vigilada (username, workspace_id) values ('coach', '${WS.A}')`);
    await db.exec('set local role authenticated');
    await db.query(`select set_config('request.jwt.claim.sub', $1, true)`, [U.beto]);
    assert.deepEqual((await db.query(`select 1 from public.cuenta where id like 'externa:%'`)).rows, []);
    assert.deepEqual(col((await db.query('select post_id from public.pieza')).rows, 'post_id'), ['p-b']);
  } finally {
    await db.exec('rollback');
  }
});

test('sin Instagram conectado no hay Espia: ni lista, ni altas, ni datos', async () => {
  await como(U.sinIg, async (q) => {
    assert.deepEqual(await q('select * from public.cuenta_vigilada'), []);
    await rechaza(q, `insert into public.cuenta_vigilada (username) values ('coach')`, /sin_workspace/);
  });
  await db.exec('begin');
  try {
    await db.exec(`insert into public.cuenta_vigilada (username, workspace_id) values ('coach', '${WS.A}')`);
    await db.exec(`update public.instagram_conexion set estado = 'revocada' where instagram_user_id = 'ig-a'`);
    await db.exec('set local role authenticated');
    await db.query(`select set_config('request.jwt.claim.sub', $1, true)`, [U.ana]);
    assert.deepEqual((await db.query('select * from public.cuenta_vigilada')).rows, [], 'desconectar corta la lista');
    assert.deepEqual((await db.query('select * from public.pieza')).rows, [], 'y los datos de sus competidores');
  } finally {
    await db.exec('rollback');
  }
});

test('el rol lectura del equipo sigue sin poder escribir, y anon no entra', async () => {
  await db.exec('begin');
  try {
    // Con cupo libre, para que lo que lo frene sea el permiso y no el tope
    // (el trigger corre antes que la policy).
    await db.exec(`update public.cuenta_vigilada set activa = false where username = 'rival5'`);
    await db.exec('set local role authenticated');
    await db.query(`select set_config('request.jwt.claim.sub', $1, true)`, [U.lector]);
    const q = async (sql) => (await db.query(sql)).rows;
    await rechaza(q, `insert into public.cuenta_vigilada (username) values ('coach')`, /row-level security/);
    assert.deepEqual(await q(`update public.cuenta_vigilada set activa = false where username = 'rival1' returning id`), []);
    assert.deepEqual(await q(`update public.cuenta_vigilada set activa = true where username = 'rival5' returning id`), []);
  } finally {
    await db.exec('rollback');
  }
  await sesion('anon', null, (q) => rechaza(q, 'select * from public.cuenta_vigilada', /permission denied/));
});

test('la ingesta (service_role) ve todas las listas y puede marcar el estado', async () => {
  await sesion('service_role', null, async (q) => {
    await q(`insert into public.cuenta_vigilada (username, workspace_id) values ('coach', '${WS.A}'), ('coach', '${WS.B}')`);
    assert.equal((await q('select 1 from public.cuenta_vigilada where activa')).length, 7);
    const tocadas = await q(`update public.cuenta_vigilada set estado = 'listo' where username = 'coach' returning workspace_id`);
    assert.deepEqual(col(tocadas, 'workspace_id'), [WS.A, WS.B]);
  });
});

test('aunque una policy vieja fuera abierta, la restrictiva mantiene cada lista separada', async () => {
  await db.exec('begin');
  try {
    await db.exec(`create policy abierta on public.cuenta_vigilada for all to authenticated using (true) with check (true)`);
    await db.exec(`insert into public.cuenta_vigilada (username, workspace_id) values ('coach', '${WS.A}'), ('otro', '${WS.B}')`);
    for (const [usuario, espera] of [[U.ana, ['coach']], [U.beto, ['otro']], [U.leo, ['rival1', 'rival2', 'rival3', 'rival4', 'rival5']], [U.sinIg, []]]) {
      await db.exec('savepoint s; set local role authenticated');
      await db.query(`select set_config('request.jwt.claim.sub', $1, true)`, [usuario]);
      assert.deepEqual(col((await db.query('select username from public.cuenta_vigilada')).rows, 'username'), espera);
      await db.exec('rollback to savepoint s');
    }
  } finally {
    await db.exec('rollback');
  }
});
