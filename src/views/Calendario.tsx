import { useEffect, useMemo, useState } from "react";
import { SinDatosSeccion } from "../components/states";
import { NOMBRE_FORMATO, num, compacto, NADA } from "../components/ui";
import { Icono } from "../components/icons";
import type { Analisis, FilaCalendario } from "../tipos";

const MESES = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
  "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];
const DIAS = ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"];

type Filtro = "todo" | "REEL" | "CARRUSEL" | "IMAGEN";
const TIPOS: { valor: Filtro; texto: string }[] = [
  { valor: "todo", texto: "Todo" },
  { valor: "REEL", texto: "Reels" },
  { valor: "CARRUSEL", texto: "Carruseles" },
  { valor: "IMAGEN", texto: "Fotos" },
];

const claveMes = (a: number, m: number) => `${a}-${String(m + 1).padStart(2, "0")}`;
/** Fecha local de Chile de una hora ISO: una historia de las 23:00 es de ese dia, no del siguiente en UTC. */
const fechaChile = (iso: string) => new Date(iso).toLocaleDateString("en-CA", { timeZone: "America/Santiago" });

export function Calendario({ d }: { d: Analisis }) {
  const filas = d.calendario ?? [];
  const [filtro, setFiltro] = useState<Filtro>("todo");
  const [abierta, setAbierta] = useState<FilaCalendario | null>(null);

  const inicial = useMemo(() => {
    const f = filas[0]?.fecha;
    const base = f ? new Date(`${f}T12:00:00`) : new Date();
    return { anio: base.getFullYear(), mes: base.getMonth() };
  }, [filas]);
  const [cursor, setCursor] = useState(inicial);

  const historiasPorDia = useMemo(() => {
    const m = new Map<string, number>();
    for (const h of d.historias?.filas ?? []) {
      if (!h.hora) continue;
      const f = fechaChile(h.hora);
      m.set(f, (m.get(f) ?? 0) + 1);
    }
    return m;
  }, [d.historias]);

  const porDia = useMemo(() => {
    const m = new Map<string, FilaCalendario[]>();
    for (const f of filas) {
      if (filtro !== "todo" && f.formato !== filtro) continue;
      if (!m.has(f.fecha)) m.set(f.fecha, []);
      m.get(f.fecha)!.push(f);
    }
    return m;
  }, [filas, filtro]);

  useEffect(() => {
    if (!abierta) return;
    const cerrar = (e: KeyboardEvent) => e.key === "Escape" && setAbierta(null);
    window.addEventListener("keydown", cerrar);
    return () => window.removeEventListener("keydown", cerrar);
  }, [abierta]);

  if (!filas.length) {
    return <SinDatosSeccion titulo="Todavía no hay publicaciones" porque="Aparecerán aquí apenas se sincronice Instagram." />;
  }

  const pref = claveMes(cursor.anio, cursor.mes);
  const primero = new Date(cursor.anio, cursor.mes, 1);
  const diasEnMes = new Date(cursor.anio, cursor.mes + 1, 0).getDate();
  const offset = (primero.getDay() + 6) % 7;
  const celdas: (number | null)[] = [...Array(offset).fill(null), ...Array.from({ length: diasEnMes }, (_, i) => i + 1)];
  while (celdas.length % 7) celdas.push(null);

  const delMes = filas.filter((f) => f.fecha.startsWith(pref));
  const visibles = delMes.filter((f) => filtro === "todo" || f.formato === filtro);
  const historiasMes = [...historiasPorDia].filter(([f]) => f.startsWith(pref)).reduce((s, [, n]) => s + n, 0);
  const alcanceMes = visibles.reduce((s, p) => s + (p.alcance ?? 0), 0);
  const diasActivos = new Set([...visibles.map((f) => f.fecha), ...[...historiasPorDia.keys()].filter((f) => f.startsWith(pref))]).size;
  const hoy = new Date().toLocaleDateString("en-CA", { timeZone: "America/Santiago" });

  const mover = (paso: number) => {
    const nm = cursor.mes + paso;
    setCursor({ anio: cursor.anio + Math.floor(nm / 12), mes: ((nm % 12) + 12) % 12 });
  };

  return (
    <div className="lista" style={{ gap: "var(--e4)" }}>
      <div className="card cal-barra">
        <div className="cal-nav">
          <button className="btn" onClick={() => mover(-1)} aria-label="Mes anterior"><Icono nombre="arriba" size={14} /></button>
          <h2 className="cal-mes">{MESES[cursor.mes]} {cursor.anio}</h2>
          <button className="btn" onClick={() => mover(1)} aria-label="Mes siguiente"><Icono nombre="arriba" size={14} /></button>
        </div>
        <div className="chips">
          {TIPOS.map((t) => (
            <button key={t.valor} className="chip" aria-pressed={filtro === t.valor} onClick={() => setFiltro(t.valor)}>
              {t.texto}
              <span className="chip-n">{t.valor === "todo" ? delMes.length : delMes.filter((f) => f.formato === t.valor).length}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="cal-resumen">
        <div className="card"><span className="kpi-lbl">Publicaciones</span><strong>{num(visibles.length)}</strong></div>
        <div className="card"><span className="kpi-lbl">Historias</span><strong>{num(historiasMes)}</strong></div>
        <div className="card"><span className="kpi-lbl">Alcance</span><strong>{compacto(alcanceMes)}</strong></div>
        <div className="card"><span className="kpi-lbl">Días con contenido</span><strong>{num(diasActivos)} <small>de {diasEnMes}</small></strong></div>
      </div>

      <div className="card cal-caja">
        <div className="cal-grilla cal-cabecera">
          {DIAS.map((x) => <div key={x} className="cal-dia-nombre">{x}</div>)}
        </div>
        <div className="cal-grilla">
          {celdas.map((dia, i) => {
            if (dia === null) return <div key={i} className="cal-celda" data-vacia="true" />;
            const fecha = `${pref}-${String(dia).padStart(2, "0")}`;
            const piezas = porDia.get(fecha) ?? [];
            const hist = historiasPorDia.get(fecha) ?? 0;
            return (
              <div key={i} className="cal-celda" data-hoy={fecha === hoy || undefined}>
                <div className="cal-celda-top">
                  <span className="cal-num">{dia}</span>
                  {hist ? <span className="cal-historias" title={`${hist} ${hist === 1 ? "historia" : "historias"}`}>{hist}</span> : null}
                </div>
                {piezas.length ? (
                  <div className="cal-piezas" data-n={Math.min(piezas.length, 2)}>
                    {piezas.slice(0, 2).map((p, k) => (
                      <button key={p.id} className="cal-pieza" onClick={() => setAbierta(p)} aria-label={`Ver publicación del ${dia}`}>
                        {p.thumb ? <img src={p.thumb} alt="" loading="lazy" /> : <span className="cal-sin-img" />}
                        {p.formato === "REEL" ? <span className="cal-icono-reel"><Icono nombre="vista" size={11} /></span> : null}
                        {k === 1 && piezas.length > 2 ? <span className="cal-mas">+{piezas.length - 2}</span> : null}
                        <span className="cal-alcance">{compacto(p.alcance ?? null)}</span>
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      </div>

      <div className="cal-leyenda">
        <span><span className="cal-historias">3</span> historias ese día</span>
        <span><Icono nombre="alcance" size={12} /> el número sobre cada publicación es su alcance</span>
      </div>

      {abierta ? <Detalle p={abierta} cerrar={() => setAbierta(null)} /> : null}
    </div>
  );
}

function Detalle({ p, cerrar }: { p: FilaCalendario; cerrar: () => void }) {
  const fecha = new Date(`${p.fecha}T12:00:00`).toLocaleDateString("es-CL", { weekday: "long", day: "numeric", month: "long" });
  const mets: [string, number | null | undefined][] = [
    ["Alcance", p.alcance],
    ["Reproducciones", p.vistas],
    ["Guardados", p.guardados],
    ["Me gusta", p.likes],
    ["Comentarios", p.comentarios],
    ["Compartidos", p.compartidos],
  ];
  return (
    <div className="cal-modal-fondo" onClick={cerrar}>
      <div className="card cal-modal" role="dialog" aria-modal="true" aria-label="Detalle de la publicación" onClick={(e) => e.stopPropagation()}>
        <button className="btn cal-modal-cerrar" onClick={cerrar} aria-label="Cerrar">✕</button>
        <div className="cal-modal-media">{p.thumb ? <img src={p.thumb} alt="" /> : <span className="cal-sin-img" />}</div>
        <div className="cal-modal-cuerpo">
          <span className="kpi-lbl">{NOMBRE_FORMATO[p.formato ?? ""] ?? p.formato} · <span style={{ textTransform: "capitalize" }}>{fecha}</span></span>
          <p>{p.primera_linea || "Sin texto"}</p>
          <div className="cal-modal-mets">
            {mets.filter(([, v]) => v !== undefined).map(([t, v]) => (
              <div key={t}><strong>{v === null ? NADA : compacto(v ?? null)}</strong><span>{t}</span></div>
            ))}
          </div>
          {p.permalink ? <a className="btn" href={p.permalink} target="_blank" rel="noreferrer">Ver en Instagram</a> : null}
        </div>
      </div>
    </div>
  );
}
