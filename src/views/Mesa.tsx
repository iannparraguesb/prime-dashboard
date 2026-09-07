import { PlanSemanal } from "../components/PlanSemanal";
import { SinDatosSeccion } from "../components/states";
import { Base, Badge, Nota } from "../components/ui";
import { Icono } from "../components/icons";
import type { Analisis } from "../tipos";

/** La mesa de trabajo es la seccion que justifica al resto: un panel que solo
 *  mira no sirve. Cada propuesta lleva el motivo escrito al lado, no es una
 *  lista ordenada sin explicacion. */
export function Mesa({ d, jwt }: { d: Analisis; jwt: string | null }) {
  const p = d.mesa.propuestas;

  if (!p.length) {
    return (
      <>
        <PlanSemanal jwt={jwt} propuestas={p} />
        <SinDatosSeccion
          titulo="Ninguna pieza dispara una propuesta"
          porque={`El analisis corrio bien sobre ${d.n_solidos} piezas, pero ninguna cumple los criterios. Con catalogos chicos es lo normal: hacen falta suficientes piezas sobre el piso de alcance para que existan medianas por formato con las que comparar.`}
        />
        <Base>Criterio aplicado: {d.mesa.criterio}</Base>
      </>
    );
  }

  const grupos = p.reduce<Record<string, typeof p>>((acc, x) => {
    (acc[x.accion] ??= []).push(x);
    return acc;
  }, {});

  return (
    <div className="lista" style={{ gap: "var(--e5)" }}>
      <PlanSemanal jwt={jwt} propuestas={p} />
      <Nota>
        Estas propuestas salen de la comparacion contra la mediana del mismo formato, no de una opinion. Si el
        motivo no te convence, el motivo esta escrito: discutelo contra el numero.
      </Nota>

      {Object.entries(grupos).map(([accion, items]) => (
        <section key={accion}>
          <h2 style={{ fontSize: 18, marginBottom: "var(--e3)" }}>
            {accion} <Badge>{items.length}</Badge>
          </h2>
          <div className="lista">
            {items.map((x, i) => (
              <div className="card propuesta" key={`${x.pieza_id ?? x.titulo}-${i}`}>
                <div className="propuesta-thumb">
                  {x.thumb ? (
                    <img src={x.thumb} alt="" loading="lazy" />
                  ) : (
                    <div style={{ display: "grid", placeItems: "center", height: "100%", color: "var(--texto-3)" }}>
                      <Icono nombre="mesa" size={18} />
                    </div>
                  )}
                </div>
                <div>
                  <h3>{x.titulo || "(sin texto)"}</h3>
                  <p>{x.motivo}</p>
                  {x.permalink ? (
                    <p style={{ marginTop: "var(--e2)" }}>
                      <a href={x.permalink} target="_blank" rel="noreferrer">
                        Ver en Instagram <Icono nombre="externo" size={12} />
                      </a>
                    </p>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        </section>
      ))}

      <Base>Criterio aplicado: {d.mesa.criterio}</Base>
    </div>
  );
}
