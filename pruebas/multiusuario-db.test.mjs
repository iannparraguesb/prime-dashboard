// Ejecuta la migracion 0008 contra un Postgres real (PGlite, Postgres en
// WebAssembly: sin Docker ni servidor) y prueba el aislamiento por RLS con dos
// alumnos. `multiusuario.test.mjs` solo revisa el texto del SQL; esta prueba
// comprueba que la base efectivamente se comporta asi.
//
// El entorno imita lo que Supabase da por hecho: roles anon/authenticated/
// service_role, `auth.users` y `auth.uid()` leyendo el claim `sub` del JWT.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

// Se aplican en orden, como en produccion: 0008 crea el modelo y 0009 endurece
// los permisos que Supabase concede por defecto.
const MIGRACIONES = ['0008_multiusuario_instagram.sql', '0009_endurecer_permisos_multiusuario.sql'];
const SQL = (await Promise.all(MIGRACIONES.map((m) =>
  readFile(new URL(`../supabase/migrations/${m}`, import.meta.url), 'utf8')))).join('\n');

const SHIM_SUPABASE = `
  create role anon nologin;
  create role authenticated nologin;
  create role service_role nologin bypassrls;
  create schema auth;
  create table auth.users (id uuid primary key, email text);
  create function auth.uid() returns uuid language sql stable as
    $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  grant usage on schema auth to anon, authenticated, service_role;
  grant execute on function auth.uid() to anon, authenticated, service_role;
  grant usage on schema public to anon, authenticated, service_role;
  -- Lo que Supabase concede por defecto sobre todo objeto nuevo en public. Sin
  -- esto la replica era mas estricta que produccion y las pruebas pasaban por
  -- razones equivocadas (se detecto al verificar 0008 contra la base real).
  alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
  alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
  alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
`;

const U = {
  alumnaA: '00000000-0000-4000-8000-00000000000a',
  alumnoB: '00000000-0000-4000-8000-00000000000b',
  sinMembresia: '00000000-0000-4000-8000-00000000000c',
  invitado: '00000000-0000-4000-8000-00000000000d',
};
const WS = {
  A: '10000000-0000-4000-8000-00000000000a',
  B: '10000000-0000-4000-8000-00000000000b',
};

const db = new PGlite();
await db.exec(SHIM_SUPABASE);
await db.exec(SQL);
await db.exec(`
  insert into auth.users (id, email) values
    ('${U.alumnaA}', 'a@test'), ('${U.alumnoB}', 'b@test'),
    ('${U.sinMembresia}', 'c@test'), ('${U.invitado}', 'd@test');
  insert into public.workspace (id, nombre, slug) values
    ('${WS.A}', 'Alumna A', 'alumna-a'), ('${WS.B}', 'Alumno B', 'alumno-b');
  insert into public.workspace_miembro (workspace_id, usuario_id, rol, estado) values
    ('${WS.A}', '${U.alumnaA}', 'propietario', 'activo'),
    ('${WS.B}', '${U.alumnoB}', 'propietario', 'activo'),
    ('${WS.B}', '${U.invitado}', 'lectura', 'invitado');
  insert into public.instagram_conexion (workspace_id, instagram_user_id, username, estado, conectada_por) values
    ('${WS.A}', 'ig-a', 'alumna_a', 'activa', '${U.alumnaA}'),
    ('${WS.B}', 'ig-b', 'alumno_b', 'activa', '${U.alumnoB}');
`);

/** Corre `sql` como un rol de Supabase y con el JWT de `usuario`, en una transaccion
 *  que siempre se deshace: ninguna prueba deja estado para la siguiente. */
async function como(rol, usuario, sql) {
  await db.exec('begin');
  try {
    await db.exec(`set local role ${rol}`);
    if (usuario) await db.query(`select set_config('request.jwt.claim.sub', $1, true)`, [usuario]);
    const r = await db.query(sql);
    return r.rows;
  } finally {
    await db.exec('rollback');
  }
}

const ids = (filas, campo = 'id') => filas.map((f) => f[campo]).sort();

test('las migraciones se aplican dos veces sin error (idempotentes)', async () => {
  await db.exec(SQL);
});

test('anon no lee ninguna tabla ni la vista, aunque conozca la clave publica', async () => {
  for (const objeto of ['workspace', 'workspace_miembro', 'instagram_conexion', 'v_instagram_conexion']) {
    await assert.rejects(como('anon', null, `select * from public.${objeto}`), /permission denied/,
      `anon pudo leer ${objeto}`);
  }
});

test('anon no puede ejecutar los helpers de membresia para sondear workspaces', async () => {
  await assert.rejects(como('anon', null, `select public.es_miembro_workspace('${WS.A}')`), /permission denied/);
});

test('cada alumno ve solo su workspace', async () => {
  assert.deepEqual(ids(await como('authenticated', U.alumnaA, 'select id from public.workspace')), [WS.A]);
  assert.deepEqual(ids(await como('authenticated', U.alumnoB, 'select id from public.workspace')), [WS.B]);
});

test('A no ve la conexion de Instagram de B, ni por la tabla ni por la vista', async () => {
  for (const objeto of ['instagram_conexion', 'v_instagram_conexion']) {
    const filas = await como('authenticated', U.alumnaA, `select instagram_user_id from public.${objeto}`);
    assert.deepEqual(ids(filas, 'instagram_user_id'), ['ig-a'], `fuga en ${objeto}`);
  }
});

test('A no ve quien es miembro del workspace de B', async () => {
  const filas = await como('authenticated', U.alumnaA, 'select workspace_id from public.workspace_miembro');
  assert.ok(filas.every((f) => f.workspace_id === WS.A));
});

test('A no obtiene nada de B ni pidiendo su id explicitamente', async () => {
  assert.equal((await como('authenticated', U.alumnaA, `select * from public.workspace where id = '${WS.B}'`)).length, 0);
  assert.equal((await como('authenticated', U.alumnaA,
    `select * from public.instagram_conexion where workspace_id = '${WS.B}'`)).length, 0);
});

test('un usuario autenticado sin membresia no ve nada', async () => {
  for (const objeto of ['workspace', 'workspace_miembro', 'instagram_conexion', 'v_instagram_conexion']) {
    assert.equal((await como('authenticated', U.sinMembresia, `select * from public.${objeto}`)).length, 0, objeto);
  }
});

test('una membresia en estado invitado todavia no da acceso', async () => {
  assert.equal((await como('authenticated', U.invitado, 'select * from public.workspace')).length, 0);
  assert.equal((await como('authenticated', U.invitado, 'select * from public.instagram_conexion')).length, 0);
});

test('authenticated sin JWT (sub vacio) no ve nada', async () => {
  assert.equal((await como('authenticated', null, 'select * from public.workspace')).length, 0);
});

test('el navegador no crea, mueve ni borra conexiones ni membresias', async () => {
  const intentos = [
    `insert into public.instagram_conexion (workspace_id, instagram_user_id, conectada_por) values ('${WS.B}', 'ig-x', '${U.alumnaA}')`,
    `update public.instagram_conexion set workspace_id = '${WS.A}' where instagram_user_id = 'ig-b'`,
    `delete from public.instagram_conexion`,
    `insert into public.workspace_miembro (workspace_id, usuario_id, rol) values ('${WS.B}', '${U.alumnaA}', 'admin')`,
    `update public.workspace_miembro set rol = 'admin'`,
    `insert into public.workspace (nombre, slug) values ('x', 'x-x')`,
  ];
  for (const sql of intentos) {
    await assert.rejects(como('authenticated', U.alumnaA, sql), /permission denied/, sql);
  }
});

test('el esquema private (tokens y estados OAuth) es inaccesible para anon y authenticated', async () => {
  for (const rol of ['anon', 'authenticated']) {
    for (const tabla of ['instagram_credencial', 'instagram_oauth_estado']) {
      await assert.rejects(como(rol, U.alumnaA, `select * from private.${tabla}`), /permission denied/, `${rol} -> ${tabla}`);
    }
  }
});

test('la misma cuenta de Instagram no puede pertenecer a dos workspaces', async () => {
  await db.exec('begin');
  try {
    await assert.rejects(
      db.query(`insert into public.instagram_conexion (workspace_id, instagram_user_id, conectada_por)
                values ('${WS.B}', 'ig-a', '${U.alumnoB}')`),
      /duplicate key|unique/);
  } finally {
    await db.exec('rollback');
  }
});

test('borrar un workspace arrastra sus membresias y conexiones, sin tocar las de otro', async () => {
  await db.exec('begin');
  try {
    await db.query(`delete from public.workspace where id = '${WS.A}'`);
    const quedan = (await db.query('select workspace_id from public.instagram_conexion')).rows;
    assert.deepEqual(quedan.map((r) => r.workspace_id), [WS.B]);
    const miembros = (await db.query(`select 1 from public.workspace_miembro where workspace_id = '${WS.A}'`)).rows;
    assert.equal(miembros.length, 0);
  } finally {
    await db.exec('rollback');
  }
});
