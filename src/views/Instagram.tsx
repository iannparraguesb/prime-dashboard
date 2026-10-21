import { useEffect, useRef, useState } from "react";
import { Icono } from "../components/icons";
import { haceCuanto } from "../components/ui";
import type { Yo } from "../hooks/useYo";

async function llamar(jwt: string | null, ruta: string, cuerpo: object = {}) {
  const r = await fetch(ruta, {
    method: "POST",
    headers: { "content-type": "application/json", ...(jwt ? { authorization: `Bearer ${jwt}` } : {}) },
    body: JSON.stringify(cuerpo),
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok || d.error) throw new Error(d.error || "Algo falló. Inténtalo de nuevo.");
  return d;
}

/** Los dos permisos que pide la conexion (SCOPES en backend/instagram.mjs),
 *  contados como los va a leer el alumno. Los dos son de solo lectura. */
const PERMISOS = [
  ["perfil", "Ver tu perfil y tu contenido", "Usuario, seguidores, publicaciones, reels e historias."],
  ["alcance", "Ver tus estadísticas", "Alcance, guardados, compartidos, comentarios y de dónde es tu audiencia (desde 100 seguidores)."],
] as const;
const NO_HACEMOS = [
  "No publica, edita ni borra nada",
  "No comenta ni responde por ti",
  "No lee tus mensajes directos",
  "Nunca ve tu contraseña: entras directo en Instagram",
];

export function ConectarInstagram({ yo, jwt, recargar }: { yo: Yo; jwt: string | null; recargar: () => void }) {
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmar, setConfirmar] = useState(false);
  const ig = yo.instagram;
  const conectada = ig && ["activa", "vencida", "error"].includes(ig.estado);
  const reconectar = ig && (ig.estado === "vencida" || ig.estado === "error");

  const conectar = async () => {
    setOcupado(true); setError(null);
    try {
      const { url } = await llamar(jwt, "/api/instagram/iniciar");
      window.location.assign(url);
    } catch (e) {
      setError(e instanceof Error ? e.message : "No pudimos iniciar la conexión.");
      setOcupado(false);
    }
  };
  const desconectar = async () => {
    setOcupado(true); setError(null);
    try { await llamar(jwt, "/api/instagram/desconectar"); setConfirmar(false); recargar(); }
    catch (e) { setError(e instanceof Error ? e.message : "No pudimos desconectar."); }
    finally { setOcupado(false); }
  };

  return (
    <div className="lista" style={{ gap: "var(--e5)", maxWidth: 860 }}>
      {error ? <div className="login-error" role="alert">{error}</div> : null}

      {conectada ? (
        <section className="card ig-card">
          <div className="ig-icono" aria-hidden="true"><Icono nombre="imagen" size={22} /></div>
          <div className="ig-cuerpo">
            <h2>Conectado como @{ig!.username ?? "tu cuenta"}</h2>
            {reconectar ? (
              <p className="ig-alerta">{ig!.error ?? "Tu conexión necesita renovarse."} Vuelve a conectar para seguir viendo tus datos al día.</p>
            ) : (
              <p>{ig!.ultima_sincronizacion ? `Tus datos se actualizaron ${haceCuanto(ig!.ultima_sincronizacion)}. Se actualizan solos cada hora.` : "Estamos trayendo tus publicaciones. Tu primera actualización llega en menos de una hora."}</p>
            )}
            <div className="ig-acciones">
              {reconectar ? <button className="btn btn-primario" disabled={ocupado} onClick={() => void conectar()}>Volver a conectar</button> : <a className="btn btn-primario" href="#resumen">Ver mi resumen</a>}
              {confirmar ? (
                <>
                  <span className="ig-confirmar">¿Seguro? Dejarás de ver tus datos.</span>
                  <button className="btn" disabled={ocupado} onClick={() => void desconectar()}>{ocupado ? "Desconectando…" : "Sí, desconectar"}</button>
                  <button className="btn" disabled={ocupado} onClick={() => setConfirmar(false)}>Cancelar</button>
                </>
              ) : <button className="btn" onClick={() => setConfirmar(true)}>Desconectar</button>}
            </div>
          </div>
        </section>
      ) : (
        <section className="card ig-card">
          <div className="ig-icono" aria-hidden="true"><Icono nombre="imagen" size={22} /></div>
          <div className="ig-cuerpo">
            <h2>Conecta tu cuenta de Instagram</h2>
            <p>Te llevamos a Instagram para que entres con tu propia cuenta. La app pide solo permisos de lectura: lee tu información para mostrártela ordenada en tu dashboard y no puede cambiar nada en tu cuenta.</p>
            <button className="btn ig-boton" disabled={ocupado} onClick={() => void conectar()}>
              {ocupado ? "Abriendo Instagram…" : "Conectar con Instagram →"}
            </button>
            <small>Necesitas una cuenta profesional (empresa o creador). Al conectar, aceptas que el equipo de Prime Club vea tus métricas para acompañarte. Puedes desconectarla cuando quieras.</small>
          </div>
        </section>
      )}

      <section className="card ig-permisos">
        <h3><Icono nombre="info" size={14} /> {conectada ? "Lo que autorizaste" : "Lo que vas a autorizar"} en Instagram: solo lectura</h3>
        <div className="ig-grilla">
          {PERMISOS.map(([icono, t, detalle]) => (
            <div key={t} className="ig-permiso"><Icono nombre={icono} size={14} /><span><b>{t}</b>{detalle}</span></div>
          ))}
        </div>
        <h3 style={{ marginTop: "var(--e4)" }}>Lo que la app no hace</h3>
        <div className="ig-grilla">
          {NO_HACEMOS.map((t) => <div key={t}>✕ {t}</div>)}
        </div>
      </section>
    </div>
  );
}

/** Pagina a la que vuelve Instagram: /conectar/instagram?code=…&state=… */
export function RegresoInstagram({ jwt, alTerminar }: { jwt: string | null; alTerminar: () => void }) {
  const [estado, setEstado] = useState<{ tipo: "cargando" | "ok" | "error"; texto: string }>({ tipo: "cargando", texto: "Conectando tu cuenta…" });
  const enviado = useRef(false);
  useEffect(() => {
    if (enviado.current || !jwt) return;
    enviado.current = true;
    const q = new URLSearchParams(window.location.search);
    // El code no debe quedar en el historial ni en el Referer.
    window.history.replaceState(null, "", "/conectar/instagram");
    if (q.get("error")) {
      setEstado({ tipo: "error", texto: q.get("error_reason") === "user_denied" ? "Cancelaste la conexión. Puedes intentarlo cuando quieras." : "Instagram no completó la conexión. Inténtalo de nuevo." });
      return;
    }
    llamar(jwt, "/api/instagram/callback", { code: q.get("code") ?? "", state: q.get("state") ?? "" })
      .then((d) => setEstado({ tipo: "ok", texto: `¡Listo! Conectaste @${d.username ?? "tu cuenta"}.` }))
      .catch((e) => setEstado({ tipo: "error", texto: e instanceof Error ? e.message : "No pudimos conectar tu cuenta." }));
  }, [jwt]);
  return (
    <div className="login">
      <div className="card login-caja" role="status">
        <h1 style={{ fontSize: 22 }}>{estado.tipo === "ok" ? "Instagram conectado" : estado.tipo === "error" ? "No se pudo conectar" : "Un momento…"}</h1>
        <p>{estado.texto}</p>
        {estado.tipo === "ok" ? <p style={{ color: "var(--texto-3)" }}>Tus publicaciones aparecerán en tu panel en menos de una hora.</p> : null}
        {estado.tipo !== "cargando" ? <button className="btn btn-primario" onClick={alTerminar}>Ir a mi panel</button> : null}
      </div>
    </div>
  );
}
