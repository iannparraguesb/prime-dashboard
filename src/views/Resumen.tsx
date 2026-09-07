import { useState } from 'react';
import { Base, Kpi, Nota, NOMBRE_FORMATO, num, pct, compacto } from '../components/ui';
import { medianaDe } from '../components/SummaryPanel';
import type { Analisis } from '../tipos';

export function Resumen({d}:{d:Analisis}) {
  const [dias,setDias]=useState(30);
  const ahora=Date.now();
  const dentro=(fecha:string)=>{const edad=ahora-new Date(fecha).getTime();return edad>=0&&edad<dias*86400000;};
  const recientes=(d.calendario||[]).filter(p=>dentro(p.fecha));
  const solidas=d.rankings.todas.filter(p=>dentro(p.fecha));
  const alcances=recientes.map(p=>p.alcance).filter((n):n is number=>n!==null&&n!==undefined);
  const suma=alcances.length?alcances.reduce((a,b)=>a+b,0):null;
  const antiguedad=d.snapshot?Math.floor((ahora-Date.parse(`${d.snapshot}T00:00:00Z`))/86400000):null;
  const propuesta=d.mesa.propuestas[0];
  return <div className="lista" style={{gap:'var(--e5)'}}>
    <div className="resumen-encabezado"><div><h2>Tu contenido, con una próxima acción</h2><p>Revisa qué publicaste y qué vale la pena repetir.</p></div>
    <label>Publicaciones de los últimos <select className="control" value={dias} onChange={e=>setDias(Number(e.target.value))}><option value={7}>7 días</option><option value={30}>30 días</option><option value={90}>90 días</option></select></label></div>
    <div className="card frescura" role="status" data-antigua={antiguedad===null||antiguedad>2}>
      <strong>{d.snapshot?`Última medición de contenido: ${d.snapshot}`:'Sin medición disponible'}</strong>
      <span>{antiguedad!==null&&antiguedad>2?`Los datos llevan ${antiguedad} días sin una medición nueva. El equipo debe revisar la sincronización.`:'Volver a cargar consulta los datos guardados; no inicia una sincronización de Instagram.'}</span>
    </div>
    <div className="kpis">
      <Kpi etiqueta="Seguidores" valor={num(d.cuenta.followers_count)} pie={`@${d.cuenta.username??'—'} · última medición de cuenta`} icono="perfil"/>
      <Kpi etiqueta={`Publicado en ${dias} días`} valor={num(recientes.length)} pie="Todas las publicaciones, incluido bajo alcance" icono="piezas"/>
      <Kpi etiqueta="Tasa de guardado típica" valor={pct(medianaDe(solidas.map(p=>p.guardado_pct)),2)} pie={`${solidas.length} piezas con muestra suficiente`} icono="guardado"/>
      <Kpi etiqueta="Alcance acumulado de estas piezas" valor={compacto(suma)} pie="Suma por publicación; no son personas únicas" icono="alcance"/>
    </div>
    <Base>Seleccionar {dias} días filtra publicaciones por fecha, no limita cuándo recibieron sus interacciones. Las métricas son acumuladas al snapshot. Una métrica no disponible se muestra como —.</Base>
    <section className="card foco-semanal"><span className="kpi-lbl">Para tu próxima sesión de contenido</span><h2>{propuesta?.accion||'Construye tu próxima muestra'}</h2><p>{propuesta?.motivo||'Publica con constancia. Las recomendaciones aparecerán cuando haya suficiente información para comparar piezas del mismo formato.'}</p><a className="btn" href="#mesa">Abrir Mesa de trabajo</a></section>
    <section><h2>Tu referencia por formato</h2><div className="tabla-caja"><table><thead><tr><th>Formato</th><th>Piezas</th><th>Guardado habitual</th></tr></thead><tbody>{Object.entries(d.base_por_formato).map(([f,v])=><tr key={f}><td>{NOMBRE_FORMATO[f]||f}</td><td>{num(v.n)}</td><td>{pct(v.guardado_pct_mediana,2)}</td></tr>)}</tbody></table></div><Base>Mediana por formato en la ventana de {d.ventana_meses||12} meses. Esta referencia no cambia al seleccionar 7/30/90 días arriba.</Base></section>
    <details className="card metodologia"><summary>Cómo leer estos números</summary><Nota>El ranking compara tasas de guardado con la mediana del mismo formato. El piso de {d.piso_alcance} de alcance limita el ruido estadístico, pero nunca oculta tus publicaciones del catálogo.</Nota><Base>{d.n_total} piezas en la ventana · {d.n_con_alcance} con alcance medido · {d.n_solidos} aptas para ranking. Consulta Piezas para revisar el detalle de cada publicación.</Base></details>
  </div>;
}
