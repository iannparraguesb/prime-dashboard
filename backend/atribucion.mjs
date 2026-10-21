/**
 * Atribucion de ventas a piezas de contenido.
 *
 * El registro del setter tiene una columna libre, "Detalle de la fuente (qué
 * story, reel o anuncio)". Si ahi se pega el link de Instagram, la venta se
 * cruza con la publicacion o la historia que la origino comparando contra el
 * permalink que entrega la API. Sin link reconocible no se adivina por texto:
 * la venta queda sin pieza y se cuenta aparte, para que se vea cuanto falta.
 */

// instagram.com/reel/X, /p/X, /tv/X y la variante con usuario: /leo_opazo/reel/X
const RE_PUBLICACION = /instagram\.com\/(?:[A-Za-z0-9_.]+\/)?(?:reels?|p|tv)\/([A-Za-z0-9_-]+)/i;
// instagram.com/stories/leo_opazo/3456789012345678901
const RE_HISTORIA = /instagram\.com\/stories\/[A-Za-z0-9_.]+\/(\d+)/i;

/** Clave comparable de un link de Instagram, o null si el texto no trae uno.
 *  El shortcode distingue mayusculas: no se normaliza. */
export function claveInstagram(texto) {
  const t = String(texto ?? "");
  const h = RE_HISTORIA.exec(t);
  if (h) return `historia:${h[1]}`;
  const p = RE_PUBLICACION.exec(t);
  return p ? `publicacion:${p[1]}` : null;
}

const numero = (v) => (v === null || v === undefined || v === "" || Number.isNaN(Number(v)) ? null : Number(v));

function acumular(mapa, clave, base, monto) {
  const a = mapa.get(clave) ?? { ...base, ventas: 0, ingresos_usd: 0, sin_monto: 0 };
  a.ventas += 1;
  if (monto === null) a.sin_monto += 1;
  else a.ingresos_usd += monto;
  mapa.set(clave, a);
}

const porIngresos = (a, b) => b.ingresos_usd - a.ingresos_usd || b.ventas - a.ventas;

/**
 * @param llamadas filas de negocio_llamada (fecha, prospecto, fuente, detalle, resultado, monto_usd)
 * @param piezas   publicaciones propias: { id, permalink, fecha, formato, titulo, thumb }
 * @param historias historias propias: { id, permalink, fecha }
 */
export function atribuirVentas(llamadas, piezas, historias) {
  const indice = new Map();
  for (const p of piezas) {
    const k = claveInstagram(p.permalink);
    if (k) indice.set(k, { tipo: "publicacion", id: p.id, permalink: p.permalink, fecha: p.fecha ?? null,
      formato: p.formato ?? null, titulo: p.titulo ?? "", thumb: p.thumb ?? null });
  }
  for (const h of historias) {
    const k = claveInstagram(h.permalink);
    if (k) indice.set(k, { tipo: "historia", id: h.id, permalink: h.permalink, fecha: h.fecha ?? null,
      formato: "HISTORIA", titulo: "", thumb: null });
  }

  const cobertura = { ventas: 0, con_pieza: 0, link_sin_pieza: 0, sin_link: 0, sin_detalle: 0 };
  const porPieza = new Map();
  const porFuente = new Map();
  const ventas = [];

  for (const l of llamadas) {
    if (l.resultado !== "Cerró") continue;
    const monto = numero(l.monto_usd);
    const detalle = String(l.detalle ?? "").trim();
    const clave = claveInstagram(detalle);
    const pieza = clave ? indice.get(clave) ?? null : null;
    const estado = pieza ? "con_pieza" : clave ? "link_sin_pieza" : detalle ? "sin_link" : "sin_detalle";
    cobertura.ventas += 1;
    cobertura[estado] += 1;
    if (pieza) acumular(porPieza, pieza.id, { pieza }, monto);
    acumular(porFuente, l.fuente || "Sin anotar", { fuente: l.fuente || "Sin anotar" }, monto);
    ventas.push({ fecha: l.fecha, prospecto: l.prospecto, fuente: l.fuente ?? null, monto_usd: monto, estado, pieza });
  }

  return {
    cobertura,
    por_pieza: [...porPieza.values()].sort(porIngresos),
    por_fuente: [...porFuente.values()].sort(porIngresos),
    ventas: ventas.sort((a, b) => b.fecha.localeCompare(a.fecha)),
  };
}
