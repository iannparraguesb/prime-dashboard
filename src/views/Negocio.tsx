import { useState } from "react";
import { SinDatosSeccion } from "../components/states";
import { Badge, Delta, num, pct, NADA, haceCuanto } from "../components/ui";
import { GraficoBarras } from "../components/GraficoBarras";
import { Icono } from "../components/icons";
import type { Analisis, Negocio as DatosNegocio, PeriodoNegocio, Numerico } from "../tipos";

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

export function Negocio({ d }: { d: Analisis }) {
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

function Pendientes({ n }: { n: DatosNegocio }) {
  const conflictos = n.conciliacion.filter((c) => !c.ok).length;
  const total = n.origen_agendas.reduce((s, o) => s + o.n, 0);
  const sinOrigen = n.origen_agendas.find((o) => o.nombre === "Sin UTM")?.n ?? 0;
  const sinFuente = n.llamadas.filter((l) => !l.fuente).length;
  const items = [
    conflictos ? { t: `${conflictos} ventas no coinciden entre GHL y el registro de llamadas`, a: "#conciliacion" } : null,
    sinFuente ? { t: `${sinFuente} llamadas sin "de dónde vino" anotado`, a: "#llamadas" } : null,
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
