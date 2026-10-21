import { NADA, num, pct } from "./ui";
import { METRICAS_META, ritmoMeta, type MetricaMeta } from "../lib/metas";
import type { Negocio, PeriodoNegocio } from "../tipos";

const ORDEN = Object.keys(METRICAS_META) as MetricaMeta[];
const usd = (v: number) => `US$${Math.round(v).toLocaleString("es-CL")}`;
const valor = (k: MetricaMeta, v: number) => (METRICAS_META[k].usd ? usd(v) : num(Math.round(v)));

/** Version compacta de las metas del mes, para la columna del Dashboard. La
 *  edicion vive en Ventas: aca solo se lee el ritmo. */
export function MetasMes({ n, mes }: { n: Negocio; mes: PeriodoNegocio }) {
  const metas = (n.metas ?? []).filter((x) => x.mes === mes.inicio)
    .sort((a, b) => ORDEN.indexOf(a.metrica) - ORDEN.indexOf(b.metrica));
  const { dia, dias } = ritmoMeta(0, 1, mes.inicio, n.hoy);

  return (
    <div className="card dash-lado-card">
      <div className="dash-lado-cab">
        <span className="kpi-lbl">Metas del mes</span>
        <a href="#negocio" className="dash-enlace">Configurar →</a>
      </div>
      {n.metas === null ? (
        <p className="dash-vacio">Falta aplicar la migración de metas.</p>
      ) : !metas.length ? (
        <p className="dash-vacio">No hay metas configuradas. <a href="#negocio" className="dash-enlace">+ Configurar metas</a></p>
      ) : (
        <>
          <small className="dash-sub">Día {dia} de {dias} · {pct((dia / dias) * 100, 0)} del mes</small>
          {metas.map((m) => {
            const actual = mes[m.metrica];
            const r = ritmoMeta(actual, m.objetivo, m.mes, n.hoy);
            const atras = r.estado === "atras" || r.estado === "no_cumplida";
            return (
              <div className="meta-mini" key={m.metrica}>
                <div className="meta-mini-fila">
                  <span>{METRICAS_META[m.metrica].nombre}</span>
                  <strong className="num">{actual === null ? NADA : valor(m.metrica, actual)} <small>/ {valor(m.metrica, m.objetivo)}</small></strong>
                </div>
                <div className="neg-meta-barra meta-barra" role="img" aria-label={`${pct(r.logrado, 0)} de la meta`}>
                  {r.logrado !== null ? <span style={{ width: `${Math.min(r.logrado, 100)}%` }} /> : null}
                  {!r.cerrado && r.estado !== "cumplida" ? <i className="meta-ritmo" style={{ left: `${Math.min((r.esperado / m.objetivo) * 100, 100)}%` }} /> : null}
                </div>
                <small className={atras ? "meta-mini-atras" : "dash-sub"}>
                  {r.estado === "sin_dato" ? "sin dato" : r.estado === "cumplida" ? "cumplida" : atras ? "por detrás del ritmo" : "adelante del ritmo"}
                </small>
              </div>
            );
          })}
        </>
      )}
    </div>
  );
}
