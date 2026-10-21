import { SinDatosSeccion } from "../components/states";
import { Base, Kpi, Nota, num, pct } from "../components/ui";
import type { Analisis } from "../tipos";

function Distribucion({
  titulo,
  datos,
  limite = 10,
  nota,
}: {
  titulo: string;
  datos: Record<string, number>;
  limite?: number;
  nota: string;
}) {
  const filas = Object.entries(datos ?? {})
    .filter(([, v]) => typeof v === "number")
    .sort((a, b) => b[1] - a[1]);
  const total = filas.reduce((s, [, v]) => s + v, 0);

  if (!filas.length) {
    return (
      <section>
        <h2 style={{ fontSize: 18, marginBottom: "var(--e3)" }}>{titulo}</h2>
        <SinDatosSeccion
          titulo="Sin datos para este corte"
          porque="Instagram no entregó este desglose. Suele pasar cuando la cuenta no llega a 100 seguidores en esa dimensión, cuando la cuenta se conectó hace poco y aún no hay datos, o cuando el permiso de estadísticas ya no está vigente."
        />
      </section>
    );
  }

  return (
    <section>
      <h2 style={{ fontSize: 18, marginBottom: "var(--e3)" }}>{titulo}</h2>
      <div className="card" style={{ padding: "var(--e4)" }}>
        {filas.slice(0, limite).map(([clave, valor]) => (
          <div key={clave} style={{ marginBottom: "var(--e3)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, marginBottom: 4 }}>
              <span>{clave.replace(/\|/g, " · ")}</span>
              <b className="num">
                {num(valor)} <span style={{ color: "var(--texto-3)", fontWeight: 400 }}>
                  {pct(total ? (valor / total) * 100 : null)}
                </span>
              </b>
            </div>
            <div className="barra">
              <span
                style={{
                  width: `${total ? (valor / filas[0][1]) * 100 : 0}%`,
                  background: "linear-gradient(90deg, var(--prime-bronze), var(--prime-gold))",
                }}
              />
            </div>
          </div>
        ))}
      </div>
      <Base>{nota}</Base>
    </section>
  );
}

export function Audiencia({ d }: { d: Analisis }) {
  const a = d.audiencia;
  const vacio = !Object.keys(a.ciudades ?? {}).length &&
    !Object.keys(a.paises ?? {}).length &&
    !Object.keys(a.edad ?? {}).length &&
    !Object.keys(a.genero ?? {}).length;

  if (vacio) {
    return (
      <>
        <SinDatosSeccion
          titulo="Sin datos demograficos"
          porque={
            a.nota ??
            "La API no devolvio demografia. Necesita 100+ seguidores y el permiso instagram_manage_insights vigente."
          }
        />
        <Nota>
          Esto no significa que la audiencia sea cero: significa que Instagram no entrego el desglose. Son dos
          diagnosticos distintos y llevan a acciones distintas.
        </Nota>
      </>
    );
  }

  const base = `Sobre ${num(a.seguidores)} seguidores. Instagram entrega esta demografia solo con 100+ seguidores en la dimension y la recalcula a su ritmo, asi que no cuadra al dia con el conteo de perfil.`;
  const primero = (datos: Record<string, number>) => Object.entries(datos ?? {}).sort((x, y) => y[1] - x[1])[0] ?? null;
  const pais = primero(a.paises);
  const ciudad = primero(a.ciudades);
  const edad = primero(a.edad);

  return (
    <div className="lista" style={{ gap: "var(--e5)" }}>
      <div className="audiencia-hero card">
        <div><span className="kpi-lbl">Retrato de la comunidad</span><h2>{num(a.seguidores)} seguidores medidos</h2><p>Una lectura rápida antes de entrar al detalle geográfico y demográfico.</p></div>
      </div>
      <div className="kpis">
        <Kpi etiqueta="País principal" valor={pais?.[0] ?? "—"} pie={pais ? `${num(pais[1])} seguidores` : "sin dato"} icono="audiencia" />
        <Kpi etiqueta="Ciudad principal" valor={ciudad?.[0]?.split(",")[0] ?? "—"} pie={ciudad ? `${num(ciudad[1])} seguidores` : "sin dato"} icono="perfil" />
        <Kpi etiqueta="Edad dominante" valor={edad?.[0] ?? "—"} pie={edad ? `${num(edad[1])} seguidores` : "sin dato"} icono="alcance" />
        <Kpi etiqueta="Cortes disponibles" valor={num([a.paises,a.ciudades,a.edad,a.genero].filter(x=>Object.keys(x??{}).length).length)} pie="país, ciudad, edad y género" icono="piezas" />
      </div>
      <Distribucion titulo="Paises" datos={a.paises} nota={base} />
      <Distribucion titulo="Ciudades" datos={a.ciudades} limite={12} nota={base} />
      <Distribucion titulo="Edad" datos={a.edad} nota={base} />
      <Distribucion titulo="Genero" datos={a.genero} nota={base} />
      {a.nota ? <Nota>{a.nota}</Nota> : null}
    </div>
  );
}
