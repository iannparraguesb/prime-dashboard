import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { readBody, rateLimit, textField, uuid, HttpError } from '../backend/security.mjs';
const request=(body,headers={})=>Object.assign(Readable.from([Buffer.from(body)]),{headers:{'content-type':'application/json',...headers}});
test('body rechaza JSON inválido, arrays y exceso incluso sin Content-Length',async()=>{
  for(const [body,status] of [['{',400],['[]',400],['null',400],['{"a":"'+ 'x'.repeat(17000)+'"}',413]]){
    await assert.rejects(()=>readBody(request(body)),e=>e.status===status);
  }
  assert.deepEqual(await readBody(request('{"titulo":"Idea"}')),{titulo:'Idea'});
});
test('validación de campos no acepta objetos ni ids que cambien filtros',()=>{
  assert.throws(()=>textField({x:1},'Título',160),HttpError);
  assert.throws(()=>uuid('x&usuario_id=neq.x'),HttpError);
  assert.equal(textField(null,'Nota',10,true),null);
});
test('cuota de desarrollo separa identidades, vence y frena ráfagas',async()=>{
  const t=120000;
  assert.equal(await rateLimit('test:a',2,{},t),true);
  assert.equal(await rateLimit('test:a',2,{},t),true);
  assert.equal(await rateLimit('test:a',2,{},t),false);
  assert.equal(await rateLimit('test:b',2,{},t),true);
  assert.equal(await rateLimit('test:a',2,{},t+60000),true);
});
test('producción falla cerrada si no hay contador compartido',async()=>{
  await assert.rejects(()=>rateLimit('prod',60,{VERCEL:'1'}),e=>e.status===503);
});
test('un fallo del contador compartido no habilita acceso',async(t)=>{
  t.mock.method(globalThis,'fetch',async()=>{throw new Error('network')});
  await assert.rejects(()=>rateLimit('prod',60,{UPSTASH_REDIS_REST_URL:'https://invalid.test',UPSTASH_REDIS_REST_TOKEN:'dummy'}),e=>e.status===503);
});

test('el contador acepta las variables KV_REST_API_* de la integración de Vercel', async(t)=>{
  const llamadas = [];
  t.mock.method(globalThis,'fetch',async(url,opts)=>{ llamadas.push({url, auth: opts.headers.authorization});
    return { ok: true, json: async()=>({result: 1}) }; });
  const env = {VERCEL:'1', KV_REST_API_URL:'https://kv.test', KV_REST_API_TOKEN:'escritura',
               KV_REST_API_READ_ONLY_TOKEN:'solo-lectura'};
  assert.equal(await rateLimit('prod',60,env), true);
  assert.equal(llamadas[0].url, 'https://kv.test');
  assert.equal(llamadas[0].auth, 'Bearer escritura', 'nunca debe usar el token de solo lectura');
});
test('UPSTASH_REDIS_REST_* tiene prioridad sobre KV_REST_API_*', async(t)=>{
  let usada;
  t.mock.method(globalThis,'fetch',async(url)=>{ usada = url; return { ok: true, json: async()=>({result: 1}) }; });
  await rateLimit('prod',60,{VERCEL:'1', UPSTASH_REDIS_REST_URL:'https://up.test', UPSTASH_REDIS_REST_TOKEN:'a',
                             KV_REST_API_URL:'https://kv.test', KV_REST_API_TOKEN:'b'});
  assert.equal(usada, 'https://up.test');
});
test('solo el token de lectura no basta: produccion sigue fallando cerrado', async()=>{
  await assert.rejects(()=>rateLimit('prod',60,{VERCEL:'1', KV_REST_API_URL:'https://kv.test',
    KV_REST_API_READ_ONLY_TOKEN:'solo-lectura'}), e=>e.status===503);
});

test('body de Vercel conserva validación de tipo y tamaño', async()=> {
  const req = body => ({headers: {'content-type':'application/json'}, body});
  assert.deepEqual(await readBody(req({titulo:'Idea'})), {titulo:'Idea'});
  for (const [body,status] of [[[],400],['{',400],[{titulo:'x'.repeat(17000)},413]]) {
    await assert.rejects(()=>readBody(req(body)), e=>e.status===status);
  }
});
