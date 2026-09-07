import { useMemo, useState } from "react";
import { SinDatosSeccion } from "../components/states";
import { Base, Nota, num, pct, mult, NADA } from "../components/ui";
import { Icono } from "../components/icons";
import type { Analisis, FilaCalendario } from "../tipos";

const MESES = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
  "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];
const DIAS = ["LU", "MA", "MI", "JU", "VI", "SA", "DO"];

type Filtro = "todo" | "REEL" | "CARRUSEL" | "IMAGEN";

const TIPOS: { valor: Filtro; texto: string; color: string }[] = [
  { valor: "todo", texto: "Todo", color: "var(--texto-3)" },
  { valor: "REEL", texto: "Reels", color: "var(--prime-gold-bright)" },
  { valor: "CARRUSEL", texto: "Carruseles", color: "var(--prime-amber)" },
  { valor: "IMAGEN", texto: "Imagen", color: "var(--prime-bronze)" },
];

const COLOR: Record<string, string> = {
  REEL: "var(--prime-gold-bright)",
  CARRUSEL: "var(--prime-amber)",
  IMAGEN: "var(--prime-bronze)",
};

/** Lunes = 0. `getDay()` devuelve domingo = 0, que descoloca la grilla. */
function diaSemanaLunes(d: Date) {
  return (d.getDay() + 6) % 7;
}

function claveMes(a: number, m: number) {
  return `${a}-${String(m + 1).padStart(2, "0")}`;
}

export function Calendario({ d }: { d: Analisis }) {
  const filas = d.calendario ?? [];
  const [filtro, setFiltro] = useState<Filtro>("todo");

  // Arrancar en el mes de la publicacion mas reciente, no en el mes actual:
  // si Leo lleva dos semanas sin publicar, abrir en un mes vacio no dice nada.
  const inicial = useMemo(() => {
    const f = filas[0]?.fecha;
    const base = f ? new Date(`${f}T12:00:00`) : new Date();
    return { anio: base.getFullYear(), mes: base.getMonth() };
  }, [filas]);
  const [cursor, setCursor] = useState(inicial);

  const porDia = useMemo(() => {
    const m = new Map<string, FilaCalendario[]>();
    for (const f of filas) {
      if (filtro !== "todo" && f.formato !== filtro) continue;
      if (!m.has(f.fecha)) m.set(f.fecha, []);
      m.get(f.fecha)!.push(f);
    }
    return m;
  }, [filas, filtro]);

  const cuentaPorFormato = useMemo(() => {
    const c: Record<string, number> = {};
    const pref = claveMes(cursor.anio, cursor.mes);
    for (const f of filas) {
      if (!f.fecha.startsWith(pref)) continue;
      c[f.formato ?? "?"] = (c[f.formato ?? "?"] ?? 0) + 1;
    }
    return c;
  }, [filas, cursor]);

  if (!filas.length) {
    return (
      <SinDatosSeccion
        titulo="Sin publicaciones cargadas"
        porque="La API no devolvio el campo `calendario`. Si el backend es anterior a esta seccion, reinicia el servidor."
      />
    );
  }

  const primero = new Date(cursor.anio, cursor.mes, 1);
  const diasEnMes = new Date(cursor.anio, cursor.mes + 1, 0).getDate();
  const offset = diaSemanaLunes(primero);
  const celdas: (number | null)[] = [
    ...Array.from({ length: offset }, () => null),
    ...Array.from({ length: diasEnMes }, (_, i) => i + 1),
  ];
  while (celdas.length % 7 !== 0) celdas.push(null);

  const pref = claveMes(cursor.anio, cursor.mes);
  const delMes = filas.filter((f) => f.fecha.startsWith(pref));
  const visiblesMes = delMes.filter((f) => filtro === "todo" || f.formato === filtro);
  const hoy = new Date().toISOString().slice(0, 10);

  const mover = (paso: number) => {
    const nm = cursor.mes + paso;
    setCursor({
      anio: cursor.anio + Math.floor(nm / 12),
      mes: ((nm % 12) + 12) % 12,
    });
  };

  return (
    <div className="lista" style={{ gap: "var(--e4)" }}>
      <div className="card cal-barra">
        <div className="chips">
          {TIPOS.map((t) => {
            const n = t.valor === "todo" ? delMes.length : (cuentaPorFormato[t.valor] ?? 0);
            return (
              <button
                key={t.valor}
                className="chip"
                aria-pressed={filtro === t.valor}
                onClick={() => setFiltro(t.valor)}
              >
                {t.texto}
                <span className="chip-n">{n}</span>
              </button>
            );
          })}
        </div>
        <div className="cal-nav">
          <button className="btn" onClick={() => mover(-1)} aria-label="Mes anterior">
            <Icono nombre="arriba" size={14} />
          </button>
          <h2 className="cal-mes">
            {MESES[cursor.mes]} {cursor.anio}
          </h2>
          <button className="btn" onClick={() => mover(1)} aria-label="Mes siguiente">
            <Icono nombre="arriba" size={14} />
          </button>
        </div>
      </div>

      <div className="card cal-caja">
        <div className="cal-grilla cal-cabecera">
          {DIAS.map((x) => (
            <div key={x} className="cal-dia-nombre">{x}</div>
          ))}
        </div>
        <div className="cal-grilla">
          {celdas.map((dia, i) => {
            if (dia === null) return <div key={i} className="cal-celda" data-vacia="true" />;
            const fecha = `${pref}-${String(dia).padStart(2, "0")}`;
            const piezas = porDia.get(fecha) ?? [];
            return (
              <div key={i} className="cal-celda" data-hoy={fecha === hoy || undefined}>
                <span className="cal-num">{dia}</span>
                {piezas.length ? (
                  <div className="cal-piezas">
                    {piezas.slice(0, 4).map((p) => (
                      <a
                        key={p.id}
                        className="cal-pieza"
                        href={p.permalink ?? undefined}
                        target="_blank"
                        rel="noreferrer"
                        style={{ borderColor: COLOR[p.formato ?? ""] ?? "var(--linea-fuerte)" }}
                        title={
                          `${p.primera_linea || "(sin texto)"}\n` +
                          `${p.formato ?? NADA} · guardado ${pct(p.guardado_pct, 2)} · ${mult(p.multiplicador)}` +
                          (p.apto_ranking ? "" : "\nBajo el piso de alcance: no entra a rankings")
                        }
                      >
                        {p.thumb ? (
                          <img src={p.thumb} alt="" loading="lazy" />
                        ) : (
                          <span className="cal-sin-img" />
                        )}
                        {!p.apto_ranking ? <span className="cal-bajo-piso" /> : null}
                      </a>
                    ))}
                    {piezas.length > 4 ? (
                      <span className="cal-mas">+{piezas.length - 4}</span>
                    ) : null}
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      </div>

      <div className="card cal-pie">
        <div className="cal-leyenda">
          {TIPOS.filter((t) => t.valor !== "todo").map((t) => (
            <span key={t.valor}>
              <i style={{ background: t.color }} /> {t.texto}
            </span>
          ))}
          <span>
            <i className="cal-punto-piso" /> Bajo el piso de alcance
          </span>
        </div>
        <strong>
          {num(visiblesMes.length)} {visiblesMes.length === 1 ? "publicación" : "publicaciones"} en{" "}
          {MESES[cursor.mes]}
        </strong>
      </div>

      <Base>
        A diferencia del resto del panel, el calendario muestra <b>todas</b> las piezas, también
        las que no superan el piso de {num(d.piso_alcance)} de alcance — van marcadas con un punto.
        Un calendario que esconde publicaciones miente sobre la cadencia. Ventana de análisis: últimos 12 meses, {num(filas.length)} piezas. El contenido
        anterior sigue en la base pero no se muestra.
      </Base>

      <Nota>
        Esto muestra lo <b>ya publicado</b>, tomado de Instagram. Para que Leo <b>planifique</b> aquí
        —agendar una pieza antes de grabarla, marcar historias— hace falta escritura: una tabla de
        contenido planificado, autenticación para saber quién escribe, y revisar la decisión de que
        la v1 fuera de solo lectura. Es la mitad que falta, y es una decisión tuya, no un pendiente
        técnico.
      </Nota>
    </div>
  );
}
