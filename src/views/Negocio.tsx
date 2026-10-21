import { useState } from "react";
import { SinDatosSeccion } from "../components/states";
import { Badge, Base, Delta, NOMBRE_FORMATO, num, pct, NADA, haceCuanto } from "../components/ui";
import { GraficoBarras } from "../components/GraficoBarras";
import { Icono } from "../components/icons";
import { METRICAS_META, ritmoMeta, enviarMeta, type Meta, type MetricaMeta } from "../lib/metas";
import type { Analisis, AtribucionVentas, Negocio as DatosNegocio, PeriodoNegocio, Numerico } from "../tipos";

const ES = "es-CL";
const usd = (v: Numerico | undefined) =>
  v === null || v === undefined ? NADA : `US$${Math.round(v).toLocaleString(ES)}`;
const usdCorto = (v: number) => (v >= 1000 ? `$${(v / 1000).toLocaleString(ES, { maximumFractionDigits: 1 })}K` : `$${Math.round(v)}`);
const clp = (v: Numerico | undefined) =>
  v === null || v === undefined ? NADA : `$${Math.round(v).toLocaleString(ES)} CLP`;

const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
const MES_CORTO = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
const nombreMes = (iso: string) => MESES[Number(iso.slice(5, 7)) - 1];
const diaMes = (iso: string) => `${Number(iso.slice(8, 10))} ${MES_CORTO[Number(iso.slice(5, 7)) - 1]}`;

// Validados con el script de dataviz contra la superficie oscura (#100c07).
const COLOR_GASTO = "#5a8fd6";
const COLOR_VENTA = "#c67c0e";

export function Negocio({ d, jwt, recargar }: { d: Analisis; jwt: string | null; recargar: () => void }) {
  const n = d.negocio;
  const [mesSel, setMesSel] = useState<string | null>(null);

  if (!n || !n.meses.length) {
    return <SinDatosSeccion titulo="Todavía no hay datos del negocio" porque="Aparecerán apenas se carguen las ventas, las agendas y la inversión en anuncios." />;
  }

  const i = Math.max(0, n.meses.findIndex((m) => m.inicio === mesSel));
  const idx = mesSel ? i : n.meses.length - 1;
  const mes = n.meses[idx];
  const previo = idx > 0 ? n.meses[idx - 1] : null;

  return (
    <div className="lista" style={{ gap: "var(--e5)" }}>
      <div className="neg-cabecera">
        <div className="chips" role="group" aria-label="Mes">
          {n.meses.map((m) => (
            <button key={m.inicio} className="chip" aria-pressed={m.inicio === mes.inicio} onClick={() => setMesSel(m.inicio)}>
              <span style={{ textTransform: "capitalize" }}>{nombreMes(m.inicio)}</span>
            </button>
          ))}
        </div>
        <span className="frescura-pill" data-tono={frescura(n.cobertura.ghl?.cargado_en)}>
          Ventas actualizadas {haceCuanto(n.cobertura.ghl?.cargado_en ?? n.cobertura.meta?.cargado_en)}
        </span>
      </div>

      <Kpis m={mes} previo={previo} />
      <Metas n={n} m={mes} jwt={jwt} recargar={recargar} />
      <Pendientes n={n} />

      <section>
        <h2 className="sec-titulo">Inversión vs. ventas, semana a semana</h2>
        <div className="card" style={{ padding: "var(--e4)" }}>
          <GraficoBarras
            etiquetas={n.semanas.map((s) => diaMes(s.inicio))}
            series={[
              { nombre: "Invertido en anuncios", color: COLOR_GASTO, valores: n.semanas.map((s) => s.gasto_usd) },
              { nombre: "Vendido", color: COLOR_VENTA, valores: n.semanas.map((s) => s.ingresos_usd) },
            ]}
            formato={usdCorto}
            detalle={(k) => (
              <>
                <div>Agendas <span>{num(n.semanas[k].agendas)}</span></div>
                <div>Ventas <span>{n.semanas[k].ventas === null ? NADA : num(n.semanas[k].ventas)}</span></div>
              </>
            )}
          />
        </div>
      </section>

      {n.atribucion ? <Atribucion a={n.atribucion} /> : null}
      <Embudo m={mes} />
      <Semanas semanas={n.semanas} />
      <Conciliacion n={n} />
      <Llamadas n={n} />
      <Agendas n={n} />
    </div>
  );
}

function frescura(iso: string | undefined | null) {
  if (!iso) return "mal";
  const horas = (Date.now() - new Date(iso).getTime()) / 3_600_000;
  return horas < 30 ? "bien" : horas < 72 ? "ojo" : "mal";
}

function Kpis({ m, previo }: { m: PeriodoNegocio; previo: PeriodoNegocio | null }) {
  const ticket = m.ventas ? (m.ingresos_usd ?? 0) / m.ventas : null;
  return (
    <div className="kpis">
      <div className="card kpi">
        <div className="kpi-lbl"><Icono nombre="dinero" size={18} /> Facturación</div>
        <div className="kpi-val num">{usd(m.ingresos_usd)}</div>
        <div className="kpi-pie">{m.ingresos_usd === null ? "sin registro de ventas este mes" : `en ${nombreMes(m.inicio)}`}</div>
      </div>
      <div className="card kpi">
        <div className="kpi-lbl"><Icono nombre="perfil" size={18} /> Clientes nuevos</div>
        <div className="kpi-val num">{num(m.ventas)}</div>
        <div className="kpi-pie">{ticket ? `${usd(ticket)} promedio por cliente` : NADA}</div>
      </div>
      <div className="card kpi">
        <div className="kpi-lbl"><Icono nombre="megafono" size={18} /> Invertido en anuncios</div>
        <div className="kpi-val num">{usd(m.gasto_usd)}</div>
        <div className="kpi-pie">{clp(m.gasto_clp)} {/* Un mes en curso contra uno completo no es comparable. */}
          {!m.en_curso ? <Delta actual={m.gasto_usd} previo={previo?.gasto_usd} texto="vs. mes anterior" /> : null}</div>
      </div>
      <div className="card kpi">
        <div className="kpi-lbl"><Icono nombre="alcance" size={18} /> Por cada US$1</div>
        <div className="kpi-val num">{m.roas_total === null ? NADA : `US$${m.roas_total.toLocaleString(ES, { maximumFractionDigits: 1 })}`}</div>
        <div className="kpi-pie">vendidos por cada dólar en anuncios · {m.roas_anuncio === null ? NADA : `US$${m.roas_anuncio.toLocaleString(ES, { maximumFractionDigits: 1 })}`} contando solo clientes de anuncios</div>
      </div>
      <div className="card kpi">
        <div className="kpi-lbl"><Icono nombre="calendario" size={18} /> Costo por agenda</div>
        <div className="kpi-val num">{usd(m.costo_agenda_usd)}</div>
        <div className="kpi-pie">{num(m.agendas)} llamadas agendadas</div>
      </div>
    </div>
  );
}

const METRICAS = Object.keys(METRICAS_META) as MetricaMeta[];
const decimal = (v: number) => v.toLocaleString(ES, { maximumFractionDigits: 1 });
const valorMeta = (k: MetricaMeta, v: number) => (METRICAS_META[k].usd ? usd(v) : decimal(v));

function Metas({ n, m, jwt, recargar }: { n: DatosNegocio; m: PeriodoNegocio; jwt: string | null; recargar: () => void }) {
  const [editando, setEditando] = useState(false);
  if (n.metas === null) {
    return <Base>Las metas mensuales necesitan la migración 0015_metas_mensuales.sql aplicada en Supabase.</Base>;
  }
  const delMes = n.metas.filter((x) => x.mes === m.inicio).sort((a, b) => METRICAS.indexOf(a.metrica) - METRICAS.indexOf(b.metrica));
  const { dia, dias, cerrado } = ritmoMeta(0, 1, m.inicio, n.hoy);
  const editor = editando ? (
    <EditorMetas mes={m.inicio} metas={delMes} jwt={jwt} alGuardar={() => { setEditando(false); recargar(); }} alCancelar={() => setEditando(false)} />
  ) : null;

  if (!delMes.length) {
    return (
      <section id="metas">
        {editor ?? (
          <div className="card metas-vacio">
            <span>Sin metas para {nombreMes(m.inicio)}.</span>
            <button className="btn" onClick={() => setEditando(true)}>Definir metas</button>
          </div>
        )}
      </section>
    );
  }

  return (
    <section id="metas">
      <div className="metas-cabecera">
        <h2 className="sec-titulo">Metas de {nombreMes(m.inicio)}</h2>
        <span className="metas-dia">{cerrado ? "Mes cerrado" : `Día ${dia} de ${dias} · ${pct((dia / dias) * 100, 0)} del mes`}</span>
        {!editando ? <button className="btn" onClick={() => setEditando(true)}>Editar metas</button> : null}
      </div>
      {editor}
      <div className="metas-grilla">
        {delMes.map((meta) => <MetaItem key={meta.metrica} meta={meta} actual={m[meta.metrica]} hoy={n.hoy} />)}
      </div>
    </section>
  );
}

const ESTADO_META = {
  cumplida: { t: "Cumplida", tono: "bien" },
  adelante: { t: "Adelante del ritmo", tono: "bien" },
  atras: { t: "Por detrás del ritmo", tono: "mal" },
  no_cumplida: { t: "No se cumplió", tono: "mal" },
  sin_dato: { t: "Sin dato", tono: undefined },
} as const;

function MetaItem({ meta, actual, hoy }: { meta: Meta; actual: Numerico; hoy: string }) {
  const k = meta.metrica;
  const r = ritmoMeta(actual, meta.objetivo, meta.mes, hoy);
  const e = ESTADO_META[r.estado];
  let pie: string;
  if (r.estado === "sin_dato") pie = "La fuente todavía no cubre este mes.";
  else if (r.estado === "cumplida") pie = `Objetivo de ${valorMeta(k, meta.objetivo)} alcanzado.`;
  else if (r.cerrado) pie = `Faltaron ${valorMeta(k, r.faltan ?? 0)}.`;
  else pie = `Faltan ${valorMeta(k, r.faltan ?? 0)}${r.por_dia ? ` · ${valorMeta(k, r.por_dia)} por día` : ""} · a hoy tocaba ${valorMeta(k, r.esperado)}`;
  return (
    <div className="card meta-item">
      <div className="meta-top">
        <span className="kpi-lbl">{METRICAS_META[k].nombre}</span>
        <Badge tono={e.tono}>{e.t}</Badge>
      </div>
      <div className="meta-valor num">
        {actual === null ? NADA : valorMeta(k, actual)} <small>/ {valorMeta(k, meta.objetivo)}</small>
      </div>
      <div className="neg-meta-barra meta-barra" role="img" aria-label={`${pct(r.logrado, 0)} de la meta`}>
        {r.logrado !== null ? <span style={{ width: `${Math.min(r.logrado, 100)}%` }} /> : null}
        {!r.cerrado && r.estado !== "cumplida" ? <i className="meta-ritmo" style={{ left: `${Math.min((r.esperado / meta.objetivo) * 100, 100)}%` }} title="Donde deberías ir a hoy" /> : null}
      </div>
      <div className="kpi-pie">{pie}</div>
    </div>
  );
}

function EditorMetas({ mes, metas, jwt, alGuardar, alCancelar }: {
  mes: string; metas: Meta[]; jwt: string | null; alGuardar: () => void; alCancelar: () => void;
}) {
  const [valores, setValores] = useState<Record<MetricaMeta, string>>(
    () => Object.fromEntries(METRICAS.map((k) => [k, String(metas.find((x) => x.metrica === k)?.objetivo ?? "")])) as Record<MetricaMeta, string>,
  );
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const guardar = async () => {
    setOcupado(true);
    setError(null);
    try {
      for (const k of METRICAS) {
        const texto = valores[k].trim();
        const previa = metas.find((x) => x.metrica === k);
        // Vaciar el campo quita la meta: una meta en cero no existe.
        if (!texto) {
          if (previa) await enviarMeta(jwt, "DELETE", { mes, metrica: k });
          continue;
        }
        const v = Number(texto);
        if (!Number.isFinite(v) || v <= 0) throw new Error(`${METRICAS_META[k].nombre}: el objetivo tiene que ser mayor que cero.`);
        if (previa?.objetivo !== v) await enviarMeta(jwt, "POST", { mes, metrica: k, objetivo: v });
      }
      alGuardar();
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudieron guardar las metas.");
    } finally {
      setOcupado(false);
    }
  };

  return (
    <div className="card metas-editor">
      <span className="kpi-lbl">Metas de {nombreMes(mes)} · deja vacío lo que no quieras medir</span>
      {METRICAS.map((k) => (
        <label key={k} className="metas-campo">
          <span>{METRICAS_META[k].nombre}{METRICAS_META[k].usd ? " (US$)" : ""}</span>
          <input
            className="control"
            type="number"
            inputMode="decimal"
            min={0}
            step="any"
            value={valores[k]}
            onChange={(e) => setValores((v) => ({ ...v, [k]: e.target.value }))}
            disabled={ocupado}
          />
        </label>
      ))}
      {error ? <p className="login-error" role="alert">{error}</p> : null}
      <div className="metas-acciones">
        <button className="btn btn-primario" disabled={ocupado} onClick={() => void guardar()}>{ocupado ? "Guardando…" : "Guardar metas"}</button>
        <button className="btn" disabled={ocupado} onClick={alCancelar}>Cancelar</button>
      </div>
    </div>
  );
}

function Pendientes({ n }: { n: DatosNegocio }) {
  const conflictos = n.conciliacion.filter((c) => !c.ok).length;
  const total = n.origen_agendas.reduce((s, o) => s + o.n, 0);
  const sinOrigen = n.origen_agendas.find((o) => o.nombre === "Sin UTM")?.n ?? 0;
  const sinFuente = n.llamadas.filter((l) => !l.fuente).length;
  const sinPieza = n.atribucion ? n.atribucion.cobertura.ventas - n.atribucion.cobertura.con_pieza : 0;
  const items = [
    conflictos ? { t: `${conflictos} ventas no coinciden entre GHL y el registro de llamadas`, a: "#conciliacion" } : null,
    sinFuente ? { t: `${sinFuente} llamadas sin "de dónde vino" anotado`, a: "#llamadas" } : null,
    sinPieza ? { t: `${sinPieza} ventas sin el link de la publicación o historia que las trajo`, a: "#atribucion" } : null,
    total && sinOrigen / total > 0.3 ? { t: `${sinOrigen} de ${total} agendas llegaron sin saber de qué anuncio o publicación`, a: "#agendas" } : null,
  ].filter(Boolean) as { t: string; a: string }[];
  if (!items.length) return null;
  return (
    <div className="card neg-pendientes">
      <span className="kpi-lbl">Para que los números sean exactos</span>
      <ul>
        {items.map((x) => (
          <li key={x.t}><a href={x.a} onClick={(e) => { e.preventDefault(); document.querySelector(x.a)?.scrollIntoView({ behavior: "smooth" }); }}>{x.t}</a></li>
        ))}
      </ul>
    </div>
  );
}

/** Monto con los que faltan anotados al lado: un monto vacio no suma cero. */
function facturado(ingresos: number, sinMonto: number) {
  return `${usd(ingresos)}${sinMonto ? ` + ${sinMonto} sin monto` : ""}`;
}

function Atribucion({ a }: { a: AtribucionVentas }) {
  const c = a.cobertura;
  if (!c.ventas) return null;
  const faltan = [
    c.sin_detalle ? `${c.sin_detalle} sin nada anotado en "Detalle de la fuente"` : null,
    c.sin_link ? `${c.sin_link} con texto pero sin link de Instagram` : null,
    c.link_sin_pieza ? `${c.link_sin_pieza} con un link que no es de una publicación o historia capturada de la cuenta` : null,
  ].filter(Boolean);
  return (
    <section id="atribucion">
      <h2 className="sec-titulo">Qué contenido vendió</h2>
      {a.por_pieza.length ? (
        <div className="top-grilla">
          {a.por_pieza.map((x, k) => <TarjetaVenta key={x.pieza.id} x={x} rango={k + 1} />)}
        </div>
      ) : (
        <div className="card" style={{ padding: "var(--e5)", color: "var(--texto-2)" }}>
          Ninguna venta tiene todavía la publicación o historia que la trajo. Para verlas acá, el registro de llamadas
          necesita el link de Instagram del reel o la historia en la columna "Detalle de la fuente".
        </div>
      )}

      <div className="tabla-caja" style={{ marginTop: "var(--e3)" }}>
        <table>
          <thead>
            <tr>
              <th>Fuente de la venta</th>
              <th className="n">Ventas</th>
              <th className="n">Facturado</th>
            </tr>
          </thead>
          <tbody>
            {a.por_fuente.map((f) => (
              <tr key={f.fuente}>
                <td>{f.fuente === "Sin anotar" ? <span style={{ color: "var(--texto-3)" }}>sin anotar</span> : f.fuente}</td>
                <td className="n">{num(f.ventas)}</td>
                <td className="n">{facturado(f.ingresos_usd, f.sin_monto)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Base>
        {num(c.con_pieza)} de {num(c.ventas)} ventas tienen identificada la pieza que las trajo.
        {faltan.length ? ` Del resto: ${faltan.join("; ")}.` : ""} La pieza se reconoce por el link de Instagram que
        anota el setter; no se adivina por el texto.
      </Base>
    </section>
  );
}

function TarjetaVenta({ x, rango }: { x: AtribucionVentas["por_pieza"][number]; rango: number }) {
  const p = x.pieza;
  const historia = p.tipo === "historia";
  return (
    <a className="top-pieza" href={p.permalink} target="_blank" rel="noreferrer">
      <div className="top-media">
        {p.thumb ? <img src={p.thumb} alt="" loading="lazy" /> : <span className="cal-sin-img" />}
        <span className="top-rango">{rango}</span>
        <span className="top-formato">{historia ? "Historia" : NOMBRE_FORMATO[p.formato ?? ""] ?? p.formato ?? ""}</span>
      </div>
      <div className="top-cuerpo">
        <p>{historia ? `Historia del ${p.fecha ? diaMes(p.fecha.slice(0, 10)) : "día sin fecha"}` : p.titulo || "Sin texto"}</p>
        <div className="top-mets">
          <span title="Facturado"><Icono nombre="dinero" size={12} /> {facturado(x.ingresos_usd, x.sin_monto)}</span>
          <span title="Ventas"><Icono nombre="perfil" size={12} /> {x.ventas === 1 ? "1 venta" : `${num(x.ventas)} ventas`}</span>
        </div>
        {!historia && p.fecha ? <small>{diaMes(p.fecha.slice(0, 10))}</small> : null}
      </div>
    </a>
  );
}

function Embudo({ m }: { m: PeriodoNegocio }) {
  const pasos = [
    { nombre: "Agendaron llamada", v: m.agendas },
    { nombre: "Llamadas hechas", v: m.llamadas },
    { nombre: "Se presentaron", v: m.asistieron },
    { nombre: "Compraron", v: m.ventas },
  ];
  const max = Math.max(...pasos.map((p) => p.v ?? 0), 1);
  return (
    <section>
      <h2 className="sec-titulo">De la agenda a la venta · {nombreMes(m.inicio)}</h2>
      <div className="card neg-embudo">
        {pasos.map((p, k) => {
          const prev = k > 0 ? pasos[k - 1].v : null;
          // Solo entre pasos del mismo registro: agendas (GHL) y llamadas (setter)
          // se cuentan distinto y su cociente no es una tasa real.
          const tasa = k >= 2 && p.v !== null && prev ? (p.v / prev) * 100 : null;
          return (
            <div className="neg-paso" key={p.nombre}>
              <div className="neg-paso-nombre">{p.nombre}</div>
              <div className="neg-paso-barra">{p.v ? <span style={{ width: `${(p.v / max) * 100}%` }} /> : null}</div>
              <div className="neg-paso-valor">
                {p.v === null ? NADA : num(p.v)}
                {tasa !== null ? <small>{pct(tasa, 0)}</small> : null}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function Semanas({ semanas }: { semanas: PeriodoNegocio[] }) {
  const filas = [...semanas].reverse();
  const dash = <span style={{ color: "var(--texto-3)" }}>{NADA}</span>;
  const v = (x: Numerico, f: (y: number) => string) => (x === null ? dash : f(x));
  return (
    <section>
      <h2 className="sec-titulo">Semana a semana</h2>
      <div className="tabla-caja">
        <table>
          <thead>
            <tr>
              <th>Semana</th>
              <th className="n">Invertido</th>
              <th className="n">Agendas</th>
              <th className="n">Costo por agenda</th>
              <th className="n">Llamadas</th>
              <th className="n">Se presentaron</th>
              <th className="n">Ventas</th>
              <th className="n">Vendido</th>
            </tr>
          </thead>
          <tbody>
            {filas.map((s) => (
              <tr key={s.inicio}>
                <td>{diaMes(s.inicio)} – {diaMes(s.fin)} {s.en_curso ? <Badge>esta semana</Badge> : null}</td>
                <td className="n" title={clp(s.gasto_clp)}>{v(s.gasto_usd, usd)}</td>
                <td className="n">{v(s.agendas, num)}</td>
                <td className="n">{v(s.costo_agenda_usd, usd)}</td>
                <td className="n">{v(s.llamadas, num)}</td>
                <td className="n">{v(s.asistieron, num)}</td>
                <td className="n">{v(s.ventas, num)}</td>
                <td className="n">{v(s.ingresos_usd, usd)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function Conciliacion({ n }: { n: DatosNegocio }) {
  const revisar = n.conciliacion.filter((c) => !c.ok);
  if (!n.conciliacion.length) return null;
  return (
    <section id="conciliacion">
      <h2 className="sec-titulo">Ventas por confirmar {revisar.length ? <Badge tono="mal">{revisar.length}</Badge> : null}</h2>
      <div className="tabla-caja">
        <table>
          <thead>
            <tr>
              <th>Cliente</th>
              <th>En GHL</th>
              <th>En el registro de llamadas</th>
              <th>Qué falta</th>
            </tr>
          </thead>
          <tbody>
            {n.conciliacion.map((c) => (
              <tr key={c.prospecto}>
                <td>{c.prospecto}</td>
                <td>{c.ghl_etapa ? `Cerrada${c.ghl_valor ? (c.ghl_moneda === "CLP" ? ` · CLP ${c.ghl_valor.toLocaleString(ES)} (≈ ${usd(c.ghl_valor_usd)})` : ` · ${usd(c.ghl_valor)}`) : ""}` : NADA}</td>
                <td>{c.setter_resultado === "Cerró" ? `Compró · ${usd(c.setter_monto_usd)}` : c.setter_asistio === "No" ? "No se presentó" : c.setter_resultado ?? "No aparece"}</td>
                <td style={{ whiteSpace: "normal" }}>{c.ok ? <Badge tono="bien">Todo OK</Badge> : textoAccion(c.estado)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function textoAccion(estado: string) {
  if (estado.startsWith("Monto distinto")) return "Corregir el monto en GHL";
  if (estado.startsWith("Solo en GHL")) return "Anotarla en el registro de llamadas";
  if (estado.startsWith("Solo en el setter")) return "Moverla a Cerrada en GHL";
  return "Confirmar con Leo si compró";
}

function Llamadas({ n }: { n: DatosNegocio }) {
  if (!n.llamadas.length) return null;
  const gris = (t: string) => <span style={{ color: "var(--texto-3)" }}>{t}</span>;
  return (
    <section id="llamadas">
      <h2 className="sec-titulo">Llamadas de venta</h2>
      <div className="tabla-caja">
        <table>
          <thead>
            <tr>
              <th>Fecha</th>
              <th>Persona</th>
              <th>De dónde vino</th>
              <th>Se presentó</th>
              <th>Resultado</th>
              <th className="n">Monto</th>
              <th>Próximo seguimiento</th>
            </tr>
          </thead>
          <tbody>
            {n.llamadas.map((l) => (
              <tr key={`${l.fecha}-${l.prospecto}`}>
                <td>{diaMes(l.fecha)}</td>
                <td>{l.prospecto}</td>
                <td>{l.fuente ?? gris("sin anotar")}</td>
                <td>{l.asistio ?? gris("por confirmar")}</td>
                <td>{l.resultado === "Cerró" ? <Badge tono="bien">Compró</Badge> : l.resultado ?? NADA}</td>
                <td className="n">{usd(l.monto_usd)}</td>
                <td>{l.seguimiento ?? NADA}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function Agendas({ n }: { n: DatosNegocio }) {
  return (
    <section id="agendas">
      <h2 className="sec-titulo">Últimas agendas</h2>
      <div className="tabla-caja">
        <table>
          <thead>
            <tr>
              <th>Fecha</th>
              <th>Persona</th>
              <th>Cómo agendó</th>
              <th>De dónde vino</th>
              <th>Estado</th>
            </tr>
          </thead>
          <tbody>
            {n.agendas_recientes.map((a, k) => (
              <tr key={`${a.creado}-${k}`}>
                <td>{diaMes(a.creado)}</td>
                <td>{a.nombre ?? NADA}</td>
                <td>{a.fuente_ghl || NADA}</td>
                <td>{a.origen === "Sin UTM" ? <span style={{ color: "var(--texto-3)" }}>sin dato</span> : a.origen}</td>
                <td>{a.etapa === "Cerrada" ? <Badge tono="bien">Compró</Badge> : a.etapa ?? NADA}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
