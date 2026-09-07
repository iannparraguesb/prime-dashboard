import { useMemo } from "react";
import { Icono, type NombreIcono } from "../components/icons";
import { SinDatosSeccion } from "../components/states";
import { medianaDe } from "../components/SummaryPanel";
import { Badge, Base, Kpi, Nota, num, pct, compacto, NADA } from "../components/ui";
import type { Analisis, Numerico, Pieza } from "../tipos";

/* ==========================================================================
   Palabra clave — el CTA de comentario y su efecto medido.

   Dos cosas distintas viven aca y conviene no confundirlas:

   1. El EFECTO de pedir palabra clave (`v_efecto_palabra_clave`). Se midio
      sobre dos muestras y dieron signos opuestos. Lo unico sostenible es que
      no hay penalizacion medible. La advertencia va en pantalla, no en un
      comentario del codigo.

   2. El INVENTARIO de palabras en circulacion. Cada palabra distinta exige su
      propia automatizacion en ManyChat y parte el tracking en pedazos. El
      acuerdo de estandarizar en PRIME esta registrado en context/anuncios.md
      del repo padre y nunca se cumplio: la vista lo tiene que hacer evidente.

   `src/tipos.ts` NO declara ninguno de los dos campos, asi que se leen de forma
   defensiva del payload y, si no vienen, la pantalla lo dice. Nunca se inventa
   un numero ni se rellena con cero.
   ========================================================================== */

/* --------------------------------------------------------------------------
   1. Efecto medido — lectura defensiva de `v_efecto_palabra_clave`
   -------------------------------------------------------------------------- */

interface FilaEfecto {
  pide: boolean | null;
  n: number | null;
  guardado_pct_mediana: Numerico;
  alcance_mediano: Numerico;
}

function numeroOnulo(v: unknown): Numerico {
  return typeof v === "number" && !Number.isNaN(v) ? v : null;
}

function boolOnulo(v: unknown): boolean | null {
  if (typeof v === "boolean") return v;
  if (v === "true" || v === "con" || v === "si" || v === "1") return true;
  if (v === "false" || v === "sin" || v === "no" || v === "0") return false;
  return null;
}

/** Acepta las dos convenciones de nombre que conviven en el proyecto: las de la
 *  vista de Supabase (`mediana_guardado`) y las que ya usa el panel
 *  (`guardado_pct_mediana`). Si ninguna calza, el campo queda null. */
function leerFila(bruto: unknown, pideSugerido?: boolean): FilaEfecto | null {
  if (typeof bruto !== "object" || bruto === null) return null;
  const o = bruto as Record<string, unknown>;
  const pide = boolOnulo(o.pide_palabra_clave ?? o.pide ?? pideSugerido);
  const n = numeroOnulo(o.n);
  const guardado = numeroOnulo(o.guardado_pct_mediana ?? o.mediana_guardado);
  const alcance = numeroOnulo(o.alcance_mediano ?? o.mediana_alcance);
  if (pide === null && n === null && guardado === null && alcance === null) return null;
  return { pide, n, guardado_pct_mediana: guardado, alcance_mediano: alcance };
}

const CLAVES_EFECTO = ["efecto_palabra_clave", "palabra_clave", "efecto_cta"] as const;

function leerEfecto(d: Analisis): FilaEfecto[] {
  const payload = d as unknown as Record<string, unknown>;
  for (const clave of CLAVES_EFECTO) {
    const bruto = payload[clave];
    if (Array.isArray(bruto)) {
      const filas = bruto.map((f) => leerFila(f)).filter((f): f is FilaEfecto => f !== null);
      if (filas.length) return filas;
    }
    if (typeof bruto === "object" && bruto !== null) {
      const o = bruto as Record<string, unknown>;
      if (Array.isArray(o.filas)) {
        const filas = o.filas.map((f) => leerFila(f)).filter((f): f is FilaEfecto => f !== null);
        if (filas.length) return filas;
      }
      const con = leerFila(o.con ?? o["true"], true);
      const sin = leerFila(o.sin ?? o["false"], false);
      const filas = [con, sin].filter((f): f is FilaEfecto => f !== null);
      if (filas.length) return filas;
    }
  }
  return [];
}

/* --------------------------------------------------------------------------
   2. Inventario — extraccion de la palabra desde la primera linea
   -------------------------------------------------------------------------- */

/** Verbos con los que Leo pide la palabra. En minusculas: la comparacion se
 *  hace sobre el texto pasado a minusculas, pero la palabra clave se recorta
 *  del texto ORIGINAL, porque lo que la identifica es que va en mayusculas. */
const VERBOS_CTA = [
  "comenta",
  "comentá",
  "comentame",
  "coméntame",
  "cometa",
  "escribe",
  "escribeme",
  "escríbeme",
  "escribime",
  "manda",
  "mandame",
  "mándame",
  "envia",
  "envía",
  "enviame",
  "envíame",
  "pon",
  "deja",
  "responde",
  "dime",
  "escribi",
  "escribí",
];

/** Mayusculas que aparecen en los captions pero no son palabra clave. */
const RUIDO = new Set([
  "DM",
  "IG",
  "MD",
  "PDF",
  "USD",
  "CLP",
  "ARS",
  "MXN",
  "COP",
  "PEN",
  "CODIGO",
  "CÓDIGO",
  "PALABRA",
  "CLAVE",
  "COMENTARIO",
  "COMENTARIOS",
  "LINK",
  "BIO",
  "WHATSAPP",
  "WSP",
  "AQUI",
  "AQUÍ",
  "ABAJO",
  "AHORA",
  "HOY",
  "YA",
  "NO",
  "SI",
  "SÍ",
  "EL",
  "LA",
  "LO",
  "LOS",
  "LAS",
  "UN",
  "UNA",
  "MI",
  "TU",
  "SU",
  "DE",
  "EN",
  "AL",
  "ES",
  "TE",
  "ME",
  "Y",
  "O",
  "A",
]);

const RE_VERBO = new RegExp(
  `(?:^|[^a-záéíóúüñ])(?:${[...VERBOS_CTA].sort((a, b) => b.length - a.length).join("|")})(?![a-záéíóúüñ])`
);

const RE_MAYUSCULAS = /[A-ZÁÉÍÓÚÜÑ]{2,18}/g;

/** Lo unico que puede ir entre el verbo y la palabra sin romper el CTA.
 *  "comenta la palabra CLASE" cuenta; "deja de entrenar GRATIS" no. */
const CONECTORES = new Set([
  "",
  "la",
  "el",
  "lo",
  "los",
  "las",
  "me",
  "y",
  "ya",
  "aqui",
  "aquí",
  "abajo",
  "ahora",
  "palabra",
  "clave",
  "mi",
  "tu",
  "con",
  "en",
  "por",
  "solo",
  "solamente",
  "solo la",
]);

/** Devuelve la palabra clave que pide la pieza, o null si no pide ninguna.
 *
 *  Criterio: un token en MAYUSCULAS que aparece DESPUES de un verbo de CTA
 *  ("comenta PRIME", "escribe la palabra ONLINE") y separado de el solo por
 *  conectores. Sin verbo de CTA no se adivina: preferimos declarar "sin palabra
 *  clave detectada" antes que inflar el inventario con falsos positivos. */
function palabraClaveDe(texto: string | null | undefined): string | null {
  const t = (texto ?? "").trim();
  if (!t) return null;
  const bajo = t.toLowerCase();

  // Palabra completa: "pon" no puede salir de "ponte a pensar".
  const verbo = RE_VERBO.exec(bajo);
  if (!verbo) return null;
  const desde = verbo.index + verbo[0].length;

  RE_MAYUSCULAS.lastIndex = 0;
  for (let m = RE_MAYUSCULAS.exec(t); m !== null; m = RE_MAYUSCULAS.exec(t)) {
    if (m.index < desde) continue;
    const palabra = m[0];
    if (RUIDO.has(palabra)) {
      // "comenta CODIGO PRIME": el ruido no descarta la frase, se sigue mirando.
      continue;
    }
    const medio = t
      .slice(desde, m.index)
      .toLowerCase()
      .replace(/[^a-záéíóúüñ\s]/g, " ")
      .trim()
      .replace(/\s+/g, " ");
    // Cada token intermedio tiene que ser conector o ruido ya descartado.
    const limpio = medio
      .split(" ")
      .filter((w) => w && !CONECTORES.has(w) && !RUIDO.has(w.toUpperCase()))
      .length === 0;
    if (!limpio) return null;
    return palabra;
  }
  return null;
}

interface FilaInventario {
  palabra: string;
  n: number;
  guardado_pct_mediana: Numerico;
  alcance_mediano: Numerico;
}

type Origen = "campo" | "derivado";

/** Prefiere el campo por pieza si algun dia la API lo expone; si no, lo deriva
 *  del texto. El origen se declara en pantalla con `Base`. */
function palabraDePieza(p: Pieza): { palabra: string | null; origen: Origen } {
  const bruto = (p as unknown as Record<string, unknown>).palabra_clave;
  if (typeof bruto === "string" && bruto.trim()) {
    return { palabra: bruto.trim().toUpperCase(), origen: "campo" };
  }
  return { palabra: palabraClaveDe(p.primera_linea), origen: "derivado" };
}

function construirInventario(piezas: Pieza[]): {
  filas: FilaInventario[];
  conCta: Pieza[];
  sinCta: Pieza[];
  origen: Origen;
} {
  const grupos = new Map<string, Pieza[]>();
  const conCta: Pieza[] = [];
  const sinCta: Pieza[] = [];
  let origen: Origen = "derivado";

  for (const p of piezas) {
    const r = palabraDePieza(p);
    if (r.origen === "campo") origen = "campo";
    if (!r.palabra) {
      sinCta.push(p);
      continue;
    }
    conCta.push(p);
    const actual = grupos.get(r.palabra);
    if (actual) actual.push(p);
    else grupos.set(r.palabra, [p]);
  }

  const filas: FilaInventario[] = [...grupos.entries()]
    .map(([palabra, ps]) => ({
      palabra,
      n: ps.length,
      guardado_pct_mediana: medianaDe(ps.map((p) => p.guardado_pct)),
      alcance_mediano: medianaDe(ps.map((p) => p.alcance)),
    }))
    .sort((a, b) => b.n - a.n || a.palabra.localeCompare(b.palabra, "es"));

  return { filas, conCta, sinCta, origen };
}

/* --------------------------------------------------------------------------
   3. Vista
   -------------------------------------------------------------------------- */

/** Igual que `Kpi`, pero el valor es una palabra y no un numero: baja el cuerpo
 *  y deja que corte, para que "ENTRENADOR" no se salga de la tarjeta a 375px. */
function KpiTexto({
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
      <div
        className="kpi-val"
        style={{ fontSize: 22, overflowWrap: "anywhere", letterSpacing: "0.01em" }}
      >
        {valor}
      </div>
      {pie ? <div className="kpi-pie">{pie}</div> : null}
    </div>
  );
}

export function PalabraClave({ d }: { d: Analisis }) {
  const piezas = d.rankings.todas;
  const efecto = useMemo(() => leerEfecto(d), [d]);
  const inv = useMemo(() => construirInventario(piezas), [piezas]);

  const distintas = inv.filas.length;
  const top = inv.filas[0] ?? null;
  const cuota = top && inv.conCta.length ? (top.n / inv.conCta.length) * 100 : null;
  const mayor = inv.filas.reduce((m, f) => Math.max(m, f.n), 0);

  return (
    <div className="lista" style={{ gap: "var(--e5)" }}>
      <div className="kpis">
        <Kpi
          etiqueta="Palabras distintas"
          valor={distintas ? num(distintas) : NADA}
          pie={distintas ? `${num(distintas)} automatizaciones en ManyChat` : "ninguna detectada"}
          icono="comentario"
        />
        <Kpi
          etiqueta="Piezas que piden palabra"
          valor={inv.conCta.length ? num(inv.conCta.length) : NADA}
          pie={`de ${num(piezas.length)} piezas sobre el piso`}
          icono="piezas"
        />
        <KpiTexto
          etiqueta="Palabra mas usada"
          valor={top ? top.palabra : NADA}
          pie={top ? `${num(top.n)} piezas · ${pct(cuota)} de las que piden` : "sin muestra"}
          icono="guardado"
        />
        <Kpi
          etiqueta="Efecto sobre el alcance"
          valor={efecto.length ? "Sin senal" : NADA}
          pie={efecto.length ? "dos muestras, signos opuestos" : "la API no devolvio el corte"}
          icono="alcance"
        />
      </div>

      <Nota>
        <b>Cuidado con leer esto como una palanca de alcance.</b> Se midio sobre dos muestras distintas y{" "}
        <b>dieron signos opuestos</b>: en una, pedir palabra clave se asocio a menos alcance; en la otra, a
        mas. Lo unico sostenible es que <b>no hay penalizacion medible</b>. Afirmar que el CTA sube el alcance
        seria leer ruido como senal.
      </Nota>

      <section>
        <h2 style={{ fontSize: 18, marginBottom: "var(--e3)" }}>Efecto medido del CTA</h2>
        {efecto.length === 0 ? (
          <>
            <SinDatosSeccion
              titulo="Sin el corte de efecto en esta respuesta"
              porque="El objeto que devuelve /api/analisis no trae el campo de v_efecto_palabra_clave, asi que no hay medianas que mostrar. No se rellena con ceros: la vista existe pero el dato todavia no viaja por la API."
            />
            <Base>
              La vista <code>v_efecto_palabra_clave</code> existe en Supabase con 2 filas (una por valor de{" "}
              <code>pide_palabra_clave</code>). Falta mapearla dentro de <code>GET /api/analisis</code>. El
              contrato de <code>src/tipos.ts</code> no la declara todavia.
            </Base>
          </>
        ) : (
          <>
            <div className="tabla-caja">
              <table>
                <thead>
                  <tr>
                    <th>Corte</th>
                    <th className="n">Piezas</th>
                    <th className="n">Guardado (mediana)</th>
                    <th className="n">Alcance (mediana)</th>
                  </tr>
                </thead>
                <tbody>
                  {efecto.map((f, i) => (
                    <tr key={`${String(f.pide)}-${i}`}>
                      <td>
                        {f.pide === null ? NADA : f.pide ? "Pide palabra clave" : "No pide palabra clave"}
                      </td>
                      <td className="n">{num(f.n)}</td>
                      <td className="n">{pct(f.guardado_pct_mediana, 2)}</td>
                      <td className="n">{compacto(f.alcance_mediano)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Base>
              Medianas, no promedios, sobre las piezas que superan el piso de {num(d.piso_alcance)} de alcance.
              Es un corte observacional: las piezas no se asignaron al azar a pedir o no pedir palabra, asi que
              la diferencia entre filas no es un efecto causal. Snapshot <code>{d.snapshot}</code>.
            </Base>
          </>
        )}
      </section>

      <section>
        <h2 style={{ fontSize: 18, marginBottom: "var(--e3)" }}>Palabras en circulacion</h2>
        {inv.filas.length === 0 ? (
          <SinDatosSeccion
            titulo="Ninguna palabra clave detectada"
            porque="No hay campo de palabra clave por pieza en la respuesta y tampoco se encontro un CTA de comentario en la primera linea de ninguna pieza. Sin una de las dos cosas, el inventario no se puede armar."
          />
        ) : (
          <>
            <div className="tabla-caja">
              <table>
                <thead>
                  <tr>
                    <th>Palabra</th>
                    <th className="n">Piezas</th>
                    <th>Peso</th>
                    <th className="n">Guardado (mediana)</th>
                    <th className="n">Alcance (mediana)</th>
                  </tr>
                </thead>
                <tbody>
                  {inv.filas.map((f) => (
                    <tr key={f.palabra}>
                      <td>
                        <span className="num" style={{ letterSpacing: "0.04em" }}>
                          {f.palabra}
                        </span>{" "}
                        {f.palabra === "PRIME" ? <Badge tono="oro">acordada</Badge> : null}
                      </td>
                      <td className="n">{num(f.n)}</td>
                      <td style={{ minWidth: 96 }}>
                        <div className="barra" role="img" aria-label={`${f.n} piezas`}>
                          <span
                            style={{
                              width: `${mayor ? (f.n / mayor) * 100 : 0}%`,
                              background:
                                f.palabra === "PRIME"
                                  ? "linear-gradient(90deg, var(--prime-bronze), var(--prime-gold))"
                                  : "var(--linea-fuerte)",
                            }}
                          />
                        </div>
                      </td>
                      <td className="n">{pct(f.guardado_pct_mediana, 2)}</td>
                      <td className="n">{compacto(f.alcance_mediano)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Base>
              {inv.origen === "campo" ? (
                <>
                  Agrupado por el campo de palabra clave que entrega la API para cada pieza.
                </>
              ) : (
                <>
                  <b>Limitacion:</b> el objeto <code>Analisis</code> no trae la palabra clave por pieza, asi
                  que este inventario esta <b>derivado del texto</b>: se busca un verbo de CTA (comenta,
                  escribe, manda…) en la primera linea y se toma el token en MAYUSCULAS que viene despues. Las
                  piezas cuyo CTA vive mas abajo del caption, o escrito en minusculas, no entran. El conteo es
                  un piso, no un censo.
                </>
              )}{" "}
              Base: {num(inv.conCta.length)} piezas con palabra detectada y {num(inv.sinCta.length)} sin ella,
              de {num(piezas.length)} sobre el piso de {num(d.piso_alcance)} de alcance. Las medianas de cada
              fila se calculan solo con las piezas de esa palabra: con {num(mayor)} piezas en la mas usada, son
              medianas de muestra chica y no se deben leer como ranking de rendimiento.
            </Base>
          </>
        )}
      </section>

      <Nota>
        <b>Fragmentacion: {distintas ? num(distintas) : NADA} palabras distintas en circulacion.</b> En el
        kickoff se acordo estandarizar todo en <b>PRIME</b> y no se cumplio. Cada palabra exige su propia
        automatizacion en ManyChat, y cada automatizacion es un lugar mas donde el lead se cae y un pedazo mas
        de tracking partido: con el origen repartido, ninguna palabra acumula la muestra necesaria para saber
        cual anuncio trajo la venta. Consolidar en una sola no mejora el contenido — arregla la medicion.
      </Nota>
    </div>
  );
}
