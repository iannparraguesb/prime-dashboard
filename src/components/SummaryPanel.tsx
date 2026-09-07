import { Base, compacto, mult, num, pct } from "./ui";
import type { Numerico, Pieza } from "../tipos";

export function medianaDe(valores: Numerico[]): number | null {
  const xs = valores.filter((v): v is number => v !== null && !Number.isNaN(v)).sort((a, b) => a - b);
  if (!xs.length) return null;
  const m = Math.floor(xs.length / 2);
  return xs.length % 2 ? xs[m] : (xs[m - 1] + xs[m]) / 2;
}

function suma(piezas: Pieza[], campo: keyof Pieza): number | null {
  const xs = piezas.map((p) => p[campo]).filter((v): v is number => typeof v === "number");
  return xs.length ? xs.reduce((a, b) => a + b, 0) : null;
}

/** Aro: la mediana de guardado de lo filtrado, comparada contra la mediana de
 *  todo el catalogo solido. El relleno se satura en x2 para que un caso extremo
 *  no rompa la escala. */
function Aro({ valor, base }: { valor: number | null; base: number | null }) {
  const razon = valor !== null && base ? valor / base : null;
  const relleno = razon === null ? 0 : Math.min(razon, 2) / 2;
  const r = 34;
  const c = 2 * Math.PI * r;
  return (
    <div className="aro">
      <svg width="88" height="88" viewBox="0 0 88 88" aria-hidden="true">
        <circle cx="44" cy="44" r={r} fill="none" stroke="var(--superficie-alta)" strokeWidth="9" />
        <circle
          cx="44"
          cy="44"
          r={r}
          fill="none"
          stroke="var(--prime-gold)"
          strokeWidth="9"
          strokeLinecap="round"
          strokeDasharray={`${c * relleno} ${c}`}
          transform="rotate(-90 44 44)"
        />
      </svg>
      <div className="aro-num num">{pct(valor, 2)}</div>
      <div style={{ fontSize: 11, color: "var(--texto-3)", textAlign: "center", lineHeight: 1.4 }}>
        mediana de guardado
        <br />
        {razon === null ? "sin base de comparacion" : `${mult(Number(razon.toFixed(2)))} el catalogo completo`}
      </div>
    </div>
  );
}

export function SummaryPanel({
  filtradas,
  todas,
  piso,
}: {
  filtradas: Pieza[];
  todas: Pieza[];
  piso: number;
}) {
  const medFiltro = medianaDe(filtradas.map((p) => p.guardado_pct));
  const medTodas = medianaDe(todas.map((p) => p.guardado_pct));
  const sinMedir = filtradas.filter((p) => p.guardado_pct === null).length;

  return (
    <aside className="card resumen-lat">
      <Aro valor={medFiltro} base={medTodas} />

      <div>
        <div className="resumen-fila">
          <span>Piezas en el filtro</span>
          <b>{num(filtradas.length)}</b>
        </div>
        <div className="resumen-fila">
          <span>Alcance sumado</span>
          <b>{compacto(suma(filtradas, "alcance"))}</b>
        </div>
        <div className="resumen-fila">
          <span>Guardados</span>
          <b>{compacto(suma(filtradas, "guardados"))}</b>
        </div>
        <div className="resumen-fila">
          <span>Compartidos</span>
          <b>{compacto(suma(filtradas, "compartidos"))}</b>
        </div>
        <div className="resumen-fila">
          <span>Likes</span>
          <b>{compacto(suma(filtradas, "likes"))}</b>
        </div>
        <div className="resumen-fila">
          <span>Comentarios</span>
          <b>{compacto(suma(filtradas, "comentarios"))}</b>
        </div>
        <div className="resumen-fila">
          <span>Mediana de compartido</span>
          <b>{pct(medianaDe(filtradas.map((p) => p.compartido_pct)), 2)}</b>
        </div>
      </div>

      <Base>
        Totales del filtro activo, no del catalogo completo. Solo entran piezas con {num(piso)} o mas de
        alcance.
        {sinMedir > 0
          ? ` ${sinMedir} pieza${sinMedir === 1 ? "" : "s"} sin tasa de guardado: la API no devolvio el dato, no es cero.`
          : ""}
      </Base>
    </aside>
  );
}
