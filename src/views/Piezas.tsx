import { useEffect, useState } from 'react';
import { useApi } from '../hooks/useApi';
import { ReelCard } from '../components/ReelCard';
import { Vista, EsqueletoGrilla } from '../components/states';
import { Base } from '../components/ui';
import type { Analisis, Pieza, Rol } from '../tipos';

interface Catalogo {filas:(Pieza & {apto_ranking:boolean})[];total:number;pagina:number;paginas:number;error?:string}
export function Piezas({d,rol,jwt}:{d:Analisis;rol:Rol;jwt:string|null}) {
  const [f,setF] = useState(() => {
    const q = new URLSearchParams(window.location.search);
    return {dias:q.get('dias')||'90',formato:q.get('formato')||'todos',orden:q.get('orden')||(rol==='direccion'?'fecha':'guardado'),buscar:q.get('buscar')||'',solidas:q.get('solidas')==='true',pagina:1};
  });
  const [busqueda,setBusqueda] = useState(f.buscar);
  useEffect(()=>{const t=window.setTimeout(()=>setF(v=>({...v,buscar:busqueda,pagina:1})),300);return ()=>window.clearTimeout(t);},[busqueda]);
  const params = new URLSearchParams({...f,solidas:String(f.solidas),pagina:String(f.pagina)});
  const query=params.toString();
  useEffect(()=>{window.history.replaceState(null,'',`?${query}#piezas`);},[query]);
  const estado=useApi<Catalogo>(`/api/catalogo?${query}`,jwt);
  return <>
    <div className="card filtros">
      <label className="filtro-grupo">Buscar publicación<input className="control" value={busqueda} maxLength={100} onChange={e=>setBusqueda(e.target.value)} placeholder="Busca en el texto" /></label>
      <label className="filtro-grupo">Publicada en<select className="control" value={f.dias} onChange={e=>setF({...f,dias:e.target.value,pagina:1})}>
        <option value="7">7 días</option><option value="30">30 días</option><option value="90">90 días</option><option value="365">12 meses</option>
      </select></label>
      <label className="filtro-grupo">Formato<select className="control" value={f.formato} onChange={e=>setF({...f,formato:e.target.value,pagina:1})}>
        <option value="todos">Todos</option><option value="REEL">Reel</option><option value="CARRUSEL">Carrusel</option><option value="IMAGEN">Imagen</option><option value="OTRO">Otro</option>
      </select></label>
      <label className="filtro-grupo">Ordenar<select className="control" value={f.orden} onChange={e=>setF({...f,orden:e.target.value,pagina:1})}>
        <option value="fecha">Más reciente</option><option value="guardado">Tasa de guardado</option><option value="alcance">Alcance</option>
      </select></label>
      <label><input type="checkbox" checked={f.solidas} onChange={e=>setF({...f,solidas:e.target.checked,pagina:1})}/> Solo muestra suficiente para ranking</label>
    </div>
    <Base>El período filtra la fecha de publicación. Las métricas son acumuladas hasta su medición. Las piezas bajo {d.piso_alcance} de alcance siguen visibles; no se comparan como una muestra sólida.</Base>
    <Vista estado={estado} esqueleto={<EsqueletoGrilla />}>
      {c=><>
        <p role="status">{c.total} publicaciones · Página {c.pagina} de {c.paginas}</p>
        {!c.filas.length?<div className="card estado"><h3>No hay publicaciones con estos filtros</h3><p>Amplía el período o borra la búsqueda.</p><button className="btn" onClick={()=>{setBusqueda('');setF({...f,buscar:'',dias:'365',formato:'todos',solidas:false,pagina:1});}}>Restablecer filtros</button></div>:null}
        <div className="grilla">{c.filas.map(p=><div key={p.id}>{!p.apto_ranking?<p className="base">Muestra insuficiente para ranking</p>:null}<ReelCard pieza={p} orden={f.orden==='fecha'?'fecha':f.orden==='alcance'?'alcance':'guardado_pct'}/></div>)}</div>
        <div className="acciones-plan"><button className="btn" disabled={f.pagina<=1} onClick={()=>setF({...f,pagina:f.pagina-1})}>Anterior</button><button className="btn" disabled={f.pagina>=c.paginas} onClick={()=>setF({...f,pagina:f.pagina+1})}>Siguiente</button></div>
      </>}
    </Vista>
  </>;
}
