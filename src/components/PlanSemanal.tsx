import { useState } from 'react';
import { useApi } from '../hooks/useApi';
import { Vista } from './states';
import type { Propuesta } from '../tipos';
interface Tarea {id:string;titulo:string;nota:string|null;fecha:string|null;estado:'pendiente'|'en_produccion'|'publicada'}
interface Lista {filas:Tarea[];error?:string}
export function PlanSemanal({jwt,propuestas}:{jwt:string|null;propuestas:Propuesta[]}) {
  const estado=useApi<Lista>('/api/plan',jwt);
  const [titulo,setTitulo]=useState(''); const [fecha,setFecha]=useState('');
  const [nota,setNota]=useState('');const [ocupado,setOcupado]=useState(false);const [mensaje,setMensaje]=useState('');
  const guardar=async(method:string,body:object)=>{
    if(ocupado)return;
    setOcupado(true);setMensaje('');
    try{
      const r=await fetch('/api/plan',{method,headers:{'content-type':'application/json',authorization:`Bearer ${jwt}`},body:JSON.stringify(body)});
      const d=await r.json();if(!r.ok)throw new Error(d.error||'No se pudo guardar.');
      estado.recargar();if(method==='POST'){setTitulo('');setNota('');setFecha('');}setMensaje('Cambios guardados.');
    }catch(e){setMensaje(e instanceof Error?e.message:'No se pudo guardar.');}finally{setOcupado(false);}
  };
  return <section className="card metodologia"><h2>Mi plan de contenido</h2><p>Guarda una idea, asigna una fecha y sigue su avance. Este plan es privado para tu cuenta del dashboard.</p>
    <form className="plan-form" onSubmit={e=>{e.preventDefault();void guardar('POST',{titulo,nota:nota||null,fecha:fecha||null});}}>
      <label>Próxima pieza<input className="control" value={titulo} maxLength={160} required onChange={e=>setTitulo(e.target.value)} placeholder="Qué voy a publicar"/></label>
      <label>Fecha prevista<input className="control" type="date" value={fecha} onChange={e=>setFecha(e.target.value)}/></label>
      <label>Notas: hook, guion, visual o CTA<textarea className="control" maxLength={2000} value={nota} onChange={e=>setNota(e.target.value)}/></label>
      <button className="btn" disabled={ocupado||!titulo.trim()}>Guardar idea</button>
    </form>
    {propuestas.length?<div className="acciones-plan"><button className="btn" onClick={()=>{setTitulo(propuestas[0].titulo.slice(0,160));setNota(propuestas[0].motivo.slice(0,2000));}}>Usar la primera recomendación</button></div>:null}
    {mensaje?<p role="status">{mensaje}</p>:null}
    <Vista estado={estado}>{d=><div className="lista">{!d.filas.length?<p>Aún no guardaste ideas. Empieza por una acción concreta para esta semana.</p>:null}{d.filas.map(t=><article className="card tarea" key={t.id}><h3>{t.titulo}</h3><p>{t.nota}</p><span>{t.fecha||'Sin fecha prevista'}</span><label>Estado de {t.titulo}<select className="control" value={t.estado} disabled={ocupado} onChange={e=>void guardar('PATCH',{id:t.id,estado:e.target.value})}><option value="pendiente">Idea</option><option value="en_produccion">En producción</option><option value="publicada">Publicada</option></select></label><button className="btn" disabled={ocupado} onClick={()=>void guardar('DELETE',{id:t.id})}>Archivar</button></article>)}</div>}</Vista>
  </section>;
}
