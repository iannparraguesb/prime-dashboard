import { useCallback, useEffect, useState } from "react";
import { Badge, Base, NADA, haceCuanto } from "../components/ui";
import { Icono } from "../components/icons";

interface Invitacion {
  id: string;
  nota: string;
  creado_en: string;
  expira_en: string;
  usado_en: string | null;
  revocado_en: string | null;
  /** Con que correo se creo la cuenta (null si el codigo no se uso). */
  correo: string | null;
  instagram_username: string | null;
  instagram_estado: "pendiente" | "activa" | "vencida" | "revocada" | "error" | null;
  ultima_sincronizacion: string | null;
  instagram_error: string | null;
}

/** El ultimo paso del alumno: lo que falta para que vea su panel. */
function instagram(x: Invitacion) {
  if (!x.usado_en) return <span style={{ color: "var(--texto-3)" }}>{NADA}</span>;
  if (!x.instagram_estado) return <span style={{ color: "var(--texto-3)" }}>sin conectar</span>;
  const tono = x.instagram_estado === "activa" ? "bien" : x.instagram_estado === "vencida" || x.instagram_estado === "error" ? "mal" : undefined;
  const texto = { activa: "conectado", vencida: "vencido", error: "con error", pendiente: "pendiente", revocada: "desconectado" }[x.instagram_estado];
  return (
    <span title={x.instagram_error ?? undefined}>
      @{x.instagram_username ?? "?"} <Badge tono={tono}>{texto}</Badge>
    </span>
  );
}

const fecha = (iso: string) => new Date(iso).toLocaleDateString("es-CL", { day: "numeric", month: "short", year: "numeric" });

async function llamar(jwt: string | null, metodo: "GET" | "POST" | "DELETE", cuerpo?: object) {
  const r = await fetch("/api/invitaciones", {
    method: metodo,
    headers: { accept: "application/json", ...(cuerpo ? { "content-type": "application/json" } : {}), ...(jwt ? { authorization: `Bearer ${jwt}` } : {}) },
    body: cuerpo ? JSON.stringify(cuerpo) : undefined,
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok || d.error) throw new Error(d.error || "No se pudo completar la acción.");
  return d;
}

function estado(x: Invitacion): { t: string; tono?: "oro" | "bien" | "mal" } {
  if (x.usado_en) return { t: "Usado", tono: "bien" };
  if (x.revocado_en) return { t: "Revocado" };
  if (Date.parse(x.expira_en) < Date.now()) return { t: "Vencido", tono: "mal" };
  return { t: "Pendiente", tono: "oro" };
}

/** Invitar alumnos: un codigo de un solo uso por persona. El codigo se ve una
 *  vez, al crearlo; en la base queda solo su hash. */
export function Alumnos({ jwt }: { jwt: string | null }) {
  const [filas, setFilas] = useState<Invitacion[] | null>(null);
  const [nota, setNota] = useState("");
  const [nuevo, setNuevo] = useState<{ nota: string; codigo: string; expira: string | null } | null>(null);
  const [copiado, setCopiado] = useState(false);
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const cargar = useCallback(async () => {
    try {
      const d = await llamar(jwt, "GET");
      setFilas(d.filas as Invitacion[]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudieron cargar las invitaciones.");
    }
  }, [jwt]);
  useEffect(() => { void cargar(); }, [cargar]);

  const crear = async () => {
    setOcupado(true);
    setError(null);
    setCopiado(false);
    try {
      const d = await llamar(jwt, "POST", { nota: nota.trim() });
      setNuevo({ nota: nota.trim(), codigo: d.codigo, expira: d.expira_en ?? null });
      setNota("");
      await cargar();
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo crear el código.");
    } finally {
      setOcupado(false);
    }
  };

  const revocar = async (id: string) => {
    setError(null);
    try {
      await llamar(jwt, "DELETE", { id });
      await cargar();
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo revocar.");
    }
  };

  // Tres pasos, en el orden en que el alumno los hace. El primero existe solo
  // mientras la app de Meta este en modo desarrollo (testers de Instagram).
  const mensaje = nuevo
    ? `Hola ${nuevo.nota}, te invito a probar el panel de Prime Club.\n\n` +
      `1. En Instagram acepta la invitación de evaluador de Prime Club: Configuración → Apps y sitios web → Invitaciones de evaluador.\n` +
      `2. Entra a ${window.location.origin}, elige "¿Eres alumno y tienes un código? Crea tu cuenta" y usa este código: ${nuevo.codigo}` +
      `${nuevo.expira ? ` (vence el ${fecha(nuevo.expira)})` : ""}. Sirve una sola vez.\n` +
      `3. En "Mi Instagram" conecta tu cuenta. Tiene que ser profesional (empresa o creador). Tus datos aparecen en menos de una hora.`
    : "";

  const copiar = async () => {
    try {
      await navigator.clipboard.writeText(mensaje);
      setCopiado(true);
    } catch {
      setError("No se pudo copiar. Selecciona el mensaje y cópialo a mano.");
    }
  };

  return (
    <div className="lista" style={{ gap: "var(--e5)" }}>
      <form
        className="card invitar"
        onSubmit={(ev) => { ev.preventDefault(); if (nota.trim() && !ocupado) void crear(); }}
      >
        <label className="login-campo" style={{ margin: 0 }}>
          <span>Nombre del alumno</span>
          <input className="control" value={nota} maxLength={120} onChange={(e) => setNota(e.target.value)} placeholder="Para saber a quién se lo mandaste" />
        </label>
        <button className="btn btn-primario" type="submit" disabled={!nota.trim() || ocupado}>
          {ocupado ? "Creando…" : "Crear código"}
        </button>
      </form>

      {nuevo ? (
        <div className="card invitacion-nueva" role="status">
          <span className="kpi-lbl">Código para {nuevo.nota} · solo se muestra ahora</span>
          <div className="invitacion-codigo num">{nuevo.codigo}</div>
          <p style={{ whiteSpace: "pre-line" }}>{mensaje}</p>
          <div className="metas-acciones">
            <button className="btn btn-primario" onClick={() => void copiar()}>
              {copiado ? "Mensaje copiado" : "Copiar mensaje para WhatsApp"}
            </button>
            <button className="btn" onClick={() => setNuevo(null)}>Listo</button>
          </div>
        </div>
      ) : null}

      {error ? (
        <div className="login-error" role="alert">
          <Icono nombre="error" size={15} />
          <span>{error}</span>
        </div>
      ) : null}

      <section>
        <h2 className="sec-titulo">Códigos creados</h2>
        <div className="tabla-caja">
          <table>
            <thead>
              <tr>
                <th>Alumno</th>
                <th>Código</th>
                <th>Cuenta</th>
                <th>Instagram</th>
                <th>Datos</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {filas === null ? (
                <tr><td colSpan={6}>Cargando…</td></tr>
              ) : !filas.length ? (
                <tr><td colSpan={6} style={{ color: "var(--texto-3)" }}>Todavía no creaste ningún código.</td></tr>
              ) : filas.map((x) => {
                const e = estado(x);
                return (
                  <tr key={x.id}>
                    <td>{x.nota}</td>
                    <td>
                      <Badge tono={e.tono}>{e.t}{x.usado_en ? ` el ${fecha(x.usado_en)}` : ""}</Badge>
                      {e.t === "Pendiente" ? <small className="dash-sub"> vence {fecha(x.expira_en)}</small> : null}
                    </td>
                    <td>{x.correo ?? <span style={{ color: "var(--texto-3)" }}>{NADA}</span>}</td>
                    <td>{instagram(x)}</td>
                    <td>{x.ultima_sincronizacion ? `sincronizado ${haceCuanto(x.ultima_sincronizacion)}` : x.instagram_estado ? "esperando la primera sincronización" : NADA}</td>
                    <td>{e.t === "Pendiente" ? <button className="btn" onClick={() => void revocar(x.id)}>Revocar</button> : null}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <Base>
        Cada código sirve para crear una sola cuenta y vence a los 14 días. Con la cuenta creada, el alumno conecta su
        Instagram y solo ve su propio contenido: nada del negocio de Leo ni de otros alumnos. Si un código se filtró,
        revócalo y crea otro.
      </Base>
    </div>
  );
}
