import type { ReactNode } from "react";
import { Icono, type NombreIcono } from "./icons";
import type { Numerico } from "../tipos";

/* --------------------------------------------------------------------------
   Formateadores
   Regla que vale por todo el panel: un dato que la API no devolvio NO es cero.
   Se muestra un guion. Mostrar "0,0%" donde no hubo medicion hace creer que la
   pieza fracaso cuando en realidad no se midio.
   -------------------------------------------------------------------------- */
const ES = "es-CL";

export const NADA = "—";

export function num(v: Numerico | undefined): string {
  if (v === null || v === undefined || Number.isNaN(v)) return NADA;
  return v.toLocaleString(ES);
}

/** Compacta a mil/millon. Solo para el numero grande de la tarjeta. */
export function compacto(v: Numerico | undefined): string {
  if (v === null || v === undefined || Number.isNaN(v)) return NADA;
  if (Math.abs(v) >= 1_000_000) return `${(v / 1_000_000).toLocaleString(ES, { maximumFractionDigits: 1 })}M`;
  if (Math.abs(v) >= 1000) return `${(v / 1000).toLocaleString(ES, { maximumFractionDigits: 1 })}K`;
  return v.toLocaleString(ES);
}

export function pct(v: Numerico | undefined, decimales = 1): string {
  if (v === null || v === undefined || Number.isNaN(v)) return NADA;
  return `${v.toLocaleString(ES, { minimumFractionDigits: decimales, maximumFractionDigits: decimales })}%`;
}

export function mult(v: Numerico | undefined): string {
  if (v === null || v === undefined || Number.isNaN(v)) return NADA;
  return `x${v.toLocaleString(ES, { minimumFractionDigits: 1, maximumFractionDigits: 1 })}`;
}

export function fechaCorta(iso: string | null | undefined): string {
  if (!iso) return NADA;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso.slice(0, 10);
  return d.toLocaleDateString(ES, { day: "2-digit", month: "short", year: "2-digit" });
}

export function horaCorta(iso: string | null | undefined): string {
  if (!iso) return NADA;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return NADA;
  return d.toLocaleString(ES, { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}

export const NOMBRE_FORMATO: Record<string, string> = {
  // La base entrega el formato canonico; la API de Instagram usa otros nombres.
  // Se aceptan los dos para que el panel sirva con cualquiera de las dos fuentes.
  REEL: "Reel",
  CARRUSEL: "Carrusel",
  IMAGEN: "Imagen",
  OTRO: "Otro",
  VIDEO: "Video",
  IMAGE: "Imagen",
  CAROUSEL_ALBUM: "Carrusel",
};

/* -------------------------------------------------------------------------- */

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`card ${className}`.trim()}>{children}</div>;
}

export function Kpi({
  etiqueta,
  valor,
  pie,
  icono,
}: {
  etiqueta: string;
  valor: string;
  pie?: string;
  icono?: NombreIcono;
}) {
  return (
    <div className="card kpi">
      <div className="kpi-lbl">
        {icono ? <Icono nombre={icono} size={13} /> : null}
        {etiqueta}
      </div>
      <div className="kpi-val num">{valor}</div>
      {pie ? <div className="kpi-pie">{pie}</div> : null}
    </div>
  );
}

export function Badge({
  children,
  tono,
}: {
  children: ReactNode;
  tono?: "oro" | "bien" | "mal";
}) {
  return (
    <span className="badge" data-tono={tono}>
      {children}
    </span>
  );
}

/** Nota de limite. Los limites de cada fuente van EN LA PANTALLA, no solo en el codigo. */
export function Nota({ children }: { children: ReactNode }) {
  return (
    <div className="nota">
      <Icono nombre="info" size={15} />
      <div>{children}</div>
    </div>
  );
}

/** Cada tabla y cada ranking dice sobre que base esta calculado. */
export function Base({ children }: { children: ReactNode }) {
  return <p className="base">{children}</p>;
}

export function Barra({ partes }: { partes: { valor: number; color: string; nombre: string }[] }) {
  const total = partes.reduce((s, p) => s + p.valor, 0);
  if (!total) return <div className="barra" />;
  return (
    <div className="barra" role="img" aria-label={partes.map((p) => `${p.nombre}: ${p.valor}`).join(", ")}>
      {partes.map((p) => (
        <span key={p.nombre} style={{ width: `${(p.valor / total) * 100}%`, background: p.color }} />
      ))}
    </div>
  );
}

/** Variacion contra el periodo anterior, como la muestra Instagram. Sin base
 *  comparable no se inventa un porcentaje: no se muestra nada. */
export function Delta({ actual, previo, texto = "vs. periodo anterior" }: { actual: Numerico | undefined; previo: Numerico | undefined; texto?: string }) {
  if (actual === null || actual === undefined || previo === null || previo === undefined || previo === 0) return null;
  const v = ((actual - previo) / Math.abs(previo)) * 100;
  const tono = Math.abs(v) < 0.5 ? "igual" : v > 0 ? "sube" : "baja";
  return (
    <span className="delta" data-tono={tono}>
      {tono === "igual" ? "= " : tono === "sube" ? "↑ " : "↓ "}
      {Math.abs(v).toLocaleString(ES, { maximumFractionDigits: 0 })}% <span>{texto}</span>
    </span>
  );
}

/** "Hace 2 dias". Para saber de un vistazo si lo que se ve esta al dia. */
export function haceCuanto(iso: string | null | undefined): string {
  if (!iso) return "sin datos";
  const ms = Date.now() - new Date(iso.length === 10 ? `${iso}T12:00:00` : iso).getTime();
  const h = Math.floor(ms / 3_600_000);
  if (h < 1) return "hace un momento";
  if (h < 24) return `hace ${h} h`;
  const d = Math.floor(h / 24);
  return d === 1 ? "ayer" : `hace ${d} días`;
}
