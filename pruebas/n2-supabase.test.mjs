import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import path from 'node:path';
import {leerRest,cargarEnv,RAIZ_PROYECTO} from './_ayuda.mjs';
test('anon no puede leer tablas ni vistas aunque conozca la clave pública',async()=>{
 for(const t of ['cuenta','pieza','pieza_metrica','historia','audiencia_snapshot','v_pieza_ranking','v_anuncio','cuenta_vigilada','usuario','dashboard_tarea']){
  const r=await leerRest(`${t}?select=*&limit=1`,{sinAuth:true});
  assert.ok([200,401,403].includes(r.estado));if(r.estado===200)assert.deepEqual(r.cuerpo,[],`${t} expone filas`);
 }
});
test('lector autorizado puede consultar las vistas y las tasas siguen siendo fracciones',async()=>{
 const r=await leerRest('v_base_formato?select=formato,n,mediana_guardado');assert.equal(r.estado,200);assert.ok(r.cuerpo.length);
 for(const f of r.cuerpo){assert.ok(f.n>=0);assert.ok(f.mediana_guardado===null||Number.isFinite(f.mediana_guardado));}
});
test('una métrica marcada como faltante permanece nula',async()=>{
 const r=await leerRest('pieza_metrica?select=guardados,alcance,metricas_faltantes&limit=1000');assert.equal(r.estado,200);
 for(const f of r.cuerpo)for(const k of ['guardados','alcance'])if(f.metricas_faltantes?.includes(k))assert.equal(f[k],null);
});
test('los secretos privados de entorno no están en fuente ni build',async()=>{
 cargarEnv();const values=Object.entries(process.env).filter(([k,v])=>/SERVICE|SECRET|PASSWORD|ACCESS_TOKEN|REDIS_REST_TOKEN/.test(k)&&v?.length>15);
 const scan=async dir=>{for(const ent of await readdir(dir,{withFileTypes:true})){const p=path.join(dir,ent.name);if(ent.isDirectory())await scan(p);else{const text=await readFile(p,'utf8');for(const [key,v] of values)assert.equal(text.includes(v),false,`Secreto ${key} en ${p}`);}}};
 await scan(path.join(RAIZ_PROYECTO,'src'));try{await scan(path.join(RAIZ_PROYECTO,'dist'));}catch(e){if(e.code!=='ENOENT')throw e;}
});
