/**
 * Motor de sugerencias del banco de ideas. Sin IA: reglas sobre datos.
 *
 * Cuatro fuentes, intercaladas para que cada tanda sea variada:
 *   1. propia       lo que mejor rindio en la cuenta de Leo, llevado a otro formato
 *   2. competencia  lo que mas funciono en las cuentas vigiladas, en version de Leo
 *   3. sugerida     objeciones, soluciones falsas y dolores del avatar, y casos
 *                   reales de alumnos. Todo sale de context/avatares.md y
 *                   context/oferta.md: nada inventado.
 *
 * Cada sugerencia tiene una `clave` estable. Guardarla o descartarla la saca de
 * la lista para siempre (la tabla `idea` tiene la clave como unica).
 */

const NOMBRE = { historia: "historia", carrusel: "carrusel", reel: "reel", post: "post" };
const DESDE_FORMATO = { REEL: "reel", CARRUSEL: "carrusel", IMAGEN: "post", OTRO: "post" };
const OTROS_FORMATOS = { reel: ["carrusel", "historia"], carrusel: ["reel", "historia"], post: ["carrusel", "historia"] };
const MESES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
const fechaCorta = (iso) => (iso ? `${Number(iso.slice(8, 10))} ${MESES[Number(iso.slice(5, 7)) - 1]}` : "");

/** De un caption a un tema corto: sin el "Comenta X y te envio", sin hashtags. */
export function tema(caption) {
  let t = String(caption ?? "")
    .replace(/^comenta\s+["“]?\S+["”]?\s+y\s+(te\s+env[ií]o|descarga|recibe|te\s+mando|te\s+comparto)\s+/i, "")
    .replace(/[#@][\p{L}\p{N}_.]+/gu, "")
    .replace(/\p{Extended_Pictographic}/gu, "")
    .replace(/\s+/g, " ")
    .trim();
  const corte = t.search(/[.!?\n]/);
  if (corte > 20) t = t.slice(0, corte);
  if (t.length > 80) t = `${t.slice(0, 77).replace(/\s+\S*$/, "")}…`;
  return t ? t[0].toUpperCase() + t.slice(1) : "";
}

const x1 = (v) => (Math.round(v * 10) / 10).toLocaleString("es-CL");

function dePropias(piezas) {
  const salida = [];
  const top = piezas
    .filter((p) => typeof p.multiplicador === "number" && p.multiplicador >= 1.2 && tema(p.primera_linea))
    .sort((a, b) => b.multiplicador - a.multiplicador)
    .slice(0, 30);
  for (const p of top) {
    const t = tema(p.primera_linea);
    const f = DESDE_FORMATO[p.formato] ?? "post";
    const motivo = `Tu ${NOMBRE[f]} del ${fechaCorta(p.fecha)} se guardó ${x1(p.multiplicador)}x más que lo normal.`;
    const ref = { referencia_url: p.permalink ?? null, referencia_thumb: p.thumb ?? null, referencia_cuenta: null };
    for (const otro of OTROS_FORMATOS[f]) {
      salida.push({
        clave: `propia:${otro}:${p.id}`,
        formato: otro,
        origen: "propia",
        titulo: otro === "historia" ? `Encuesta en historias sobre «${t}»` : otro === "carrusel" ? `Carrusel paso a paso: «${t}»` : `Reel de 30 segundos: «${t}»`,
        hook: otro === "historia" ? "¿Te pasa esto? Respóndeme sí o no." : otro === "carrusel" ? "Esto fue lo que más guardaron. Te lo dejo ordenado." : "Te lo explico en 30 segundos.",
        motivo,
        ...ref,
      });
    }
    if (p.multiplicador >= 1.5) {
      salida.push({
        clave: `propia:parte2:${p.id}`,
        formato: f,
        origen: "propia",
        titulo: `Parte 2 de «${t}»`,
        hook: "Me pidieron la segunda parte. Aquí va.",
        motivo,
        ...ref,
      });
    }
  }
  return salida;
}

function deCompetencia(cuentas) {
  const salida = [];
  const hoy = Date.now();
  for (const c of Object.values(cuentas ?? {})) {
    const base = c.interaccion_mediana_pct;
    if (!base) continue;
    const top = (c.piezas ?? [])
      .filter((p) => p.interaccion_sobre_seguidores_pct !== null && tema(p.primera_linea))
      .filter((p) => hoy - Date.parse(`${p.fecha}T12:00:00`) <= 120 * 86_400_000)
      .map((p) => ({ ...p, ratio: p.interaccion_sobre_seguidores_pct / base }))
      .filter((p) => p.ratio >= 1.5)
      .sort((a, b) => b.ratio - a.ratio)
      .slice(0, 10);
    for (const p of top) {
      const t = tema(p.primera_linea);
      const f = DESDE_FORMATO[p.formato] ?? "post";
      const ref = { referencia_url: p.permalink ?? null, referencia_thumb: p.thumb ?? null, referencia_cuenta: c.username };
      const motivo = `A @${c.username} le funcionó ${x1(p.ratio)}x más que su promedio.`;
      salida.push({ clave: `competencia:${f}:${p.id}`, formato: f, origen: "competencia", titulo: `Tu versión de «${t}»`, hook: "Ponte a pensar en esto…", motivo, ...ref });
      salida.push({ clave: `competencia:historia:${p.id}`, formato: "historia", origen: "competencia", titulo: `Tu opinión en historias: «${t}»`, hook: "¿Estás de acuerdo con esto? Te leo.", motivo, ...ref });
    }
  }
  return salida;
}

/* --- Banco del avatar (context/avatares.md y context/oferta.md) ------------- */

const OBJECIONES = [
  ["nunca-vendi", "Nunca he vendido online"],
  ["sin-seguidores", "No tengo seguidores ni web"],
  ["funcionara", "No sé si esto funcionará para mí"],
  ["herramientas", "No sé usar herramientas digitales"],
  ["mas-opciones", "Prefiero ver más opciones antes"],
  ["cobrar-si-gano", "¿Por qué no me cobras solo si gano?"],
];

const FALSAS = [
  ["web", "crear una página web como primer paso", "La web no vende sola"],
  ["contenido-diario", "publicar contenido todos los días", "Solo con contenido, los alumnos tardan meses en llegar"],
  ["barato", "vender barato para tener volumen", "El volumen barato te agota"],
  ["influencers", "copiar a los influencers", "Los influencers juegan otra liga"],
  ["titulos", "sacar más títulos", "Más títulos no te traen alumnos"],
];

const DOLORES = [
  ["toda-la-vida", "No puedo seguir así toda la vida", "Si vives en el gimnasio cambiando horas por plata, esto es para ti."],
  ["lo-intente", "Lo intenté… pero no funcionó", "No falló tu capacidad. Falló el sistema."],
  ["estancado", "Ya vendo online, pero estoy estancado", "Vender online no es lo mismo que tener un negocio que crece."],
];

const CASOS = [
  ["ricardo", "Ricardo", "pasó de cobrar US$70 al mes a US$697 por un plan semestral"],
  ["natalia", "Natalia", "cerró un plan semestral de US$735 y su alumna pagó apenas colgaron"],
  ["esteban", "Esteban", "cerró un plan semestral de US$1.490"],
  ["maia", "Maia", "vendió un plan anual de US$1.300 y repitió con otra alumna"],
  ["julio", "Julio Ospina", "vende su propio método, el Protocolo Fénix"],
  ["vicente", "Vicente", "lanzó un plan de 99 días"],
];

function delAvatar() {
  const s = [];
  for (const [k, o] of OBJECIONES) {
    s.push({ clave: `objecion:historia:${k}`, formato: "historia", titulo: `Caja de preguntas: «${o}»`, hook: `«${o}». Te respondo en 3 historias.`, motivo: "Objeción frecuente del entrenador que todavía no vende online." });
    s.push({ clave: `objecion:reel:${k}`, formato: "reel", titulo: `Responde «${o}» con un caso real`, hook: `Si piensas «${o}», mira esto.`, motivo: "Objeción frecuente del avatar: rebatirla con prueba, no con promesas." });
    s.push({ clave: `objecion:carrusel:${k}`, formato: "carrusel", titulo: `«${o}»: lo que nadie te explicó`, hook: `«${o}». Lo escucho todas las semanas.`, motivo: "Objeción frecuente del avatar." });
  }
  for (const [k, accion, frase] of FALSAS) {
    s.push({ clave: `falsa:carrusel:${k}`, formato: "carrusel", titulo: `Por qué ${accion} no te trae alumnos`, hook: `${frase}. Te explico por qué.`, motivo: "Solución falsa que el entrenador ya probó: ideal para quien lo intentó y no le funcionó." });
    s.push({ clave: `falsa:reel:${k}`, formato: "reel", titulo: `Deja de ${accion}: esto sí funciona`, hook: `Ponte a pensar: ¿cuánto llevas intentando ${accion}?`, motivo: "Solución falsa del avatar." });
    s.push({ clave: `falsa:historia:${k}`, formato: "historia", titulo: `Encuesta: ¿estás intentando ${accion}?`, hook: `¿Estás intentando ${accion}? Sí / No`, motivo: "Abre conversación por DM con quien responde que sí." });
  }
  for (const [k, d, bajada] of DOLORES) {
    s.push({ clave: `dolor:reel:${k}`, formato: "reel", titulo: `«${d}»`, hook: bajada, motivo: "Dolor principal del avatar, en sus palabras." });
    s.push({ clave: `dolor:post:${k}`, formato: "post", titulo: `Frase: «${d}»`, hook: bajada, motivo: "Dolor principal del avatar, en sus palabras." });
  }
  for (const [k, n, logro] of CASOS) {
    s.push({ clave: `caso:reel:${k}`, formato: "reel", titulo: `Caso ${n}: ${logro}`, hook: `${n} ${logro}. Te cuento cómo.`, motivo: "Caso real documentado de un alumno de CÓDIGO PRIME." });
    s.push({ clave: `caso:historia:${k}`, formato: "historia", titulo: `Captura del caso de ${n} + «Escribe PRIME»`, hook: `Esto me llegó de ${n} esta semana.`, motivo: "Prueba social: las historias son lo que más vende en la cuenta." });
    s.push({ clave: `caso:carrusel:${k}`, formato: "carrusel", titulo: `Cómo ${n} ${logro}`, hook: `${n} ${logro}. Paso a paso.`, motivo: "Caso real documentado de un alumno de CÓDIGO PRIME." });
  }
  return s.map((x) => ({ ...x, origen: "sugerida", referencia_url: null, referencia_thumb: null, referencia_cuenta: null }));
}

/** Intercala las fuentes (1 de cada una por vuelta) para que ninguna tanda sea monotematica. */
function intercalar(listas) {
  const salida = [];
  const largo = Math.max(...listas.map((l) => l.length), 0);
  for (let i = 0; i < largo; i++) for (const l of listas) if (l[i]) salida.push(l[i]);
  return salida;
}

/**
 * @param piezas    piezas propias con multiplicador (rankings.todas)
 * @param cuentas   competencia.cuentas
 * @param usadas    Set de claves ya guardadas o descartadas
 */
export function sugerencias({ piezas, cuentas, usadas, formato = null, desde = 0, porPagina = 12 }) {
  const avatar = delAvatar();
  const todas = intercalar([
    dePropias(piezas),
    deCompetencia(cuentas),
    avatar.filter((x) => x.clave.startsWith("caso:") || x.clave.startsWith("objecion:")),
    avatar.filter((x) => x.clave.startsWith("falsa:") || x.clave.startsWith("dolor:")),
  ]).filter((x) => !usadas.has(x.clave) && (!formato || x.formato === formato));
  return { filas: todas.slice(desde, desde + porPagina), total: todas.length, quedan: Math.max(0, todas.length - desde - porPagina) };
}
