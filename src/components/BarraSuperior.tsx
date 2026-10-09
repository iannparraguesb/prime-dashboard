import { useApi } from "../hooks/useApi";
import { Icono } from "./icons";
import { compacto, num } from "./ui";
import type { Tema } from "../hooks/useTema";

interface Cabecera {
  username: string | null;
  nombre: string | null;
  seguidores: number | null;
  seguidores_30d: number | null;
  alcance_30d: number | null;
  guardados_30d: number | null;
  publicaciones_30d: number;
  actualizado: string | null;
  error?: string;
}

const HOY = () => new Date().toLocaleDateString("es-CL", { day: "numeric", month: "short", year: "numeric" });

/** "hoy", "ayer", "hace 3 días": la ingesta guarda una medicion por dia. */
export function diasDesde(fecha: string | null): number | null {
  if (!fecha) return null;
  const hoy = new Date().toLocaleDateString("en-CA", { timeZone: "America/Santiago" });
  return Math.round((Date.parse(`${hoy}T12:00:00Z`) - Date.parse(`${fecha}T12:00:00Z`)) / 86_400_000);
}
const textoFrescura = (d: number | null) => (d === null ? "sin datos" : d <= 0 ? "hoy" : d === 1 ? "ayer" : `hace ${d} días`);

export function BarraSuperior({ jwt, activa, etiqueta, tema, alternarTema, recargar, cargando }: {
  jwt: string | null;
  /** false cuando no hay cuenta que mostrar (alumno sin conectar). */
  activa: boolean;
  etiqueta: string;
  tema: Tema;
  alternarTema: () => void;
  recargar: () => void;
  cargando: boolean;
}) {
  const c = useApi<Cabecera>("/api/cabecera", activa ? jwt : null);
  const d = c.datos;
  const dias = diasDesde(d?.actualizado ?? null);
  const inicial = (d?.nombre || d?.username || "P").replace(/^@/, "").slice(0, 1).toUpperCase();
  const stats: { icono: "perfil" | "alcance" | "guardado"; lbl: string; v: string; delta?: number | null }[] = [
    { icono: "perfil", lbl: "Seguidores", v: num(d?.seguidores ?? null), delta: d?.seguidores_30d },
    { icono: "alcance", lbl: "Alcance 30 días", v: compacto(d?.alcance_30d ?? null) },
    { icono: "guardado", lbl: "Guardados 30 días", v: compacto(d?.guardados_30d ?? null) },
  ];

  return (
    <header className="barra-sup">
      <div className="barra-cuenta">
        <span className="avatar" aria-hidden="true">{inicial}</span>
        <div>
          <strong>{d?.username ? `@${d.username}` : "Prime Club"}</strong>
          <span className="pastilla">{etiqueta}</span>
        </div>
      </div>

      {activa ? (
        <div className="barra-stats">
          {stats.map((s) => (
            <div key={s.lbl} className="barra-stat">
              <Icono nombre={s.icono} size={15} />
              <div>
                <span>{s.lbl}</span>
                <strong>
                  {s.v}
                  {s.delta ? <em data-tono={s.delta > 0 ? "sube" : "baja"}>{s.delta > 0 ? "+" : ""}{num(s.delta)}</em> : null}
                </strong>
              </div>
            </div>
          ))}
        </div>
      ) : <div />}

      <div className="barra-acciones">
        <span className="chip-fecha"><Icono nombre="calendario" size={13} /> {HOY()}</span>
        {activa ? (
          <span className="frescura-pill" data-tono={dias === null ? "mal" : dias <= 1 ? "bien" : dias <= 3 ? "ojo" : "mal"} title="Última medición de Instagram">
            Actualizado {textoFrescura(dias)}
          </span>
        ) : null}
        <button className="btn-icono" onClick={() => { recargar(); c.recargar(); }} disabled={cargando} aria-label="Volver a cargar" title="Volver a cargar">
          <Icono nombre="refrescar" size={16} />
        </button>
        <button className="btn-icono" onClick={alternarTema} aria-label={tema === "claro" ? "Usar tema oscuro" : "Usar tema claro"} title={tema === "claro" ? "Tema oscuro" : "Tema claro"}>
          <Icono nombre={tema === "claro" ? "luna" : "sol"} size={16} />
        </button>
      </div>
    </header>
  );
}
