import { useEffect, useMemo, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Delta, NADA, NOMBRE_FORMATO, num, compacto, pct } from "../components/ui";
import { GraficoBarras } from "../components/GraficoBarras";
import { MetasMes } from "../components/MetasMes";
import { Icono, type NombreIcono } from "../components/icons";
import { useApi } from "../hooks/useApi";
import { Calendario } from "./Calendario";
import type { Analisis, FilaCalendario, Numerico } from "../tipos";

const DIA = 86_400_000;
const MES_CORTO = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
const diaMes = (iso: string) => `${Number(iso.slice(8, 10))} ${MES_CORTO[Number(iso.slice(5, 7)) - 1]}`;
const isoDia = (t: number) => new Date(t).toISOString().slice(0, 10);
const usd = (v: Numerico | undefined) => (v === null || v === undefined ? NADA : `US$${Math.round(v).toLocaleString("es-CL")}`);

// Validados con scripts/validate_palette.js del skill dataviz, claro y oscuro,
// todos los pares. El dorado de Prime es siempre la serie principal.
const ORO = "#c67c0e";
const AZUL = "#4a7fd0";
const VERDE = "#1f9e89";

const sumar = (xs: (number | null | undefined)[]) => {
  const v = xs.filter((x): x is number => typeof x === "number");
  return v.length ? v.reduce((a, b) => a + b, 0) : null;
};

export function Resumen({ d, equipo = true, jwt = null, admin = false }: { d: Analisis; equipo?: boolean; jwt?: string | null; admin?: boolean }) {
  const [dias, setDias] = useState(30);
  const ahora = Date.now();
  const filas = d.calendario ?? [];
  // Ventas, metas y lo que vendio cada pieza: solo admin, como la pestaña Ventas.
  const neg = useApi<Analisis>("/api/analisis?seccion=negocio", admin ? jwt : null);
  const negocio = neg.datos?.negocio ?? null;
  const mesActual = negocio?.meses.length ? negocio.meses[negocio.meses.length - 1] : null;

  // El selector de periodo va en la cabecera, al lado del titulo, como en Moka.
  const [ancla, setAncla] = useState<HTMLElement | null>(null);
  useEffect(() => setAncla(document.getElementById("cabecera-acciones")), []);

  const desde = isoDia(ahora - dias * DIA);
  const desdePrevio = isoDia(ahora - 2 * dias * DIA);
  const { actual, previo } = useMemo(() => ({
    actual: filas.filter((p) => p.fecha >= desde),
    previo: filas.filter((p) => p.fecha >= desdePrevio && p.fecha < desde),
  }), [filas, desde, desdePrevio]);

  const historias = d.historias?.filas ?? [];
  const hActual = historias.filter((h) => (h.hora ?? "") >= desde);
  const hPrevio = historias.filter((h) => (h.hora ?? "") >= desdePrevio && (h.hora ?? "") < desde);

  const historial = d.cuenta.seguidores_historial ?? [];
  const baseSeg = historial.find((h) => h.fecha >= desde) ?? historial[0];
  const ganados = baseSeg && d.cuenta.followers_count !== null ? d.cuenta.followers_count - baseSeg.seguidores : null;

  const total = (xs: FilaCalendario[], k: keyof FilaCalendario) => sumar(xs.map((p) => p[k] as Numerico | undefined));
  const alcance = total(actual, "alcance");
  const guardados = total(actual, "guardados");
  const mejor = [...actual].filter((p) => p.thumb !== undefined && typeof p.guardados === "number")
    .sort((a, b) => (b.guardados ?? 0) - (a.guardados ?? 0));
  const grafico = useMemo(() => agrupar(actual, dias, ahora), [actual, dias, ahora]);
  const propuesta = d.mesa.propuestas[0];

  const selector = (
    <select className="control dash-periodo" value={dias} onChange={(e) => setDias(Number(e.target.value))} aria-label="Periodo">
      {[7, 30, 90].map((n) => <option key={n} value={n}>Últimos {n} días</option>)}
    </select>
  );

  return (
    <div className="dash">
      {ancla ? createPortal(selector, ancla) : <div className="neg-cabecera">{selector}</div>}

      <div className="dash-main">
        <div className="kpis dash-kpis">
          <Kpi icono="vista" titulo="Vistas totales" valor={compacto(total(actual, "vistas"))} pie={<Delta actual={total(actual, "vistas")} previo={total(previo, "vistas")} texto="vs anterior" />} />
          <Kpi icono="guardado" titulo="Guardados" valor={compacto(guardados)} pie={<Delta actual={guardados} previo={total(previo, "guardados")} texto="vs anterior" />} />
          <Kpi icono="comentario" titulo="Comentarios" valor={compacto(total(actual, "comentarios"))} pie={<Delta actual={total(actual, "comentarios")} previo={total(previo, "comentarios")} texto="vs anterior" />} />
          <Kpi icono="historias" titulo="Respuestas a historias" valor={compacto(sumar(hActual.map((h) => h.respuestas)))}
            pie={!hActual.length ? "sin historias en el periodo"
              : (sumar(hPrevio.map((h) => h.respuestas)) ?? 0) > 0
                ? <Delta actual={sumar(hActual.map((h) => h.respuestas))} previo={sumar(hPrevio.map((h) => h.respuestas))} texto="vs anterior" />
                : `en ${num(hActual.length)} historias capturadas`} />
        </div>

        {grafico.etiquetas.length ? (
          <div className="dash-graficos">
            <section className="card dash-grafico">
              <h2 className="dash-titulo">Alcance y visibilidad</h2>
              <GraficoBarras
                etiquetas={grafico.etiquetas}
                series={[
                  { nombre: "Vistas", color: ORO, valores: grafico.vistas },
                  { nombre: "Alcance", color: AZUL, valores: grafico.alcance },
                ]}
                formato={(v) => compacto(v)}
                detalle={(k) => <div>Publicaciones <span>{num(grafico.piezas[k])}</span></div>}
                alto={200}
              />
            </section>
            <section className="card dash-grafico">
              <h2 className="dash-titulo">Interacciones</h2>
              <GraficoBarras
                etiquetas={grafico.etiquetas}
                series={[
                  { nombre: "Guardados", color: ORO, valores: grafico.guardados },
                  { nombre: "Me gusta", color: AZUL, valores: grafico.likes },
                  { nombre: "Comentarios", color: VERDE, valores: grafico.comentarios },
                ]}
                formato={(v) => compacto(v)}
                alto={200}
              />
            </section>
          </div>
        ) : null}

        {negocio?.atribucion?.cobertura.ventas ? (
          <section className="card dash-bloque">
            <div className="dash-lado-cab">
              <h2 className="dash-titulo">Top fuentes de facturación</h2>
              <a href="#negocio" className="dash-enlace">Ver ventas →</a>
            </div>
            <FuentesFacturacion n={negocio} />
          </section>
        ) : null}

        {propuesta ? (
          <section className="card resumen-accion">
            {propuesta.thumb ? <img src={propuesta.thumb} alt="" loading="lazy" /> : null}
            <div>
              <span className="kpi-lbl">Tu próxima publicación</span>
              <h2>{propuesta.accion}</h2>
              <p>{propuesta.titulo}</p>
              <div style={{ display: "flex", gap: "var(--e2)", marginTop: "var(--e3)" }}>
                {equipo ? <a className="btn" href="#mesa">Ver ideas</a> : null}
                {propuesta.permalink ? <a className="btn" href={propuesta.permalink} target="_blank" rel="noreferrer">Abrir en Instagram</a> : null}
              </div>
            </div>
          </section>
        ) : null}

        <section>
          <h2 className="sec-titulo">Lo que más guardaron</h2>
          {mejor.length ? (
            <div className="top-grilla">
              {mejor.slice(0, 4).map((p, k) => <TarjetaPieza key={p.id} p={p} rango={k + 1} />)}
            </div>
          ) : (
            <div className="card" style={{ padding: "var(--e5)", color: "var(--texto-2)" }}>No hay publicaciones en este periodo.</div>
          )}
        </section>
      </div>

      <aside className="dash-lado">
        {admin ? (
          <>
            <div className="card kpi dash-dinero">
              <div className="kpi-lbl"><Icono nombre="dinero" size={13} /> Facturación del mes</div>
              <div className="kpi-val num">{neg.cargando && !negocio ? NADA : usd(mesActual?.ingresos_usd)}</div>
              <div className="kpi-pie">{mesActual?.ventas ? `${num(mesActual.ventas)} ${mesActual.ventas === 1 ? "cliente nuevo" : "clientes nuevos"}` : "sin ventas registradas este mes"}</div>
            </div>
            <div className="card kpi dash-dinero">
              <div className="kpi-lbl"><Icono nombre="megafono" size={13} /> Por cada US$1 en anuncios</div>
              <div className="kpi-val num">{mesActual?.roas_total === null || mesActual?.roas_total === undefined ? NADA : `US$${mesActual.roas_total.toLocaleString("es-CL", { maximumFractionDigits: 1 })}`}</div>
              <div className="kpi-pie">{mesActual ? `${usd(mesActual.gasto_usd)} invertidos este mes` : NADA}</div>
            </div>
          </>
        ) : null}

        <div className="card dash-lado-card">
          <span className="kpi-lbl">Resumen rápido</span>
          <Fila titulo="Alcance total" sub={`últimos ${dias} días`} valor={compacto(alcance)} />
          <Fila titulo="Tasa de guardado" sub="guardados / alcance" valor={alcance && guardados !== null ? pct((guardados / alcance) * 100, 2) : NADA} />
          <Fila titulo="Más guardada" sub={mejor[0] ? (mejor[0].primera_linea || "sin texto").slice(0, 34) : "sin publicaciones"} valor={compacto(mejor[0]?.guardados ?? null)} enlace={mejor[0]?.permalink ?? null} />
          <Fila titulo="Seguidores nuevos" sub={baseSeg ? `desde el ${diaMes(baseSeg.fecha)}` : `últimos ${dias} días`} valor={ganados === null ? NADA : `${ganados >= 0 ? "+" : ""}${num(ganados)}`} />
          <Fila titulo="Publicaciones" sub={hActual.length ? `+ ${num(hActual.length)} historias` : "sin historias capturadas"} valor={num(actual.length)} />
        </div>

        {admin && negocio && mesActual ? <MetasMes n={negocio} mes={mesActual} /> : null}
      </aside>

      <section className="dash-ancho">
        <h2 className="sec-titulo">Calendario de contenido</h2>
        <Calendario d={d} />
      </section>
    </div>
  );
}

function Kpi({ icono, titulo, valor, pie }: { icono: NombreIcono; titulo: string; valor: string; pie: ReactNode }) {
  return (
    <div className="card kpi">
      <div className="kpi-lbl"><Icono nombre={icono} size={13} /> {titulo}</div>
      <div className="kpi-val num">{valor}</div>
      <div className="kpi-pie">{pie}</div>
    </div>
  );
}

function Fila({ titulo, sub, valor, enlace = null }: { titulo: string; sub: string; valor: string; enlace?: string | null }) {
  const cuerpo = (
    <>
      <div><span>{titulo}</span><small>{sub}</small></div>
      <strong className="num">{valor}</strong>
    </>
  );
  return enlace ? <a className="dash-fila" href={enlace} target="_blank" rel="noreferrer">{cuerpo}</a> : <div className="dash-fila">{cuerpo}</div>;
}

/** De donde vino la plata: fuente anotada por el setter y, cuando hay link, la
 *  pieza exacta. Lo que Moka pide cargar a mano, aca sale del registro de llamadas. */
function FuentesFacturacion({ n }: { n: NonNullable<Analisis["negocio"]> }) {
  const a = n.atribucion;
  const max = Math.max(...a.por_fuente.map((f) => f.ingresos_usd), 1);
  return (
    <div className="dash-fuentes">
      {a.por_fuente.map((f) => (
        <div className="dash-fuente" key={f.fuente}>
          <div className="meta-mini-fila">
            <span>{f.fuente === "Sin anotar" ? "Sin anotar" : f.fuente}</span>
            <strong className="num">{usd(f.ingresos_usd)} <small>· {num(f.ventas)} {f.ventas === 1 ? "venta" : "ventas"}{f.sin_monto ? ` · ${f.sin_monto} sin monto` : ""}</small></strong>
          </div>
          <div className="neg-meta-barra"><span style={{ width: `${(f.ingresos_usd / max) * 100}%` }} /></div>
        </div>
      ))}
      <small className="dash-sub">
        {a.cobertura.con_pieza
          ? `${num(a.cobertura.con_pieza)} de ${num(a.cobertura.ventas)} ventas tienen identificada la pieza que las trajo.`
          : "Ninguna venta tiene todavía el link de la pieza que la trajo: se anota en el registro de llamadas."}
      </small>
    </div>
  );
}

function TarjetaPieza({ p, rango }: { p: FilaCalendario; rango: number }) {
  const cuerpo = (
    <>
      <div className="top-media">
        {p.thumb ? <img src={p.thumb} alt="" loading="lazy" /> : <span className="cal-sin-img" />}
        <span className="top-rango">{rango}</span>
        <span className="top-formato">{NOMBRE_FORMATO[p.formato ?? ""] ?? p.formato ?? ""}</span>
      </div>
      <div className="top-cuerpo">
        <p>{p.primera_linea || "Sin texto"}</p>
        <div className="top-mets">
          <span title="Guardados"><Icono nombre="guardado" size={12} /> {compacto(p.guardados ?? null)}</span>
          <span title="Alcance"><Icono nombre="alcance" size={12} /> {compacto(p.alcance ?? null)}</span>
          <span title="Me gusta"><Icono nombre="like" size={12} /> {compacto(p.likes ?? null)}</span>
          <span title="Comentarios"><Icono nombre="comentario" size={12} /> {compacto(p.comentarios ?? null)}</span>
        </div>
        <small>{diaMes(p.fecha)}</small>
      </div>
    </>
  );
  return p.permalink ? (
    <a className="top-pieza" href={p.permalink} target="_blank" rel="noreferrer">{cuerpo}</a>
  ) : (
    <div className="top-pieza">{cuerpo}</div>
  );
}

type Serie = "alcance" | "vistas" | "guardados" | "likes" | "comentarios";
const SERIES: Serie[] = ["alcance", "vistas", "guardados", "likes", "comentarios"];

/** Metricas sumadas por dia (7 dias) o por semana (30/90). */
function agrupar(piezas: FilaCalendario[], dias: number, ahora: number) {
  const porDia = dias <= 14;
  const cubetas: ({ clave: string; piezas: number } & Record<Serie, number | null>)[] = [];
  const vacia = (clave: string) => ({ clave, piezas: 0, alcance: null, vistas: null, guardados: null, likes: null, comentarios: null });
  if (porDia) {
    for (let k = dias - 1; k >= 0; k--) cubetas.push(vacia(isoDia(ahora - k * DIA)));
  } else {
    const hoy = new Date(isoDia(ahora) + "T00:00:00Z");
    const lunes = hoy.getTime() - ((hoy.getUTCDay() + 6) % 7) * DIA;
    for (let k = Math.ceil(dias / 7) - 1; k >= 0; k--) cubetas.push(vacia(isoDia(lunes - k * 7 * DIA)));
  }
  for (const p of piezas) {
    const c = porDia
      ? cubetas.find((x) => x.clave === p.fecha)
      : [...cubetas].reverse().find((x) => x.clave <= p.fecha);
    if (!c) continue;
    c.piezas += 1;
    for (const s of SERIES) {
      const v = p[s];
      if (typeof v === "number") c[s] = (c[s] ?? 0) + v;
    }
  }
  // Un periodo sin publicaciones suma 0 de piezas nuevas, no "sin dato".
  const serie = (s: Serie) => cubetas.map((c) => c[s] ?? (c.piezas ? null : 0));
  return {
    etiquetas: cubetas.map((c) => diaMes(c.clave)),
    alcance: serie("alcance"),
    vistas: serie("vistas"),
    guardados: serie("guardados"),
    likes: serie("likes"),
    comentarios: serie("comentarios"),
    piezas: cubetas.map((c) => c.piezas),
  };
}
