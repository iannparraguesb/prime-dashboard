import { useState, type ReactNode } from "react";
import { useAncho } from "../hooks/useAncho";

export interface Serie {
  nombre: string;
  color: string;
  /** null = sin dato para ese periodo (se marca, no se dibuja como cero). */
  valores: (number | null)[];
}

/**
 * Barras agrupadas con detalle al pasar el cursor. Una sola escala: si dos
 * series no comparten unidad, van en dos graficos.
 */
export function GraficoBarras({
  etiquetas,
  series,
  formato,
  detalle,
  alto = 220,
}: {
  etiquetas: string[];
  series: Serie[];
  formato: (v: number) => string;
  /** Lineas extra del tooltip para el indice i. */
  detalle?: (i: number) => ReactNode;
  alto?: number;
}) {
  const [ref, W] = useAncho<HTMLDivElement>();
  const [activa, setActiva] = useState<number | null>(null);
  const M = { izq: 52, der: 8, arr: 10, aba: 26 };
  const max = Math.max(...series.flatMap((s) => s.valores.map((v) => v ?? 0)), 1);
  const paso = pasoRedondo(max);
  const tope = Math.ceil(max / paso) * paso;
  const h = alto - M.arr - M.aba;
  const banda = (W - M.izq - M.der) / Math.max(etiquetas.length, 1);
  const barra = Math.max(4, Math.min(28, (banda - 12 - (series.length - 1) * 2) / series.length));
  const grupo = barra * series.length + (series.length - 1) * 2;
  const y = (v: number) => M.arr + h - (v / tope) * h;
  const ticks = Array.from({ length: Math.floor(tope / paso) + 1 }, (_, i) => i * paso);
  // Con muchas barras, una etiqueta de por medio para que no se pisen.
  const saltoEtiqueta = banda < 48 ? Math.ceil(48 / banda) : 1;

  return (
    <div className="grafico">
      {series.length > 1 ? (
        <div className="grafico-leyenda">
          {series.map((s) => (
            <span key={s.nombre}><i style={{ background: s.color }} /> {s.nombre}</span>
          ))}
        </div>
      ) : null}
      <div ref={ref} style={{ position: "relative" }}>
        <svg width={W} height={alto} role="img" aria-label={series.map((s) => s.nombre).join(" y ")} style={{ display: "block" }}>
          {ticks.map((t) => (
            <g key={t}>
              <line x1={M.izq} x2={W - M.der} y1={y(t)} y2={y(t)} stroke="var(--linea)" />
              <text x={M.izq - 8} y={y(t) + 4} textAnchor="end" fontSize={11} fill="var(--texto-3)">{formato(t)}</text>
            </g>
          ))}
          {etiquetas.map((et, i) => {
            const x0 = M.izq + i * banda + (banda - grupo) / 2;
            const atenuar = activa !== null && activa !== i;
            return (
              <g key={et + i}>
                {series.map((s, j) => {
                  const v = s.valores[i];
                  const x = x0 + j * (barra + 2);
                  if (v === null) {
                    return <text key={s.nombre} x={x + barra / 2} y={y(0) - 4} textAnchor="middle" fontSize={11} fill="var(--texto-3)">—</text>;
                  }
                  return v > 0 ? (
                    <path key={s.nombre} d={barraRedonda(x, y(v), barra, y(0))} fill={s.color} opacity={atenuar ? 0.4 : 1} />
                  ) : null;
                })}
                {i % saltoEtiqueta === 0 ? (
                  <text x={M.izq + i * banda + banda / 2} y={alto - 8} textAnchor="middle" fontSize={11} fill="var(--texto-2)">{et}</text>
                ) : null}
                <rect
                  x={M.izq + i * banda} y={M.arr} width={banda} height={h} fill="transparent" className="grafico-hit"
                  tabIndex={0} aria-label={`${et}: ${series.map((s) => `${s.nombre} ${s.valores[i] === null ? "sin dato" : formato(s.valores[i]!)}`).join(", ")}`}
                  onMouseEnter={() => setActiva(i)} onMouseLeave={() => setActiva(null)}
                  onFocus={() => setActiva(i)} onBlur={() => setActiva(null)}
                />
              </g>
            );
          })}
          <line x1={M.izq} x2={W - M.der} y1={y(0)} y2={y(0)} stroke="var(--linea-fuerte)" />
        </svg>
        {activa !== null ? (
          <div
            className="grafico-tip"
            style={{ left: Math.min(Math.max(M.izq + (activa + 0.5) * banda, 100), W - 100) }}
          >
            <b>{etiquetas[activa]}</b>
            {series.map((s) => (
              <div key={s.nombre}>
                <i style={{ background: s.color }} /> {s.nombre}
                <span>{s.valores[activa] === null ? "—" : formato(s.valores[activa]!)}</span>
              </div>
            ))}
            {detalle?.(activa)}
          </div>
        ) : null}
      </div>
    </div>
  );
}

/** Barra con las esquinas superiores redondeadas (4px) y base recta. */
function barraRedonda(x: number, yTop: number, w: number, yBase: number) {
  const h = yBase - yTop;
  if (h <= 0) return "";
  const r = Math.min(4, h, w / 2);
  return `M${x},${yBase} V${yTop + r} Q${x},${yTop} ${x + r},${yTop} H${x + w - r} Q${x + w},${yTop} ${x + w},${yTop + r} V${yBase} Z`;
}

function pasoRedondo(max: number) {
  const bruto = max / 4;
  const mag = 10 ** Math.floor(Math.log10(bruto));
  const f = bruto / mag;
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * mag;
}
