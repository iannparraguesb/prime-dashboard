// Ejecuta 0015 contra Postgres real (PGlite). Lo que tiene que ser imposible:
// que alguien que no es admin lea o escriba metas, que anon toque la tabla, y
// que entre una meta con mes, metrica u objetivo invalidos.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

const M0015 = await readFile(new URL('../supabase/migrations/0015_metas_mensuales.sql', import.meta.url), 'utf8');

const SHIM = `
  create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
  create schema auth;
  create function auth.uid() returns uuid language sql stable as
    $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  grant usage on schema auth to anon, authenticated, service_role;
  grant execute on function auth.uid() to anon, authenticated, service_role;
  grant usage on schema public to anon, authenticated, service_role;
  alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
  create table public.usuario (id uuid primary key, rol text);
  grant select on public.usuario to authenticated;
`;

const U = {
  admin: '00000000-0000-4000-8000-0000000000a1',
  lectura: '00000000-0000-4000-8000-0000000000b2',
  alumno: '00000000-0000-4000-8000-0000000000c3',
};

const db = new PGlite();
await db.exec(SHIM);
await db.exec(M0015);
await db.exec(M0015); // idempotente: aplicarla dos veces no falla
await db.exec(`
  insert into public.usuario values ('${U.admin}', 'admin'), ('${U.lectura}', 'lectura');
  insert into public.meta_mensual (mes, metrica, objetivo) values ('2026-10-01', 'ventas', 10);
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

test('admin lee, crea, edita y borra metas', async () => {
  assert.equal((await como('authenticated', U.admin, 'select * from public.meta_mensual')).length, 1);
  const creada = await como('authenticated', U.admin,
    "insert into public.meta_mensual (mes, metrica, objetivo) values ('2026-10-01', 'agendas', 40) returning actualizado_por");
  assert.equal(creada[0].actualizado_por, U.admin);
  const editada = await como('authenticated', U.admin,
    "update public.meta_mensual set objetivo = 12 where metrica = 'ventas' returning objetivo");
  assert.equal(Number(editada[0].objetivo), 12);
  const borrada = await como('authenticated', U.admin, "delete from public.meta_mensual where metrica = 'ventas' returning metrica");
  assert.equal(borrada.length, 1);
});

test('equipo sin rol admin y alumnos no ven ni escriben metas', async () => {
  for (const u of [U.lectura, U.alumno]) {
    assert.deepEqual(await como('authenticated', u, 'select * from public.meta_mensual'), []);
    await assert.rejects(como('authenticated', u, "insert into public.meta_mensual (mes, metrica, objetivo) values ('2026-11-01', 'ventas', 5)"), /row-level security/);
    assert.deepEqual(await como('authenticated', u, "update public.meta_mensual set objetivo = 1 returning *"), []);
    assert.deepEqual(await como('authenticated', u, 'delete from public.meta_mensual returning *'), []);
  }
});

test('anon no tiene ningun privilegio sobre la tabla', async () => {
  await assert.rejects(como('anon', null, 'select * from public.meta_mensual'), /permission denied/);
});

test('mes, metrica y objetivo invalidos no entran', async () => {
  const insertar = (mes, metrica, objetivo) => como('authenticated', U.admin,
    'insert into public.meta_mensual (mes, metrica, objetivo) values ($1, $2, $3)', [mes, metrica, objetivo]);
  await assert.rejects(insertar('2026-10-15', 'ventas', 5), /check/);
  await assert.rejects(insertar('2026-10-01', 'views', 5), /check/);
  await assert.rejects(insertar('2026-10-01', 'ventas', 0), /check/);
  await assert.rejects(insertar('2026-10-01', 'ventas', -3), /check/);
});

test('el autor de una edicion lo pone la base, no el cliente', async () => {
  const r = await como('authenticated', U.admin,
    `update public.meta_mensual set objetivo = 11, actualizado_por = '${U.lectura}' where metrica = 'ventas' returning actualizado_por`);
  assert.equal(r[0].actualizado_por, U.admin);
});
