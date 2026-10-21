import type { Historia } from "../tipos";

/** Dos historias seguidas son de la misma secuencia si entre una y otra pasan
 *  menos de este margen. Una tanda se publica en minutos; entre tandas del
 *  mismo dia pasan horas. */
export const CORTE_SECUENCIA_MIN = 90;

/** Una historia vive 24 horas. Antes de eso su alcance todavia sube, y la
 *  caida contra la anterior (que lleva mas tiempo arriba) sale inflada. */
const VIDA_MS = 24 * 3_600_000;

export interface Slide {
  historia: Historia;
  posicion: number;
  /** Alcance de este slide sobre el del primero, en %. */
  retencion: number | null;
  /** Lo que se perdio contra el slide anterior, en %. Negativo = gano gente. */
  caida: number | null;
}

export interface Secuencia {
  id: string;
  inicio: string;
  fin: string;
  slides: Slide[];
  retencion_final: number | null;
  respuestas: number | null;
  visitas_perfil: number | null;
  mayor_caida: { posicion: number; pct: number } | null;
  /** Algun slide tiene menos de 24 h: sus numeros todavia se mueven. */
  en_curso: boolean;
}

export interface ResumenSecuencias {
  cerradas: number;
  retencion_mediana: number | null;
  caida_primera_mediana: number | null;
}

const redondear = (v: number) => Number(v.toFixed(2));

function cociente(a: number | null, b: number | null): number | null {
  return a !== null && b !== null && b > 0 ? a / b : null;
}

/** Suma solo si todos los slides fueron medidos: un null no es cero. */
function sumaCompleta(vals: (number | null)[]): number | null {
  return vals.some((v) => v === null) ? null : vals.reduce<number>((s, v) => s + (v ?? 0), 0);
}

function mediana(vals: number[]): number | null {
  if (!vals.length) return null;
  const ord = [...vals].sort((a, b) => a - b);
  const m = Math.floor(ord.length / 2);
  return redondear(ord.length % 2 === 1 ? ord[m] : (ord[m - 1] + ord[m]) / 2);
}

/** Agrupa historias en secuencias, de la mas reciente a la mas antigua. Las que
 *  no traen hora se dejan fuera: no hay forma de ubicarlas en una tanda. */
export function armarSecuencias(filas: Historia[], ahora: Date, corteMin = CORTE_SECUENCIA_MIN): Secuencia[] {
  const conHora = filas
    .map((h) => ({ h, t: h.hora ? Date.parse(h.hora) : Number.NaN }))
    .filter((x) => !Number.isNaN(x.t))
    .sort((a, b) => a.t - b.t);

  const grupos: (typeof conHora)[] = [];
  for (const x of conHora) {
    const actual = grupos[grupos.length - 1];
    if (actual && x.t - actual[actual.length - 1].t <= corteMin * 60_000) actual.push(x);
    else grupos.push([x]);
  }

  return grupos
    .map((g) => {
      const primero = g[0].h.alcance;
      const slides: Slide[] = g.map(({ h }, i) => {
        const r = cociente(h.alcance, primero);
        const previo = i > 0 ? cociente(h.alcance, g[i - 1].h.alcance) : null;
        return {
          historia: h,
          posicion: i + 1,
          retencion: r === null ? null : redondear(r * 100),
          caida: previo === null ? null : redondear((1 - previo) * 100),
        };
      });
      const caidas = slides.filter((s) => s.caida !== null);
      const mayor = caidas.length
        ? caidas.reduce((a, b) => ((b.caida as number) > (a.caida as number) ? b : a))
        : null;
      return {
        id: g[0].h.id,
        inicio: g[0].h.hora as string,
        fin: g[g.length - 1].h.hora as string,
        slides,
        retencion_final: g.length > 1 ? slides[slides.length - 1].retencion : null,
        respuestas: sumaCompleta(g.map(({ h }) => h.respuestas)),
        visitas_perfil: sumaCompleta(g.map(({ h }) => h.visitas_perfil)),
        mayor_caida: mayor ? { posicion: mayor.posicion, pct: mayor.caida as number } : null,
        en_curso: g.some(({ t }) => ahora.getTime() - t < VIDA_MS),
      };
    })
    .reverse();
}

/** Solo cuentan las secuencias cerradas de 2+ slides: con una sola no hay
 *  curva, y las que siguen en curso todavia no terminaron de sumar alcance. */
export function resumirSecuencias(secs: Secuencia[]): ResumenSecuencias {
  const cerradas = secs.filter((s) => !s.en_curso && s.slides.length > 1);
  return {
    cerradas: cerradas.length,
    retencion_mediana: mediana(cerradas.map((s) => s.retencion_final).filter((v): v is number => v !== null)),
    caida_primera_mediana: mediana(cerradas.map((s) => s.slides[1].caida).filter((v): v is number => v !== null)),
  };
}
