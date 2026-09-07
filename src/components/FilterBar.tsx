import type { Pieza } from "../tipos";

export type CriterioOrden =
  | "guardado_pct"
  | "compartido_pct"
  | "multiplicador"
  | "alcance"
  | "comentarios"
  | "fecha";

export interface Filtros {
  tipo: "todas" | "REELS" | "FEED";
  formato: string | "todos";
  pilar: string | "todos";
  periodo: "todo" | "30" | "90" | "365";
  orden: CriterioOrden;
}

export const FILTROS_INICIALES: Filtros = {
  tipo: "todas",
  formato: "todos",
  pilar: "todos",
  periodo: "todo",
  orden: "guardado_pct",
};

const ORDENES: { valor: CriterioOrden; texto: string }[] = [
  { valor: "guardado_pct", texto: "Tasa de guardado" },
  { valor: "multiplicador", texto: "Multiplicador vs. su formato" },
  { valor: "compartido_pct", texto: "Tasa de compartido" },
  { valor: "alcance", texto: "Alcance" },
  { valor: "comentarios", texto: "Comentarios" },
  { valor: "fecha", texto: "Mas reciente" },
];

const NOMBRE_FORMATO: Record<string, string> = {
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

function dentroDelPeriodo(p: Pieza, periodo: Filtros["periodo"]): boolean {
  if (periodo === "todo") return true;
  const dias = Number(periodo);
  const f = new Date(p.fecha);
  if (Number.isNaN(f.getTime())) return false;
  return (Date.now() - f.getTime()) / 86_400_000 <= dias;
}

/** Aplica todos los filtros menos uno. Sirve para contar cuantos resultados
 *  dejaria cada opcion si la eligieras: sin ese conteo hay que probar a ciegas. */
function aplicar(piezas: Pieza[], f: Filtros, excepto?: keyof Filtros): Pieza[] {
  return piezas.filter(
    (p) =>
      (excepto === "tipo" || f.tipo === "todas" || p.tipo === f.tipo) &&
      (excepto === "formato" || f.formato === "todos" || p.formato === f.formato) &&
      (excepto === "pilar" ||
        f.pilar === "todos" ||
        (f.pilar === "__sin__" ? p.pilares.length === 0 : p.pilares.includes(f.pilar))) &&
      (excepto === "periodo" || dentroDelPeriodo(p, f.periodo))
  );
}

export function filtrar(piezas: Pieza[], f: Filtros): Pieza[] {
  const salida = aplicar(piezas, f);
  const clave = (p: Pieza): number | null => {
    switch (f.orden) {
      case "fecha":
        return new Date(p.fecha).getTime() || null;
      case "alcance":
        return p.alcance;
      case "comentarios":
        return p.comentarios;
      default:
        return p[f.orden];
    }
  };
  // Los null van al final siempre: un dato no medido no compite por el primer puesto.
  return [...salida].sort((a, b) => {
    const va = clave(a);
    const vb = clave(b);
    if (va === null && vb === null) return 0;
    if (va === null) return 1;
    if (vb === null) return -1;
    return vb - va;
  });
}

function Chips<T extends string>({
  etiqueta,
  valor,
  opciones,
  onChange,
}: {
  etiqueta: string;
  valor: T;
  opciones: { valor: T; texto: string; n: number }[];
  onChange: (v: T) => void;
}) {
  return (
    <div className="filtro-grupo">
      <span className="filtro-lbl">{etiqueta}</span>
      <div className="chips">
        {opciones.map((o) => (
          <button
            key={o.valor}
            className="chip"
            aria-pressed={valor === o.valor}
            disabled={o.n === 0 && valor !== o.valor}
            // Un chip gris sin explicacion es un callejon sin salida: el usuario
            // no sabe si esta roto o si de verdad no hay nada de ese tipo.
            title={
              o.n === 0 && valor !== o.valor
                ? `No hay piezas de este tipo con los otros filtros activos`
                : undefined
            }
            onClick={() => onChange(o.valor)}
          >
            {o.texto}
            <span className="chip-n">{o.n}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

export function FilterBar({
  piezas,
  filtros,
  onChange,
  pilares,
}: {
  piezas: Pieza[];
  filtros: Filtros;
  onChange: (f: Filtros) => void;
  pilares: string[];
}) {
  const cuenta = (excepto: keyof Filtros, pred: (p: Pieza) => boolean) =>
    aplicar(piezas, filtros, excepto).filter(pred).length;

  const formatos = Array.from(new Set(piezas.map((p) => p.formato).filter(Boolean))) as string[];

  return (
    <div className="card filtros">
      <Chips
        etiqueta="Tipo"
        valor={filtros.tipo}
        onChange={(tipo) => onChange({ ...filtros, tipo })}
        opciones={[
          { valor: "todas", texto: "Todas", n: cuenta("tipo", () => true) },
          { valor: "REELS", texto: "Reels", n: cuenta("tipo", (p) => p.tipo === "REELS") },
          { valor: "FEED", texto: "Feed", n: cuenta("tipo", (p) => p.tipo === "FEED") },
        ]}
      />

      <Chips
        etiqueta="Formato"
        valor={filtros.formato}
        onChange={(formato) => onChange({ ...filtros, formato })}
        opciones={[
          { valor: "todos", texto: "Todos", n: cuenta("formato", () => true) },
          ...formatos.map((f) => ({
            valor: f,
            texto: NOMBRE_FORMATO[f] ?? f,
            n: cuenta("formato", (p) => p.formato === f),
          })),
        ]}
      />

      <Chips
        etiqueta="Periodo"
        valor={filtros.periodo}
        onChange={(periodo) => onChange({ ...filtros, periodo })}
        opciones={[
          { valor: "todo", texto: "Todo", n: cuenta("periodo", () => true) },
          { valor: "30", texto: "30 d", n: cuenta("periodo", (p) => dentroDelPeriodo(p, "30")) },
          { valor: "90", texto: "90 d", n: cuenta("periodo", (p) => dentroDelPeriodo(p, "90")) },
          { valor: "365", texto: "12 m", n: cuenta("periodo", (p) => dentroDelPeriodo(p, "365")) },
        ]}
      />

      <div className="filtro-grupo">
        <span className="filtro-lbl">Pilar</span>
        <select
          aria-label="Pilar"
          className="control"
          value={filtros.pilar}
          onChange={(e) => onChange({ ...filtros, pilar: e.target.value })}
        >
          <option value="todos">Todos ({cuenta("pilar", () => true)})</option>
          {pilares.map((x) => (
            <option key={x} value={x}>
              {x} ({cuenta("pilar", (p) => p.pilares.includes(x))})
            </option>
          ))}
          <option value="__sin__">Sin clasificar ({cuenta("pilar", (p) => p.pilares.length === 0)})</option>
        </select>
      </div>

      <div className="filtro-grupo">
        <span className="filtro-lbl">Ordenar por</span>
        <select
          aria-label="Ordenar por"
          className="control"
          value={filtros.orden}
          onChange={(e) => onChange({ ...filtros, orden: e.target.value as CriterioOrden })}
        >
          {ORDENES.map((o) => (
            <option key={o.valor} value={o.valor}>
              {o.texto}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}
