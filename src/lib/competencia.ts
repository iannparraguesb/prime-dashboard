type PiezaComp = {
  id: string;
  fecha: string;
  interaccion_sobre_seguidores_pct: number | null;
};

export type ResumenCuenta = {
  publicadas: number;
  medidas: number;
  mediana: number | null;
  porSemana: number | null;
  mejor: PiezaComp | null;
};

function dentro(fecha: string, referencia: Date, dias: number): boolean {
  const t = Date.parse(`${fecha}T12:00:00`);
  if (Number.isNaN(t)) return false;
  const edad = referencia.getTime() - t;
  return edad >= 0 && edad <= dias * 86_400_000;
}

function mediana(vals: number[]): number | null {
  if (!vals.length) return null;
  const ord = [...vals].sort((a, b) => a - b);
  const m = Math.floor(ord.length / 2);
  return ord.length % 2 === 1
    ? ord[m]
    : Number(((ord[m - 1] + ord[m]) / 2).toFixed(4));
}

export function resumirCuenta(
  piezas: PiezaComp[],
  referencia: Date,
  dias = 30
): ResumenCuenta {
  const enVentana = piezas.filter((p) => dentro(p.fecha, referencia, dias));
  const medibles = enVentana
    .filter((p) => typeof p.interaccion_sobre_seguidores_pct === "number")
    .map((p) => p.interaccion_sobre_seguidores_pct as number);
  const mejor = [...enVentana]
    .filter((p) => typeof p.interaccion_sobre_seguidores_pct === "number")
    .sort(
      (a, b) =>
        (b.interaccion_sobre_seguidores_pct as number) -
        (a.interaccion_sobre_seguidores_pct as number)
    )[0] ?? null;
  return {
    publicadas: enVentana.length,
    medidas: medibles.length,
    mediana: mediana(medibles),
    porSemana: enVentana.length
      ? Number((enVentana.length / (dias / 7)).toFixed(1))
      : null,
    mejor,
  };
}

export function brechaRelativa(
  propia: number | null,
  referencia: number | null
): number | null {
  if (propia == null || referencia == null || referencia === 0) return null;
  return Math.round(((propia - referencia) / referencia) * 100);
}

export function ordenarCuentas<T extends { resumen: { mediana: number | null } }>(
  filas: T[]
): T[] {
  return [...filas].sort((a, b) => {
    const va = a.resumen.mediana;
    const vb = b.resumen.mediana;
    if (va == null && vb == null) return 0;
    if (va == null) return 1;
    if (vb == null) return -1;
    return (vb as number) - (va as number);
  });
}