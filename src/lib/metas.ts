/** Metas mensuales del negocio y su ritmo. Mismo catalogo de metricas que el
 *  check de supabase/migrations/0015_metas_mensuales.sql. */
export const METRICAS_META = {
  ingresos_usd: { nombre: "Facturación", usd: true },
  ventas: { nombre: "Clientes nuevos", usd: false },
  agendas: { nombre: "Llamadas agendadas", usd: false },
  asistieron: { nombre: "Llamadas realizadas", usd: false },
  conversaciones: { nombre: "Conversaciones de anuncios", usd: false },
} as const;

export type MetricaMeta = keyof typeof METRICAS_META;

export interface Meta {
  mes: string;
  metrica: MetricaMeta;
  objetivo: number;
}

export interface Ritmo {
  /** % del objetivo ya logrado. */
  logrado: number | null;
  /** Lo que deberia llevarse a hoy si el mes avanzara parejo. */
  esperado: number;
  estado: "cumplida" | "adelante" | "atras" | "no_cumplida" | "sin_dato";
  faltan: number | null;
  /** Lo que hay que sumar por cada dia que queda para llegar. */
  por_dia: number | null;
  dia: number;
  dias: number;
  cerrado: boolean;
}

const diasDelMes = (mes: string) => new Date(Date.UTC(Number(mes.slice(0, 4)), Number(mes.slice(5, 7)), 0)).getUTCDate();

/**
 * @param actual lo medido en el mes; null = la fuente no cubre el periodo
 * @param mes    primer dia del mes, AAAA-MM-01
 * @param hoy    AAAA-MM-DD; el dia de hoy cuenta como transcurrido
 */
export function ritmoMeta(actual: number | null, objetivo: number, mes: string, hoy: string): Ritmo {
  const dias = diasDelMes(mes);
  const fin = `${mes.slice(0, 8)}${String(dias).padStart(2, "0")}`;
  const cerrado = hoy > fin;
  const dia = cerrado ? dias : hoy < mes ? 0 : Number(hoy.slice(8, 10));
  const esperado = (objetivo * dia) / dias;
  if (actual === null) {
    return { logrado: null, esperado, estado: "sin_dato", faltan: null, por_dia: null, dia, dias, cerrado };
  }
  const faltan = Math.max(objetivo - actual, 0);
  const estado = actual >= objetivo ? "cumplida" : cerrado ? "no_cumplida" : actual >= esperado ? "adelante" : "atras";
  return {
    logrado: (actual / objetivo) * 100,
    esperado,
    estado,
    faltan,
    por_dia: cerrado || !faltan ? null : faltan / Math.max(dias - dia, 1),
    dia,
    dias,
    cerrado,
  };
}

/** POST guarda (o reemplaza) la meta del mes; DELETE la quita. */
export async function enviarMeta(jwt: string | null, metodo: "POST" | "DELETE", cuerpo: { mes: string; metrica: MetricaMeta; objetivo?: number }) {
  const r = await fetch("/api/metas", {
    method: metodo,
    headers: { "content-type": "application/json", ...(jwt ? { authorization: `Bearer ${jwt}` } : {}) },
    body: JSON.stringify(cuerpo),
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok || d.error) throw new Error(d.error || "No se pudo guardar la meta.");
}
