import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import { levantarApi, bajarApi, obtenerJwt, leerRest, contarFilas } from './_ayuda.mjs';
let api,jwt,analisis;
before(async()=>{api=await levantarApi();jwt=await obtenerJwt();const r=await fetch(api.base+'/api/analisis',{headers:{authorization:`Bearer ${jwt}`}});assert.equal(r.status,200);analisis=await r.json();assert.ok(!analisis.error,analisis.error);});
after(async()=>await bajarApi(api));
const pedir=(p,options={})=>fetch(api.base+p,{...options,headers:{authorization:`Bearer ${jwt}`,...options.headers}});
test('sin sesión o JWT inválido: 401, sin detalles internos ni datos',async()=>{
 for(const authorization of ['', 'Bearer invalid']){const r=await pedir('/api/analisis',{headers:{authorization}});assert.equal(r.status,401);const d=await r.json();assert.ok(d.error);assert.ok(!d.detalle&&!d.rankings&&!d.comando);}
});
test('métodos y rutas incorrectos no hacen trabajo de dominio',async()=>{
 assert.equal((await pedir('/api/analisis',{method:'POST'})).status,405);
 assert.equal((await pedir('/api/no-existe')).status,404);
 assert.equal((await pedir('/api/catalogo?pagina=-1')).status,400);
});
test('contrato de ventana: cuenta todas las publicaciones actuales sin anclas temporales obsoletas',async()=>{
 // No descargar la vista completa: PostgREST pagina a 1.000 filas por defecto.
 // El historial ya supera ese limite, y filtrar en JS producia un conteo parcial.
 const propias='v_pieza_ranking?cuenta_id=not.like.externa:*';
 const [enVentana,solidas]=await Promise.all([
  contarFilas(`${propias}&en_ventana=is.true`),
  contarFilas(`${propias}&apto_ranking=is.true`),
 ]);
 assert.equal(analisis.n_total,enVentana);
 assert.equal(analisis.n_solidos,solidas);
 assert.equal(analisis.calendario.length,analisis.n_total);
 assert.equal(analisis.rankings.todas.length,analisis.n_solidos);
});
test('conversión de fracciones SQL a porcentajes y nulos',async()=>{
 const r=await leerRest('v_base_formato?select=formato,mediana_guardado,n');
 for(const row of r.cuerpo){const b=analisis.base_por_formato[row.formato];assert.equal(b.n,row.n);if(row.mediana_guardado===null)assert.equal(b.guardado_pct_mediana,null);else assert.ok(Math.abs(b.guardado_pct_mediana-row.mediana_guardado*100)<0.0001);}
 assert.ok(analisis.rankings.todas.some(x=>Object.values(x).includes(null)));
});
test('resumen liviano y catálogo paginado tienen contratos de pantalla',async()=>{
 const r=await pedir('/api/analisis?seccion=resumen');const raw=await r.text();assert.equal(r.status,200);assert.ok(Buffer.byteLength(raw)<50000,`Resumen pesa ${Buffer.byteLength(raw)}`);
 const c=await pedir('/api/catalogo?dias=365');const d=await c.json();assert.equal(c.status,200);assert.ok(d.filas.length<=24);assert.ok(d.total>=d.filas.length);assert.ok(d.filas.every(x=>typeof x.apto_ranking==='boolean'));
});
test('lector no modifica competidores y las respuestas no se cachean públicamente',async()=>{
 const r=await pedir('/api/competidores',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({username:'audit_non_mutating'})});assert.equal(r.status,403);
 const health=await pedir('/api/salud');assert.match(health.headers.get('cache-control'),/no-store/);assert.equal(health.headers.get('access-control-allow-origin'),null);
});
