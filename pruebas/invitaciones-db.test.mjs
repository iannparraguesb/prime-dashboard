// Ejecuta 0016 contra Postgres real (PGlite). Lo que tiene que ser imposible:
// que alguien fuera de admin cree o revoque codigos, que el navegador reserve o
// consuma uno, que un codigo sirva dos veces, vencido o revocado, y que el hash
// se pueda leer.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

const M0016 = await readFile(new URL('../supabase/migrations/0016_invitaciones_alumnos.sql', import.meta.url), 'utf8');

const SHIM = `
  create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
  create schema auth;
  create function auth.uid() returns uuid language sql stable as
    $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  grant usage on schema auth to anon, authenticated, service_role;
  grant execute on function auth.uid() to anon, authenticated, service_role;
  grant usage on schema public to anon, authenticated, service_role;
  alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
  alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
  create table public.usuario (id uuid primary key, rol text);
`;

const U = {
  admin: '00000000-0000-4000-8000-0000000000a1',
  lectura: '00000000-0000-4000-8000-0000000000b2',
  alumno: '00000000-0000-4000-8000-0000000000c3',
  otro: '00000000-0000-4000-8000-0000000000d4',
};
const H = (c) => c.repeat(64);

const db = new PGlite();
await db.exec(SHIM);
await db.exec(M0016);
await db.exec(M0016); // idempotente
await db.exec(`insert into public.usuario values ('${U.admin}', 'admin'), ('${U.lectura}', 'lectura');`);

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
/** Igual que `como`, pero confirma: para encadenar pasos del registro. */
async function fijo(rol, usuario, sql, params = []) {
  await db.exec('begin');
  try {
    await db.exec(`set local role ${rol}`);
    if (usuario) await db.query(`select set_config('request.jwt.claim.sub', $1, true)`, [usuario]);
    const r = (await db.query(sql, params)).rows;
    await db.exec('commit');
    return r;
  } catch (e) {
    await db.exec('rollback');
    throw e;
  }
}
const crear = (hash, nota = 'Alumno', dias = 14) =>
  fijo('authenticated', U.admin, 'select * from public.crear_invitacion_alumno($1, $2, $3)', [hash, nota, dias]);
const reservar = (hash) => fijo('service_role', null, 'select public.reservar_invitacion_alumno($1) as id', [hash]).then((r) => r[0].id);

test('solo admin crea codigos; el equipo sin rol admin y los alumnos no', async () => {
  const [c] = await como('authenticated', U.admin, "select * from public.crear_invitacion_alumno($1, 'Ana', 14)", [H('1')]);
  assert.ok(c.id);
  for (const u of [U.lectura, U.alumno]) {
    await assert.rejects(como('authenticated', u, "select * from public.crear_invitacion_alumno($1, 'X', 14)", [H('2')]), /sin_permiso/);
  }
  await assert.rejects(como('anon', null, "select * from public.crear_invitacion_alumno($1, 'X', 14)", [H('2')]), /permission denied/);
});

test('hash, nota y vigencia invalidos no entran', async () => {
  await assert.rejects(como('authenticated', U.admin, "select * from public.crear_invitacion_alumno('corto', 'X', 14)"), /codigo_invalido/);
  await assert.rejects(como('authenticated', U.admin, "select * from public.crear_invitacion_alumno($1, '   ', 14)", [H('3')]), /check/);
  await assert.rejects(como('authenticated', U.admin, "select * from public.crear_invitacion_alumno($1, 'X', 0)", [H('3')]), /vigencia_invalida/);
  await assert.rejects(como('authenticated', U.admin, "select * from public.crear_invitacion_alumno($1, 'X', 61)", [H('3')]), /vigencia_invalida/);
});

test('admin lista sin poder leer el hash; nadie mas ve la tabla', async () => {
  await crear(H('4'), 'Bea');
  const filas = await como('authenticated', U.admin, 'select id, nota, usado_en from public.invitacion_alumno');
  assert.ok(filas.some((f) => f.nota === 'Bea'));
  await assert.rejects(como('authenticated', U.admin, 'select codigo_hash from public.invitacion_alumno'), /permission denied/);
  assert.deepEqual(await como('authenticated', U.lectura, 'select id from public.invitacion_alumno'), []);
  assert.deepEqual(await como('authenticated', U.alumno, 'select id from public.invitacion_alumno'), []);
  await assert.rejects(como('anon', null, 'select id from public.invitacion_alumno'), /permission denied/);
});

test('el navegador no escribe la tabla ni llama a las funciones del registro', async () => {
  await assert.rejects(como('authenticated', U.admin, "insert into public.invitacion_alumno (codigo_hash, nota, creado_por, expira_en) values ($1, 'x', $2, now())", [H('5'), U.admin]), /permission denied/);
  await assert.rejects(como('authenticated', U.admin, 'update public.invitacion_alumno set revocado_en = null'), /permission denied/);
  for (const [rol, u] of [['authenticated', U.admin], ['authenticated', U.alumno], ['anon', null]]) {
    await assert.rejects(como(rol, u, 'select public.reservar_invitacion_alumno($1)', [H('4')]), /permission denied/);
    await assert.rejects(como(rol, u, "select public.confirmar_invitacion_alumno(gen_random_uuid(), gen_random_uuid())"), /permission denied/);
    await assert.rejects(como(rol, u, 'select public.liberar_invitacion_alumno(gen_random_uuid())'), /permission denied/);
  }
});

test('un codigo sirve una sola vez', async () => {
  await crear(H('6'));
  const id = await reservar(H('6'));
  assert.ok(id);
  assert.equal(await reservar(H('6')), null, 'reservado: un segundo registro concurrente pierde');
  const [ok] = await fijo('service_role', null, 'select public.confirmar_invitacion_alumno($1, $2) as ok', [id, U.alumno]);
  assert.equal(ok.ok, true);
  await fijo('service_role', null, 'select public.liberar_invitacion_alumno($1)', [id]);
  assert.equal(await reservar(H('6')), null, 'usado: liberar ya no lo devuelve');
});

test('liberar devuelve el codigo si la cuenta no se pudo crear', async () => {
  await crear(H('7'));
  const id = await reservar(H('7'));
  await fijo('service_role', null, 'select public.liberar_invitacion_alumno($1)', [id]);
  assert.equal(await reservar(H('7')), id);
});

test('una reserva abandonada caduca a los 5 minutos', async () => {
  await crear(H('8'));
  const id = await reservar(H('8'));
  await db.query("update public.invitacion_alumno set reservado_en = now() - interval '6 minutes' where id = $1", [id]);
  assert.equal(await reservar(H('8')), id);
});

test('vencido o revocado no sirve; revocar uno usado no hace nada', async () => {
  await crear(H('9'));
  await db.query("update public.invitacion_alumno set expira_en = now() - interval '1 minute' where codigo_hash = $1", [H('9')]);
  assert.equal(await reservar(H('9')), null);

  const [r] = await crear(H('a'));
  const [rev] = await fijo('authenticated', U.admin, 'select public.revocar_invitacion_alumno($1) as ok', [r.id]);
  assert.equal(rev.ok, true);
  assert.equal(await reservar(H('a')), null);

  const [u] = await crear(H('b'));
  const idU = await reservar(H('b'));
  await fijo('service_role', null, 'select public.confirmar_invitacion_alumno($1, $2)', [idU, U.otro]);
  const [rev2] = await fijo('authenticated', U.admin, 'select public.revocar_invitacion_alumno($1) as ok', [u.id]);
  assert.equal(rev2.ok, false);
  await assert.rejects(como('authenticated', U.lectura, 'select public.revocar_invitacion_alumno($1)', [u.id]), /sin_permiso/);
});

test('una cuenta no puede quedar ligada a dos codigos', async () => {
  await crear(H('c'));
  const id = await reservar(H('c'));
  await assert.rejects(fijo('service_role', null, 'select public.confirmar_invitacion_alumno($1, $2)', [id, U.alumno]), /unique|duplicate/);
});
