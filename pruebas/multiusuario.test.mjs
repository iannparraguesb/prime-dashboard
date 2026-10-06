import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const sql = await readFile(new URL('../supabase/migrations/0008_multiusuario_instagram.sql', import.meta.url), 'utf8');

test('la migración multiusuario es aditiva y crea membresías, conexiones y estados OAuth',()=>{
  for (const tabla of ['workspace','workspace_miembro','instagram_conexion']) {
    assert.match(sql,new RegExp(`create table if not exists public\\.${tabla}`,'i'));
  }
  assert.match(sql,/create table if not exists private\.instagram_oauth_estado/i);
  assert.doesNotMatch(sql,/drop\s+(table|column)/i);
});

test('anon no recibe lectura y las políticas se anclan en auth.uid()',()=>{
  assert.match(sql,/revoke all on public\.workspace from anon/i);
  assert.match(sql,/revoke all on public\.instagram_conexion from anon/i);
  assert.match(sql,/auth\.uid\(\)/i);
  assert.doesNotMatch(sql,/to\s+anon\s*,\s*authenticated\s+using\s*\(true\)/i);
});

test('los tokens no viven en tablas públicas ni se conceden a authenticated',()=>{
  assert.match(sql,/create schema if not exists private/i);
  assert.match(sql,/create table if not exists private\.instagram_credencial/i);
  assert.match(sql,/revoke all on private\.instagram_credencial from public, anon, authenticated/i);
  assert.doesNotMatch(sql,/grant[^;]+instagram_credencial[^;]+authenticated/i);
});

test('las vistas tenant-aware usan security_invoker y conservan workspace_id',()=>{
  assert.match(sql,/create or replace view public\.v_instagram_conexion\s+with \(security_invoker = true\)/i);
  assert.match(sql,/workspace_id/i);
});
