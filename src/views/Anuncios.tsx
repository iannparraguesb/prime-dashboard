import { useMemo, useState } from "react";
import { SinDatosSeccion } from "../components/states";
import { Base, Nota, Badge, num, pct, compacto, NADA } from "../components/ui";
import { Icono } from "../components/icons";
import type { Analisis, FilaAnuncio } from "../tipos";

type Modo = "tarjetas" | "eficiencia" | "tabla";
type Orden = "gasto" | "conversaciones" | "costo_por_conversacion" | "ctr" | "retencion_video";
type Filtro = "todos" | "ACTIVE" | "pausados";

const ORDENES: { v: Orden; t: string }[] = [
  { v: "costo_por_conversacion", t: "Costo por conversación (menor primero)" },
  { v: "conversaciones", t: "Conversaciones" },
  { v: "gasto", t: "Gasto" },
  { v: "ctr", t: "CTR" },
  { v: "retencion_video", t: "Retención de video" },
];

/** El dinero lleva su moneda pegada, siempre. La cuenta factura en CLP y el
 *  ticket del programa es en USD: un monto sin moneda invita a compararlos. */
function money(v: number | null, moneda: string | null): string {
  if (v === null) return NADA;
  return `${v.toLocaleString("es-CL", { maximumFractionDigits: 0 })} ${moneda ?? ""}`.trim();
}

export function Anuncios({ d }: { d: Analisis }) {
  const datos = d.anuncios;
  const [orden, setOrden] = useState<Orden>("costo_por_conversacion");
  const [filtro, setFiltro] = useState<Filtro>("todos");
  const [modo, setModo] = useState<Modo>("tarjetas");

  const filas = useMemo(() => {
    const base = (datos?.filas ?? []).filter((a) =>
      filtro === "todos" ? true : filtro === "ACTIVE" ? a.estado === "ACTIVE" : a.estado !== "ACTIVE"
    );
    const menorMejor = orden === "costo_por_conversacion";
    return [...base].sort((a, b) => {
      const va = a[orden];
      const vb = b[orden];
      // Los null van al final en los dos sentidos: un costo indefinido no es
      // el mejor costo, aunque ordenando de menor a mayor lo parezca.
      if (va === null && vb === null) return 0;
      if (va === null) return 1;
      if (vb === null) return -1;
      return menorMejor ? va - vb : vb - va;
    });
  }, [datos, orden, filtro]);

  const monedas = useMemo(() => {
    const salida: Record<string, { gasto: number; conversaciones: number; anuncios: number }> = {};
    for (const a of datos?.filas ?? []) {
      const moneda = a.moneda ?? "Sin moneda";
      const grupo = salida[moneda] ??= { gasto: 0, conversaciones: 0, anuncios: 0 };
      grupo.gasto += a.gasto ?? 0;
      grupo.conversaciones += a.conversaciones ?? 0;
      grupo.anuncios += 1;
    }
    return salida;
  }, [datos]);

  if (!datos || !datos.filas.length) {
    return (
      <SinDatosSeccion
        titulo="Sin anuncios cargados"
        porque="Corre `python3 tools/meta_a_supabase.py` para traer los anuncios de Meta y sus métricas."
      />
    );
  }

  const moneda = datos.monedas.length === 1 ? datos.monedas[0] : null;
  const activos = datos.filas.filter((a) => a.estado === "ACTIVE");
  const conConv = datos.filas.filter((a) => (a.conversaciones ?? 0) > 0);
  const totales = Object.entries(monedas);
  const grupoPrincipal = totales.length === 1 ? totales[0] : null;
  const gasto = grupoPrincipal?.[1].gasto ?? 0;
  const conv = grupoPrincipal?.[1].conversaciones ?? 0;
  const dark = datos.filas.filter((a) => a.es_dark_post === true).length;

  const cuenta = (f: Filtro) =>
    (datos.filas ?? []).filter((a) =>
      f === "todos" ? true : f === "ACTIVE" ? a.estado === "ACTIVE" : a.estado !== "ACTIVE"
    ).length;

  return (
    <div className="lista" style={{ gap: "var(--e5)" }}>
      <div className="kpis">
        <div className="card kpi">
          <div className="kpi-lbl"><Icono nombre="alcance" size={13} /> Gasto total</div>
          <div className="kpi-val num">{grupoPrincipal ? money(gasto, moneda) : NADA}</div>
          <div className="kpi-pie">{grupoPrincipal ? "histórico completo" : "varias monedas: ver desglose"}</div>
        </div>
        <div className="card kpi">
          <div className="kpi-lbl"><Icono nombre="comentario" size={13} /> Conversaciones</div>
          <div className="kpi-val num">{grupoPrincipal ? num(conv) : NADA}</div>
          <div className="kpi-pie">{grupoPrincipal ? `en ${num(conConv.length)} de ${num(datos.filas.length)} anuncios` : "no se suman entre monedas"}</div>
        </div>
        <div className="card kpi">
          <div className="kpi-lbl"><Icono nombre="guardado" size={13} /> Costo por conversación</div>
          <div className="kpi-val num">{grupoPrincipal && conv ? money(Math.round(gasto / conv), moneda) : NADA}</div>
          <div className="kpi-pie">{grupoPrincipal ? "gasto total sobre conversaciones totales" : "se calcula por moneda"}</div>
        </div>
        <div className="card kpi">
          <div className="kpi-lbl"><Icono nombre="piezas" size={13} /> Anuncios activos</div>
          <div className="kpi-val num">{num(activos.length)}</div>
          <div className="kpi-pie">de {num(datos.filas.length)} en la cuenta</div>
        </div>
      </div>

      <Nota>{datos.nota}</Nota>

      {totales.length > 1 ? (
        <section>
          <h2 style={{ fontSize: 18, marginBottom: "var(--e3)" }}>Totales por moneda</h2>
          <div className="kpis">
            {totales.map(([codigo, total]) => (
              <div className="card kpi" key={codigo}>
                <div className="kpi-lbl">{codigo}</div>
                <div className="kpi-val num">{money(total.gasto, codigo)}</div>
                <div className="kpi-pie">{num(total.conversaciones)} conversaciones · {num(total.anuncios)} anuncios · {total.conversaciones ? money(Math.round(total.gasto / total.conversaciones), codigo) : NADA} / conversación</div>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {dark > 0 ? (
        <Nota>
          <b>{num(dark)} de {num(datos.filas.length)} anuncios son dark posts</b> — creativos que
          existen solo como anuncio y nunca aparecieron en el feed. Se verificó cruzando los
          permalinks de los creativos contra las publicaciones orgánicas: cero coincidencias.
          Consecuencia buena: <b>la pauta no contamina las medianas del contenido orgánico</b>,
          porque son universos separados.
        </Nota>
      ) : null}

      <section>
        <h2 style={{ fontSize: 18, marginBottom: "var(--e3)" }}>Por campaña</h2>
        <div className="tabla-caja">
          <table>
            <thead>
              <tr>
                <th>Campaña</th>
                <th className="n">Anuncios</th>
                <th className="n">Activos</th>
                <th className="n">Gasto</th>
                <th className="n">Conversaciones</th>
                <th className="n">Costo/conv.</th>
                <th className="n">CTR mediano</th>
              </tr>
            </thead>
            <tbody>
              {[...datos.campanas]
                .sort((a, b) => (b.gasto ?? 0) - (a.gasto ?? 0))
                .map((c) => (
                  <tr key={`${c.campana}-${c.moneda}`}>
                    <td style={{ whiteSpace: "normal", minWidth: 240 }}>{c.campana ?? NADA}</td>
                    <td className="n">{num(c.anuncios)}</td>
                    <td className="n">{num(c.activos)}</td>
                    <td className="n">{money(c.gasto, c.moneda)}</td>
                    <td className="n">{num(c.conversaciones)}</td>
                    <td className="n">{money(c.costo_por_conversacion, c.moneda)}</td>
                    <td className="n">{pct(c.ctr_mediano, 2)}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
        <Base>
          Agrupado <b>por campaña y por moneda</b>. Ningún total suma entre monedas: sumar CLP con
          USD produce un número que parece creíble y está mal. El CTR es mediana, no promedio.
        </Base>
      </section>

      <section>
        <div className="card filtros">
          <div className="filtro-grupo">
            <span className="filtro-lbl">Estado</span>
            <div className="chips">
              {([["todos", "Todos"], ["ACTIVE", "Activos"], ["pausados", "Pausados"]] as [Filtro, string][]).map(
                ([v, t]) => (
                  <button key={v} className="chip" aria-pressed={filtro === v} onClick={() => setFiltro(v)}>
                    {t}<span className="chip-n">{cuenta(v)}</span>
                  </button>
                )
              )}
            </div>
          </div>
          <div className="filtro-grupo">
            <span className="filtro-lbl">Vista</span>
            <div className="chips">
              {([["tarjetas", "Tarjetas"], ["eficiencia", "Eficiencia"], ["tabla", "Tabla"]] as [Modo, string][]).map(
                ([v, t]) => (
                  <button key={v} className="chip" aria-pressed={modo === v} onClick={() => setModo(v)}>
                    {t}
                  </button>
                )
              )}
            </div>
          </div>
          <div className="filtro-grupo">
            <span className="filtro-lbl">Ordenar por</span>
            <select className="control" value={orden} onChange={(e) => setOrden(e.target.value as Orden)}>
              {ORDENES.map((o) => <option key={o.v} value={o.v}>{o.t}</option>)}
            </select>
          </div>
        </div>

        {modo === "tarjetas" ? (
          <div className="ads-grilla">
            {filas.map((a, i) => {
              const gastoMoneda = monedas[a.moneda ?? "Sin moneda"]?.gasto ?? 0;
              const parte = gastoMoneda > 0 ? ((a.gasto ?? 0) / gastoMoneda) * 100 : 0;
              const activo = a.estado === "ACTIVE";
              return (
                <article className="ads-card" key={a.id} data-activo={activo || undefined}>
                  <div className="ads-card-top">
                    <span className="ads-rango">{i + 1}</span>
                    {activo ? <Badge tono="oro">Activo</Badge> : <Badge>{a.estado ?? NADA}</Badge>}
                  </div>
                  <h3 className="ads-nombre">{a.nombre ?? NADA}</h3>
                  <div className="ads-conjunto">{a.conjunto ?? ""}</div>

                  {/* El numero grande es el costo por conversacion: es la metrica
                      con la que se decide apagar o escalar un anuncio. */}
                  <div className="ads-grande">
                    {a.costo_por_conversacion === null ? (
                      <span className="ads-sin">{NADA}</span>
                    ) : (
                      money(a.costo_por_conversacion, a.moneda)
                    )}
                    <small>
                      {a.costo_por_conversacion === null
                        ? "sin conversaciones: costo indefinido"
                        : "por conversación"}
                    </small>
                  </div>

                  <div className="ads-mets">
                    <span><Icono nombre="comentario" size={12} /> {num(a.conversaciones)} conv.</span>
                    <span><Icono nombre="alcance" size={12} /> {compacto(a.alcance)} alcance</span>
                    <span><Icono nombre="like" size={12} /> {pct(a.ctr, 2)} CTR</span>
                    <span><Icono nombre="vista" size={12} /> {pct(a.retencion_video, 0)} ret.</span>
                  </div>

                  {/* Cuota del gasto: hace visible donde se esta yendo el dinero. */}
                  <div className="ads-gasto">
                    <div className="barra">
                      <span style={{ width: `${Math.min(parte, 100)}%`,
                        background: "linear-gradient(90deg, var(--prime-bronze), var(--prime-gold-bright))" }} />
                    </div>
                    <span>{money(a.gasto, a.moneda)} · {pct(parte, 1)} del gasto</span>
                  </div>
                </article>
              );
            })}
          </div>
        ) : modo === "eficiencia" ? (
          <div className="card" style={{ padding: "var(--e4)" }}>
            {/* Barras horizontales: el largo es el costo por conversacion y el
                grosor de la etiqueta el volumen. Un costo bajo con 1 sola
                conversacion no es una victoria, y verlo al lado lo evita. */}
            {(() => {
              const conCosto = filas.filter((a) => a.costo_por_conversacion !== null);
              const maxCosto = Math.max(...conCosto.map((a) => a.costo_por_conversacion ?? 0), 1);
              const sinCosto = filas.length - conCosto.length;
              return (
                <>
                  {conCosto.map((a) => (
                    <div className="ads-fila" key={a.id}>
                      <div className="ads-fila-nombre" title={a.nombre ?? ""}>
                        {a.nombre ?? NADA}
                        <em>{num(a.conversaciones)} conv.</em>
                      </div>
                      <div className="ads-fila-barra">
                        <span
                          style={{ width: `${((a.costo_por_conversacion ?? 0) / maxCosto) * 100}%` }}
                          data-pocas={(a.conversaciones ?? 0) < 10 || undefined}
                        />
                      </div>
                      <div className="ads-fila-valor">{money(a.costo_por_conversacion, a.moneda)}</div>
                    </div>
                  ))}
                  {sinCosto > 0 ? (
                    <Base>
                      {num(sinCosto)} anuncios no aparecen: no generaron ninguna conversación, así que
                      su costo por conversación es indefinido, no cero. Se ven en Tarjetas y en Tabla.
                    </Base>
                  ) : null}
                  <Base>
                    Las barras rayadas tienen <b>menos de 10 conversaciones</b>: el costo puede verse
                    excelente y ser ruido. Un anuncio con 1 conversación a 200 CLP no es mejor que uno
                    con 293 a 332.
                  </Base>
                </>
              );
            })()}
          </div>
        ) : (
        <div className="tabla-caja">
          <table>
            <thead>
              <tr>
                <th>Anuncio</th>                <th></th>
                <th className="n">Gasto</th>
                <th className="n">Conv.</th>
                <th className="n">Costo/conv.</th>
                <th className="n">CTR</th>
                <th className="n">Ret. video</th>
                <th className="n">Alcance</th>
                <th className="n">Frec.</th>
              </tr>
            </thead>
            <tbody>
              {filas.map((a: FilaAnuncio) => (
                <tr key={a.id}>
                  <td style={{ whiteSpace: "normal", minWidth: 200, maxWidth: 320 }}>
                    {a.nombre ?? NADA}
                    <div style={{ fontSize: 11, color: "var(--texto-3)" }}>{a.conjunto ?? ""}</div>
                  </td>
                  <td>
                    {a.estado === "ACTIVE" ? <Badge tono="oro">Activo</Badge> : <Badge>{a.estado ?? NADA}</Badge>}
                  </td>
                  <td className="n">{money(a.gasto, a.moneda)}</td>
                  <td className="n">{num(a.conversaciones)}</td>
                  <td className="n">{money(a.costo_por_conversacion, a.moneda)}</td>
                  <td className="n">{pct(a.ctr, 2)}</td>
                  <td className="n">{pct(a.retencion_video, 1)}</td>
                  <td className="n">{compacto(a.alcance)}</td>
                  <td className="n">{a.frecuencia === null ? NADA : a.frecuencia.toFixed(1)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        )}

        <Base>
          {num(filas.length)} anuncios. <b>Un costo por conversación en guion no es cero</b>: es que
          ese anuncio no generó ninguna, y el costo queda indefinido. Por eso los guiones van al final
          incluso ordenando de menor a mayor. Retención de video = quienes llegaron al 100% sobre
          quienes pasaron el 25%.
        </Base>
      </section>
    </div>
  );
}
