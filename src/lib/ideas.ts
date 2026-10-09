export type FormatoIdea = "historia" | "carrusel" | "reel" | "post";
export type EstadoIdea = "idea" | "en_produccion" | "lista" | "publicada" | "descartada";
export type OrigenIdea = "manual" | "sugerida" | "propia" | "competencia";

export interface Idea {
  id: string;
  titulo: string;
  formato: FormatoIdea;
  estado: EstadoIdea;
  hook: string | null;
  nota: string | null;
  origen: OrigenIdea;
  motivo: string | null;
  clave_sugerencia: string | null;
  referencia_url: string | null;
  referencia_thumb: string | null;
  referencia_cuenta: string | null;
  fecha_plan: string | null;
  actualizado_en: string;
}

export interface Sugerencia {
  clave: string;
  formato: FormatoIdea;
  origen: OrigenIdea;
  titulo: string;
  hook: string;
  motivo: string;
  referencia_url: string | null;
  referencia_thumb: string | null;
  referencia_cuenta: string | null;
}

export const FORMATOS: { v: FormatoIdea; t: string; plural: string }[] = [
  { v: "historia", t: "Historia", plural: "Historias" },
  { v: "carrusel", t: "Carrusel", plural: "Carruseles" },
  { v: "reel", t: "Reel", plural: "Reels" },
  { v: "post", t: "Post", plural: "Posts" },
];
export const NOMBRE_FORMATO_IDEA: Record<FormatoIdea, string> = { historia: "Historia", carrusel: "Carrusel", reel: "Reel", post: "Post" };

export const COLUMNAS: { v: EstadoIdea; t: string }[] = [
  { v: "idea", t: "Ideas" },
  { v: "en_produccion", t: "En producción" },
  { v: "lista", t: "Lista para publicar" },
  { v: "publicada", t: "Publicada" },
];

export function origenTexto(x: { origen: OrigenIdea; referencia_cuenta: string | null }) {
  if (x.origen === "competencia") return x.referencia_cuenta ? `Inspirada en @${x.referencia_cuenta}` : "De la competencia";
  if (x.origen === "propia") return "De lo que mejor te funcionó";
  if (x.origen === "sugerida") return "De tu audiencia";
  return "Idea propia";
}

/** POST o PATCH a /api/ideas. Lanza el mensaje del servidor si falla. */
export async function enviarIdea(jwt: string | null, metodo: "POST" | "PATCH", cuerpo: object): Promise<Idea> {
  const r = await fetch("/api/ideas", {
    method: metodo,
    headers: { "content-type": "application/json", ...(jwt ? { authorization: `Bearer ${jwt}` } : {}) },
    body: JSON.stringify(cuerpo),
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok || d.error) throw new Error(d.error || "No se pudo guardar.");
  return d.idea as Idea;
}

/** Guarda (o descarta) una sugerencia en el banco, conservando su referencia. */
export function guardarSugerencia(jwt: string | null, s: Sugerencia, estado: EstadoIdea = "idea") {
  return enviarIdea(jwt, "POST", {
    titulo: s.titulo, formato: s.formato, hook: s.hook, motivo: s.motivo, origen: s.origen, estado,
    clave_sugerencia: s.clave, referencia_url: s.referencia_url, referencia_thumb: s.referencia_thumb,
    referencia_cuenta: s.referencia_cuenta,
  });
}

/** Mismo criterio que backend/ideas.mjs: sin el "Comenta X y te envio", sin hashtags. */
export function tema(caption: string | null | undefined): string {
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
