import { useState } from "react";
import { Icono } from "./icons";
import { Badge, compacto, fechaCorta, mult, NOMBRE_FORMATO, pct, Barra, NADA } from "./ui";
import type { Pieza } from "../tipos";
import type { CriterioOrden } from "./FilterBar";

/** Las miniaturas de la API son URLs firmadas que pueden caducar. La imagen
 *  necesita SU PROPIO estado: una imagen rota se ve peor que un marcador de
 *  posicion honesto. */
function Miniatura({ src, alt }: { src: string | null; alt: string }) {
  const [estado, setEstado] = useState<"cargando" | "ok" | "caida">(src ? "cargando" : "caida");
  return (
    <>
      {src && estado !== "caida" ? (
        <img
          src={src}
          alt={alt}
          loading="lazy"
          decoding="async"
          onLoad={() => setEstado("ok")}
          onError={() => setEstado("caida")}
          style={{ opacity: estado === "ok" ? 1 : 0, transition: "opacity 200ms" }}
        />
      ) : null}
      {estado === "cargando" ? <div className="esq" style={{ position: "absolute", inset: 0 }} /> : null}
      {estado === "caida" ? (
        <div className="pieza-caida">
          <Icono nombre="imagen" size={18} />
          <span>Miniatura caducada</span>
        </div>
      ) : null}
    </>
  );
}

/** La metrica destacada cambia segun POR QUE se esta ordenando. Si ordeno por
 *  guardado quiero ver el guardado grande; mostrar siempre lo mismo obliga a
 *  leer la letra chica para verificar el orden. */
function destacado(p: Pieza, orden: CriterioOrden): { valor: string; etiqueta: string } {
  switch (orden) {
    case "guardado_pct":
      return { valor: pct(p.guardado_pct), etiqueta: "guardado / alcance" };
    case "compartido_pct":
      return { valor: pct(p.compartido_pct), etiqueta: "compartido / alcance" };
    case "multiplicador":
      return { valor: mult(p.multiplicador), etiqueta: `vs. mediana ${NOMBRE_FORMATO[p.formato ?? ""] ?? "formato"}` };
    case "alcance":
      return { valor: compacto(p.alcance), etiqueta: "de alcance" };
    case "comentarios":
      return { valor: compacto(p.comentarios), etiqueta: "comentarios" };
    case "fecha":
    default:
      return { valor: compacto(p.vistas ?? p.alcance), etiqueta: p.vistas === null ? "de alcance" : "vistas" };
  }
}

export function ReelCard({
  pieza,
  orden,
  rango,
}: {
  pieza: Pieza;
  orden: CriterioOrden;
  /** Posicion en el ranking filtrado. Se pinta grande sobre la miniatura: la
   *  posicion se percibe sin leer, y de paso ancla la identidad visual. */
  rango?: number;
}) {
  const d = destacado(pieza, orden);
  const m = pieza.multiplicador;
  const tono = m === null ? undefined : m >= 1.5 ? "oro" : m < 0.6 ? "mal" : undefined;

  const podio = rango !== undefined && rango <= 3;

  return (
    <article className="pieza" data-podio={podio || undefined}>
      <div className="pieza-img">
        <div className="pieza-esquina" data-lado="izq">
          <Badge tono={tono}>{mult(m)}</Badge>
          {pieza.tipo === "REELS" ? <Badge>Reel</Badge> : null}
        </div>
        <div className="pieza-esquina" data-lado="der">
          {fechaCorta(pieza.fecha)}
        </div>
        <Miniatura src={pieza.thumb} alt={pieza.primera_linea || "Publicacion"} />
        {rango !== undefined ? (
          <span className="pieza-rango" data-podio={podio || undefined} aria-hidden="true">
            {rango}
          </span>
        ) : null}
      </div>

      <div className="pieza-cuerpo">
        <div className="pieza-grande num">
          {d.valor}
          <small>{d.etiqueta}</small>
        </div>

        <div className="pieza-mets">
          <span>
            <Icono nombre="guardado" size={12} /> {compacto(pieza.guardados)} guard.
          </span>
          <span>
            <Icono nombre="compartido" size={12} /> {compacto(pieza.compartidos)} comp.
          </span>
          <span>
            <Icono nombre="like" size={12} /> {compacto(pieza.likes)} likes
          </span>
          <span>
            <Icono nombre="comentario" size={12} /> {compacto(pieza.comentarios)} com.
          </span>
        </div>

        <Barra
          partes={[
            { nombre: "guardados", valor: pieza.guardados ?? 0, color: "var(--prime-gold-bright)" },
            { nombre: "compartidos", valor: pieza.compartidos ?? 0, color: "var(--prime-amber)" },
            { nombre: "comentarios", valor: pieza.comentarios ?? 0, color: "var(--prime-bronze)" },
            { nombre: "likes", valor: pieza.likes ?? 0, color: "var(--linea-fuerte)" },
          ]}
        />
        <div className="pieza-mets" style={{ gridTemplateColumns: "1fr", fontSize: 11 }}>
          <span>
            {NOMBRE_FORMATO[pieza.formato ?? ""] ?? pieza.formato ?? NADA} ·{" "}
            {pieza.alcance === null ? "alcance no medido" : `${compacto(pieza.alcance)} de alcance`}
          </span>
        </div>

        {pieza.primera_linea ? <p className="pieza-txt">{pieza.primera_linea}</p> : null}

        {pieza.pilares.length ? (
          <div className="pieza-pilares">
            {pieza.pilares.map((x) => (
              <Badge key={x}>{x}</Badge>
            ))}
          </div>
        ) : null}

        {pieza.metricas_faltantes.length ? (
          <div className="pieza-mets" style={{ gridTemplateColumns: "1fr", fontSize: 11 }}>
            <span title={pieza.metricas_faltantes.join(", ")}>
              <Icono nombre="aviso" size={11} /> {pieza.metricas_faltantes.length} metricas no medidas
            </span>
          </div>
        ) : null}

        {pieza.permalink ? (
          <a className="pieza-cta" href={pieza.permalink} target="_blank" rel="noreferrer">
            Ver en Instagram <Icono nombre="externo" size={12} />
          </a>
        ) : null}
      </div>
    </article>
  );
}
