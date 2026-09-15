import { SinDatosSeccion } from "../components/states";
import { Base, Nota, compacto, horaCorta, num, pct, NADA } from "../components/ui";
import { Icono } from "../components/icons";
import type { Analisis } from "../tipos";

export function Historias({ d }: { d: Analisis }) {
  const h = d.historias;

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
  const primera = [...h.filas].sort((a, b) => tiempo(a.hora) - tiempo(b.hora))[0] ?? null;
  const ultima = [...h.filas].sort((a, b) => tiempo(b.hora) - tiempo(a.hora))[0] ?? null;
  const retencion = primera?.alcance && ultima?.alcance != null
    ? (ultima.alcance / primera.alcance) * 100
    : null;
  const mejor = [...conAlcance].sort(
    (a, b) => (b.visita_perfil_pct ?? -1) - (a.visita_perfil_pct ?? -1)
  )[0];

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
            <Icono nombre="alcance" size={13} /> Retención observada
          </div>
          <div className="kpi-val num">{pct(retencion, 1)}</div>
          <div className="kpi-pie">alcance de la última sobre la primera capturada</div>
        </div>
        <div className="card kpi">
          <div className="kpi-lbl">
            <Icono nombre="perfil" size={13} /> Mejor salto al perfil
          </div>
          <div className="kpi-val num">{pct(mejor?.visita_perfil_pct ?? null, 2)}</div>
          <div className="kpi-pie">{mejor ? horaCorta(mejor.hora) : "sin dato"}</div>
        </div>
      </div>

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
