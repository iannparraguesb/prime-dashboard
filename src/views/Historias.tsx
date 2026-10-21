import { useMemo, useState } from "react";
import { SinDatosSeccion, Sincronizando } from "../components/states";
import { Base, Nota, compacto, horaCorta, num, pct, NADA } from "../components/ui";
import { GraficoBarras } from "../components/GraficoBarras";
import { Icono } from "../components/icons";
import { armarSecuencias, resumirSecuencias, CORTE_SECUENCIA_MIN } from "../lib/secuencias";
import type { Analisis } from "../tipos";

const COLOR_ALCANCE = "#c67c0e";
/** Con meses de captura hay decenas de tandas: los chips muestran las mas recientes. */
const CHIPS_MAX = 14;

/** Caida positiva = se fue gente. Negativa = el slide sumo alcance. */
function caidaTexto(v: number | null): string {
  if (v === null) return NADA;
  return v >= 0 ? `−${pct(v, 1)}` : `+${pct(-v, 1)}`;
}

export function Historias({ d }: { d: Analisis }) {
  const h = d.historias;
  const secuencias = useMemo(() => armarSecuencias(h.filas, new Date()), [h.filas]);
  const resumen = useMemo(() => resumirSecuencias(secuencias), [secuencias]);
  const [elegida, setElegida] = useState<string | null>(null);

  if (d.estado_sincronizacion === "en_proceso" && !h.filas.length) {
    return <Sincronizando detalle="Las historias aparecen después: se capturan mientras siguen activas en Instagram." />;
  }

  if (h.error) {
    return (
      <>
        <SinDatosSeccion
          titulo="La API no devolvio historias"
          porque={`${h.error} Esto no es lo mismo que "no hay historias": es que la llamada fallo. Revisa que el token siga vivo y tenga instagram_manage_insights.`}
        />
        <Nota>{h.nota}</Nota>
      </>
    );
  }

  if (!h.filas.length) {
    return (
      <>
        <SinDatosSeccion
          titulo="Todavía no hay historias registradas"
          porque="No hay historias guardadas en este dashboard. Esto no confirma que no hayas publicado: revisa con el equipo si la captura está activa."
        />
        <Nota>
          {h.nota} Las historias necesitan una captura periódica mientras siguen disponibles en Instagram.
        </Nota>
      </>
    );
  }

  const conAlcance = h.filas.filter((f) => f.alcance !== null);
  const faltantes = h.filas.filter((f) => f.metricas_faltantes.length).length;
  const tiempo = (hora: string | null) => hora ? Date.parse(hora) : 0;
  const ultima = [...h.filas].sort((a, b) => tiempo(b.hora) - tiempo(a.hora))[0] ?? null;
  const mejor = [...conAlcance].sort(
    (a, b) => (b.visita_perfil_pct ?? -1) - (a.visita_perfil_pct ?? -1)
  )[0];
  // Por defecto, la ultima secuencia que ya termino de sumar alcance: la que
  // sigue en curso todavia no tiene su curva definitiva.
  const actual = secuencias.find((s) => s.id === elegida)
    ?? secuencias.find((s) => !s.en_curso && s.slides.length > 1)
    ?? secuencias[0]
    ?? null;

  return (
    <div className="lista" style={{ gap: "var(--e5)" }}>
      <div className="kpis">
        <div className="card kpi">
          <div className="kpi-lbl">
            <Icono nombre="historias" size={13} /> Historias activas
          </div>
          <div className="kpi-val num">{num(h.activas)}</div>
          <div className="kpi-pie">ultimas 24 horas</div>
        </div>
        <div className="card kpi">
          <div className="kpi-lbl">
            <Icono nombre="alcance" size={13} /> Retención por secuencia
          </div>
          <div className="kpi-val num">{pct(resumen.retencion_mediana, 1)}</div>
          <div className="kpi-pie">mediana de {num(resumen.cerradas)} secuencias · último slide sobre el primero</div>
        </div>
        <div className="card kpi">
          <div className="kpi-lbl">
            <Icono nombre="alcance" size={13} /> Caída del 1° al 2°
          </div>
          <div className="kpi-val num">{caidaTexto(resumen.caida_primera_mediana)}</div>
          <div className="kpi-pie">mediana: lo que pierde la secuencia en el primer salto</div>
        </div>
        <div className="card kpi">
          <div className="kpi-lbl">
            <Icono nombre="perfil" size={13} /> Mejor salto al perfil
          </div>
          <div className="kpi-val num">{pct(mejor?.visita_perfil_pct ?? null, 2)}</div>
          <div className="kpi-pie">{mejor ? horaCorta(mejor.hora) : "sin dato"}</div>
        </div>
      </div>

      {actual ? (
        <section>
          <h2 className="sec-titulo">Curva de abandono por secuencia</h2>
          <div className="chips" role="group" aria-label="Secuencias" style={{ marginBottom: "var(--e3)" }}>
            {secuencias.slice(0, CHIPS_MAX).map((s) => (
              <button key={s.id} className="chip" aria-pressed={s.id === actual.id} onClick={() => setElegida(s.id)}>
                {horaCorta(s.inicio)}
                <span className="chip-n">{s.slides.length}</span>
              </button>
            ))}
          </div>

          <div className="card" style={{ padding: "var(--e4)" }}>
            <GraficoBarras
              etiquetas={actual.slides.map((s) => `${s.posicion}`)}
              series={[{ nombre: "Alcance", color: COLOR_ALCANCE, valores: actual.slides.map((s) => s.historia.alcance) }]}
              formato={(v) => compacto(v)}
              detalle={(i) => (
                <>
                  <div>Retención <span>{pct(actual.slides[i].retencion, 1)}</span></div>
                  <div>Contra el anterior <span>{caidaTexto(actual.slides[i].caida)}</span></div>
                  <div>Respuestas <span>{compacto(actual.slides[i].historia.respuestas)}</span></div>
                </>
              )}
              alto={200}
            />
          </div>

          <div className="tabla-caja" style={{ marginTop: "var(--e3)" }}>
            <table>
              <thead>
                <tr>
                  <th>Slide</th>
                  <th>Publicada</th>
                  <th className="n">Alcance</th>
                  <th className="n">Retención</th>
                  <th className="n">Contra el anterior</th>
                  <th className="n">Respuestas</th>
                  <th className="n">% al perfil</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {actual.slides.map((s) => (
                  <tr key={s.historia.id}>
                    <td>{s.posicion}{actual.mayor_caida?.posicion === s.posicion ? " · mayor caída" : ""}</td>
                    <td>{horaCorta(s.historia.hora)}</td>
                    <td className="n">{compacto(s.historia.alcance)}</td>
                    <td className="n">{pct(s.retencion, 1)}</td>
                    <td className="n">{caidaTexto(s.caida)}</td>
                    <td className="n">{compacto(s.historia.respuestas)}</td>
                    <td className="n">{pct(s.historia.visita_perfil_pct, 2)}</td>
                    <td>
                      {s.historia.permalink ? (
                        <a href={s.historia.permalink} target="_blank" rel="noreferrer">
                          Ver <Icono nombre="externo" size={11} />
                        </a>
                      ) : (
                        NADA
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <Base>
            Una secuencia son historias publicadas con menos de {CORTE_SECUENCIA_MIN} minutos entre una y otra. La
            retención es el alcance de cada slide sobre el del primero; la mayor caída marca dónde se fue más gente
            antes de llegar al final.{" "}
            {actual.en_curso
              ? "Esta secuencia tiene historias de menos de 24 horas: su alcance todavía sube y la curva no es definitiva."
              : ""}
          </Base>
        </section>
      ) : null}

      <h2 className="sec-titulo">Todas las historias</h2>
      <div className="tabla-caja">
        <table>
          <thead>
            <tr>
              <th>Publicada</th>
              <th>Formato</th>
              <th className="n">Alcance</th>
              <th className="n">Visitas al perfil</th>
              <th className="n">% al perfil</th>
              <th className="n">Respuestas</th>
              <th className="n">Seguidores</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {h.filas.map((f) => (
              <tr key={f.id}>
                <td>{horaCorta(f.hora)}</td>
                <td>{f.formato === "VIDEO" ? "Video" : "Imagen"}</td>
                <td className="n">{compacto(f.alcance)}</td>
                <td className="n">{compacto(f.visitas_perfil)}</td>
                <td className="n">{pct(f.visita_perfil_pct, 2)}</td>
                <td className="n">{compacto(f.respuestas)}</td>
                <td className="n">{compacto(f.seguidores_ganados)}</td>
                <td>
                  {f.permalink ? (
                    <a href={f.permalink} target="_blank" rel="noreferrer">
                      Ver <Icono nombre="externo" size={11} />
                    </a>
                  ) : (
                    NADA
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Base>
        Ordenadas de la mas reciente a la mas antigua. Última captura observada: <b>{horaCorta(ultima?.hora)}</b>. El % al perfil es visitas al perfil sobre alcance: es la
        metrica que dice si la historia empujo a alguien a dar el siguiente paso.{" "}
        {faltantes > 0
          ? `${faltantes} historias con metricas que la API no devolvio; aparecen como guion, no como cero.`
          : ""}
      </Base>

      <Nota>{h.nota}</Nota>
    </div>
  );
}
