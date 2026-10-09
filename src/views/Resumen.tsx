import { useMemo, useState } from "react";
import { Delta, NOMBRE_FORMATO, num, compacto } from "../components/ui";
import { GraficoBarras } from "../components/GraficoBarras";
import { Icono } from "../components/icons";
import type { Analisis, FilaCalendario } from "../tipos";

const DIA = 86_400_000;
const MES_CORTO = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
const diaMes = (iso: string) => `${Number(iso.slice(8, 10))} ${MES_CORTO[Number(iso.slice(5, 7)) - 1]}`;
const isoDia = (t: number) => new Date(t).toISOString().slice(0, 10);
const COLOR_ALCANCE = "#c67c0e";

const sumar = (xs: (number | null | undefined)[]) => {
  const v = xs.filter((x): x is number => typeof x === "number");
  return v.length ? v.reduce((a, b) => a + b, 0) : null;
};

export function Resumen({ d, equipo = true }: { d: Analisis; equipo?: boolean }) {
  const [dias, setDias] = useState(30);
  const ahora = Date.now();
  const filas = d.calendario ?? [];

  const { actual, previo } = useMemo(() => {
    const desde = isoDia(ahora - dias * DIA);
    const desdePrevio = isoDia(ahora - 2 * dias * DIA);
    return {
      actual: filas.filter((p) => p.fecha >= desde),
      previo: filas.filter((p) => p.fecha >= desdePrevio && p.fecha < desde),
    };
  }, [filas, dias, ahora]);

  const historial = d.cuenta.seguidores_historial ?? [];
  const desdeSeg = isoDia(ahora - dias * DIA);
  const baseSeg = historial.find((h) => h.fecha >= desdeSeg) ?? historial[0];
  const ganados = baseSeg && d.cuenta.followers_count !== null ? d.cuenta.followers_count - baseSeg.seguidores : null;

  const mejores = [...actual]
    .filter((p) => p.thumb !== undefined && (p.guardados ?? null) !== null)
    .sort((a, b) => (b.guardados ?? 0) - (a.guardados ?? 0))
    .slice(0, 6);

  const grafico = useMemo(() => agrupar(actual, dias, ahora), [actual, dias, ahora]);
  const propuesta = d.mesa.propuestas[0];
  const historias = (d.historias?.filas ?? []).filter((h) => (h.hora ?? "") >= desdeSeg).length;

  return (
    <div className="lista" style={{ gap: "var(--e5)" }}>
      <div className="neg-cabecera">
        <div className="chips" role="group" aria-label="Periodo">
          {[7, 30, 90].map((n) => (
            <button key={n} className="chip" aria-pressed={dias === n} onClick={() => setDias(n)}>
              Últimos {n} días
            </button>
          ))}
        </div>
      </div>

      <div className="kpis">
        <div className="card kpi">
          <div className="kpi-lbl"><Icono nombre="perfil" size={13} /> Seguidores</div>
          <div className="kpi-val num">{num(d.cuenta.followers_count)}</div>
          <div className="kpi-pie">
            {ganados !== null && baseSeg ? (
              <span className="delta" data-tono={ganados > 0 ? "sube" : ganados < 0 ? "baja" : "igual"}>
                {ganados >= 0 ? "+" : ""}{num(ganados)} <span>desde el {diaMes(baseSeg.fecha)}</span>
              </span>
            ) : `@${d.cuenta.username ?? ""}`}
          </div>
        </div>
        <div className="card kpi">
          <div className="kpi-lbl"><Icono nombre="alcance" size={13} /> Alcance</div>
          <div className="kpi-val num">{compacto(sumar(actual.map((p) => p.alcance)))}</div>
          <div className="kpi-pie"><Delta actual={sumar(actual.map((p) => p.alcance))} previo={sumar(previo.map((p) => p.alcance))} /></div>
        </div>
        <div className="card kpi">
          <div className="kpi-lbl"><Icono nombre="piezas" size={13} /> Publicaciones</div>
          <div className="kpi-val num">{num(actual.length)}</div>
          <div className="kpi-pie">{historias ? `+ ${num(historias)} historias · ` : ""}<Delta actual={actual.length} previo={previo.length} /></div>
        </div>
        <div className="card kpi">
          <div className="kpi-lbl"><Icono nombre="guardado" size={13} /> Guardados</div>
          <div className="kpi-val num">{compacto(sumar(actual.map((p) => p.guardados)))}</div>
          <div className="kpi-pie"><Delta actual={sumar(actual.map((p) => p.guardados))} previo={sumar(previo.map((p) => p.guardados))} /></div>
        </div>
      </div>

      {grafico.etiquetas.length ? (
        <section>
          <h2 className="sec-titulo">Alcance {dias <= 14 ? "por día" : "por semana"}</h2>
          <div className="card" style={{ padding: "var(--e4)" }}>
            <GraficoBarras
              etiquetas={grafico.etiquetas}
              series={[{ nombre: "Alcance", color: COLOR_ALCANCE, valores: grafico.alcance }]}
              formato={(v) => compacto(v)}
              detalle={(k) => <div>Publicaciones <span>{num(grafico.piezas[k])}</span></div>}
              alto={200}
            />
          </div>
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
        {mejores.length ? (
          <div className="top-grilla">
            {mejores.map((p, k) => <TarjetaPieza key={p.id} p={p} rango={k + 1} />)}
          </div>
        ) : (
          <div className="card" style={{ padding: "var(--e5)", color: "var(--texto-2)" }}>No hay publicaciones en este periodo.</div>
        )}
      </section>
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

/** Alcance sumado por dia (7 dias) o por semana (30/90). */
function agrupar(piezas: FilaCalendario[], dias: number, ahora: number) {
  const porDia = dias <= 14;
  const cubetas: { clave: string; alcance: number | null; piezas: number }[] = [];
  if (porDia) {
    for (let k = dias - 1; k >= 0; k--) cubetas.push({ clave: isoDia(ahora - k * DIA), alcance: null, piezas: 0 });
  } else {
    const hoy = new Date(isoDia(ahora) + "T00:00:00Z");
    const lunes = hoy.getTime() - ((hoy.getUTCDay() + 6) % 7) * DIA;
    for (let k = Math.ceil(dias / 7) - 1; k >= 0; k--) cubetas.push({ clave: isoDia(lunes - k * 7 * DIA), alcance: null, piezas: 0 });
  }
  for (const p of piezas) {
    const c = porDia
      ? cubetas.find((x) => x.clave === p.fecha)
      : [...cubetas].reverse().find((x) => x.clave <= p.fecha);
    if (!c) continue;
    c.piezas += 1;
    if (typeof p.alcance === "number") c.alcance = (c.alcance ?? 0) + p.alcance;
  }
  // Una semana sin publicaciones tiene alcance 0 de piezas nuevas, no "sin dato".
  return {
    etiquetas: cubetas.map((c) => (porDia ? diaMes(c.clave) : diaMes(c.clave))),
    alcance: cubetas.map((c) => c.alcance ?? (c.piezas ? null : 0)),
    piezas: cubetas.map((c) => c.piezas),
  };
}

