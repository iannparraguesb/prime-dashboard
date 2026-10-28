import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { compacto, fechaCorta, haceCuanto, NADA } from "../components/ui";
import { Icono } from "../components/icons";
import { ordenarCuentas, resumirCuenta } from "../lib/competencia";
import type { Analisis, PiezaCompetencia } from "../tipos";
import { guardarSugerencia, tema, type FormatoIdea } from "../lib/ideas";
import "./competencia.css";

type Periodo = 30 | 90 | 365;

const FORMATO: Record<string, string> = {
  REEL: "Reel",
  CARRUSEL: "Carrusel",
  IMAGEN: "Imagen",
  OTRO: "Otro",
};

/** Cada cuanto se pregunta por el estado mientras una cuenta se analiza. */
const SONDEO_MS = 8000;

function Miniatura({ pieza }: { pieza: PiezaCompetencia }) {
  return pieza.thumb ? (
    <img src={pieza.thumb} alt="" loading="lazy" />
  ) : (
    <span className="comp-thumb-vacio" aria-hidden="true">
      <Icono nombre={pieza.formato === "REEL" ? "vista" : "piezas"} size={16} />
    </span>
  );
}

interface Vigilada {
  id: string;
  username: string;
  url: string | null;
  nombre: string | null;
  nota: string | null;
  activa: boolean;
  estado: "pendiente" | "analizando" | "listo" | "error";
  ultimo_error: string | null;
  analizada_en: string | null;
  agregada_en: string;
}

interface Lista {
  filas?: Vigilada[];
  activos?: number;
  tope?: number;
  quedan?: number;
  nota?: string;
  error?: string;
}

const EN_CURSO = new Set<Vigilada["estado"]>(["pendiente", "analizando"]);

export function Competencia({ d, jwt, recargar, editable }: { d: Analisis; jwt: string | null; recargar: () => void; editable: boolean }) {
  const [lista, setLista] = useState<Lista | null>(null);
  const [entrada, setEntrada] = useState("");
  const [guardando, setGuardando] = useState(false);
  const [msg, setMsg] = useState<{ tipo: "ok" | "error"; texto: string } | null>(null);
  const [periodo, setPeriodo] = useState<Periodo>(30);
  const [cuentaActiva, setCuentaActiva] = useState<string | null>(null);
  const [confirmando, setConfirmando] = useState<string | null>(null);
  const [ocupada, setOcupada] = useState<string | null>(null);
  // Usuarios cuyo analisis se pidio a GitHub en esta sesion. Sin token, la
  // cuenta espera a la sincronizacion diaria y la tarjeta lo dice.
  const [inmediatos, setInmediatos] = useState<Record<string, boolean>>({});

  const auth = useMemo((): Record<string, string> => (jwt ? { authorization: `Bearer ${jwt}` } : {}), [jwt]);

  const cargar = useCallback(async () => {
    try {
      const r = await fetch("/api/competidores", { headers: auth });
      setLista(await r.json());
    } catch (e) {
      setLista({ error: e instanceof Error ? e.message : String(e) });
    }
  }, [auth]);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  const activas = useMemo(
    () => (lista?.filas ?? []).filter((v) => v.activa).sort((a, b) => a.agregada_en.localeCompare(b.agregada_en)),
    [lista]
  );
  const quitadas = (lista?.filas ?? []).filter((v) => !v.activa);
  const tope = lista?.tope ?? 5;
  const lleno = activas.length >= tope;
  const analizando = activas.some((v) => EN_CURSO.has(v.estado));

  // Mientras alguna cuenta se analiza, se consulta su estado. Cuando termina,
  // se recargan las publicaciones para que aparezcan sin refrescar la pagina.
  const estadosPrevios = useRef<Map<string, Vigilada["estado"]>>(new Map());
  useEffect(() => {
    const previos = estadosPrevios.current;
    const termino = activas.some((v) => v.estado === "listo" && EN_CURSO.has(previos.get(v.id) ?? "listo"));
    estadosPrevios.current = new Map(activas.map((v) => [v.id, v.estado]));
    if (termino) recargar();
  }, [activas, recargar]);
  useEffect(() => {
    if (!analizando) return;
    const t = window.setInterval(() => void cargar(), SONDEO_MS);
    return () => window.clearInterval(t);
  }, [analizando, cargar]);

  const enviar = async (metodo: "POST" | "DELETE", cuerpo: object) => {
    const r = await fetch("/api/competidores", {
      method: metodo,
      headers: { "content-type": "application/json", ...auth },
      body: JSON.stringify(cuerpo),
    });
    const body = await r.json().catch(() => ({}));
    // El error va visible con su causa. Nunca solo a la consola.
    if (!r.ok || body.error) throw new Error(body.error || "No se pudo guardar el cambio.");
    return body;
  };

  const agregar = async (usuario: string) => {
    if (!usuario.trim() || guardando) return;
    setGuardando(true);
    setMsg(null);
    try {
      const cuerpo = await enviar("POST", { username: usuario.trim() });
      const u = cuerpo.competidor?.username as string | undefined;
      if (u) setInmediatos((prev) => ({ ...prev, [u]: Boolean(cuerpo.inmediato) }));
      setEntrada("");
      await cargar();
    } catch (e) {
      setMsg({ tipo: "error", texto: e instanceof Error ? e.message : String(e) });
    } finally {
      setGuardando(false);
    }
  };

  const quitar = async (v: Vigilada) => {
    setMsg(null);
    setOcupada(v.id);
    try {
      await enviar("DELETE", { id: v.id });
      setConfirmando(null);
      if (cuentaActiva === v.username) setCuentaActiva(null);
      await cargar();
      recargar();
      setMsg({ tipo: "ok", texto: `@${v.username} ya no aparece en Espía. Puedes volver a agregarla cuando quieras.` });
    } catch (e) {
      setMsg({ tipo: "error", texto: e instanceof Error ? e.message : "No se pudo quitar." });
    } finally {
      setOcupada(null);
    }
  };

  const [formato, setFormato] = useState<string | null>(null);
  const [orden, setOrden] = useState<"funciono" | "reciente" | "likes">("funciono");
  const [guardadas, setGuardadas] = useState<Set<string>>(new Set());

  const cuentas = useMemo(() => {
    const hoy = d.snapshot ? new Date(`${d.snapshot}T12:00:00Z`) : new Date();
    // Una cuenta recien quitada desaparece al tiro, sin esperar a que se recargue el analisis.
    const vigentes = lista?.filas ? new Set(activas.map((v) => v.username)) : null;
    const filas = Object.entries(d.competencia?.cuentas ?? {})
      .filter(([username]) => !vigentes || vigentes.has(username))
      .map(([username, datos]) => ({
        username,
        datos,
        resumen: resumirCuenta(datos.piezas ?? [], hoy, periodo),
      }));
    return ordenarCuentas(filas);
  }, [d.competencia?.cuentas, d.snapshot, periodo, lista?.filas, activas]);
  const porUsuario = useMemo(() => new Map(cuentas.map((c) => [c.username, c])), [cuentas]);

  // Biblioteca: todas las piezas de la ventana, con cuanto rindio cada una
  // contra el promedio de SU cuenta (comparar contra otra cuenta mide tamaño).
  const biblioteca = useMemo(() => {
    const desde = Date.now() - periodo * 86_400_000;
    return cuentas
      .filter((c) => !cuentaActiva || c.username === cuentaActiva)
      .flatMap((c) => (c.datos.piezas ?? []).map((p) => ({
        ...p,
        cuenta: c.username,
        ratio: p.interaccion_sobre_seguidores_pct !== null && c.datos.interaccion_mediana_pct
          ? p.interaccion_sobre_seguidores_pct / c.datos.interaccion_mediana_pct : null,
      })))
      .filter((p) => Date.parse(`${p.fecha}T12:00:00`) >= desde && (!formato || p.formato === formato))
      .sort((a, b) =>
        orden === "reciente" ? b.fecha.localeCompare(a.fecha)
          : orden === "likes" ? (b.likes ?? -1) - (a.likes ?? -1)
            : (b.ratio ?? -1) - (a.ratio ?? -1));
  }, [cuentas, cuentaActiva, periodo, formato, orden]);

  const guardarIdea = async (p: (typeof biblioteca)[number]) => {
    const f = ({ REEL: "reel", CARRUSEL: "carrusel" } as Record<string, FormatoIdea>)[p.formato ?? ""] ?? "post";
    setMsg(null);
    try {
      await guardarSugerencia(jwt, {
        clave: `competencia:${f}:${p.id}`, formato: f, origen: "competencia",
        titulo: `Tu versión de «${tema(p.primera_linea) || "esta publicación"}»`, hook: "Ponte a pensar en esto…",
        motivo: p.ratio ? `A @${p.cuenta} le funcionó ${p.ratio.toLocaleString("es-CL", { maximumFractionDigits: 1 })}x más que su promedio.` : `Publicación de @${p.cuenta}.`,
        referencia_url: p.permalink, referencia_thumb: p.thumb, referencia_cuenta: p.cuenta,
      });
      setGuardadas((prev) => new Set(prev).add(p.id));
    } catch (e) {
      const texto = e instanceof Error ? e.message : "No se pudo guardar.";
      if (texto.includes("ya existe")) setGuardadas((prev) => new Set(prev).add(p.id));
      else setMsg({ tipo: "error", texto });
    }
  };

  return (
    <div className="lista" style={{ gap: "var(--e5)" }}>
      <section className="card espia-panel" aria-labelledby="espia-titulo">
        <header className="espia-cab">
          <div>
            <h2 id="espia-titulo">Tus competidores</h2>
            <p>Elige hasta {tope} cuentas. Leemos sus publicaciones desde Instagram y abajo ves lo que mejor les funcionó.</p>
          </div>
          <div className="espia-cupo" data-lleno={lleno || undefined} aria-label={`${activas.length} de ${tope} cupos usados`}>
            <strong>{activas.length}<span>/{tope}</span></strong>
            <span className="espia-puntos" aria-hidden="true">
              {Array.from({ length: tope }, (_, k) => <i key={k} data-usado={k < activas.length || undefined} />)}
            </span>
            {lleno && editable ? <small>Cupo lleno: quita una para agregar otra.</small> : null}
          </div>
        </header>

        {lista?.error ? <div className="login-error" role="alert">No se pudo leer la lista: {lista.error}</div> : null}

        <div className="espia-grilla">
          {!lista ? Array.from({ length: 3 }, (_, k) => <div key={k} className="esq" style={{ height: 132 }} />) : null}
          {activas.map((v) => {
            const c = porUsuario.get(v.username);
            const enCurso = EN_CURSO.has(v.estado);
            return (
              <article
                key={v.id}
                className="espia-tarjeta"
                data-estado={v.estado}
                data-seleccionada={cuentaActiva === v.username || undefined}
              >
                <div className="espia-tarjeta-cab">
                  <span className="espia-avatar" aria-hidden="true">{v.username.slice(0, 1).toUpperCase()}</span>
                  <button
                    className="espia-nombre"
                    onClick={() => setCuentaActiva(cuentaActiva === v.username ? null : v.username)}
                    aria-pressed={cuentaActiva === v.username}
                    disabled={!c}
                    title={c ? "Ver solo sus publicaciones" : undefined}
                  >
                    <strong>@{v.username}</strong>
                    <span>{v.nombre ?? (enCurso ? "Cuenta nueva" : v.estado === "error" ? "No se pudo analizar" : NADA)}</span>
                  </button>
                </div>

                {enCurso ? (
                  <div className="espia-progreso" role="status">
                    <div className="espia-barra"><i /></div>
                    <span>
                      {inmediatos[v.username] === false
                        ? "En cola. Se analiza en la sincronización diaria (06:40)."
                        : v.estado === "analizando"
                          ? "Analizando sus publicaciones…"
                          : "En cola para analizar. Suele tardar 1 a 3 minutos."}
                    </span>
                  </div>
                ) : v.estado === "error" ? (
                  <p className="espia-error" role="alert">{v.ultimo_error ?? "Instagram no devolvió datos de esta cuenta."}</p>
                ) : (
                  <p className="espia-datos">
                    {compacto(c?.datos.seguidores ?? null)} seguidores
                    {" · "}
                    {c?.resumen.porSemana == null ? NADA : `${c.resumen.porSemana.toLocaleString("es-CL")} posts/sem`}
                    <small>Actualizada {haceCuanto(v.analizada_en)}</small>
                  </p>
                )}

                {editable ? <div className="espia-acciones">
                  {confirmando === v.id ? (
                    <>
                      <span>¿Quitar a @{v.username}?</span>
                      <button className="btn" data-variante="peligro" disabled={ocupada === v.id} onClick={() => void quitar(v)}>
                        {ocupada === v.id ? "Quitando…" : "Sí, quitar"}
                      </button>
                      <button className="btn" onClick={() => setConfirmando(null)}>Cancelar</button>
                    </>
                  ) : (
                    <>
                      {v.estado === "error" ? (
                        <button className="btn" disabled={guardando} onClick={() => void agregar(v.username)}>Reintentar</button>
                      ) : (
                        <a
                          className="espia-enlace"
                          href={`https://www.facebook.com/ads/library/?active_status=active&ad_type=all&country=ALL&q=${encodeURIComponent(v.username)}&search_type=keyword_unordered`}
                          target="_blank"
                          rel="noreferrer"
                        >
                          Sus anuncios <Icono nombre="externo" size={11} />
                        </a>
                      )}
                      <button className="btn espia-quitar" onClick={() => setConfirmando(v.id)} aria-label={`Quitar a @${v.username}`}>
                        Quitar
                      </button>
                    </>
                  )}
                </div> : null}
              </article>
            );
          })}

          {lista && !lista.error && editable && !lleno ? (
              <form
                className="espia-agregar"
                onSubmit={(e) => {
                  e.preventDefault();
                  void agregar(entrada);
                }}
              >
                <label htmlFor="espia-entrada"><strong>Agregar competidor</strong></label>
                <input
                  id="espia-entrada"
                  className="control"
                  value={entrada}
                  onChange={(e) => setEntrada(e.target.value)}
                  placeholder="@usuario o instagram.com/usuario"
                  disabled={guardando}
                  autoComplete="off"
                />
                <button className="btn" data-variante="oro" disabled={guardando || !entrada.trim()}>
                  {guardando ? "Agregando…" : `Agregar · quedan ${tope - activas.length}`}
                </button>
                <span>Debe ser pública y de empresa o creador.</span>
              </form>
          ) : null}
        </div>

        {msg ? (
          <div className={msg.tipo === "error" ? "login-error" : "comp-ok"} role={msg.tipo === "error" ? "alert" : "status"}>
            <span>{msg.texto}</span>
          </div>
        ) : null}

        {editable && quitadas.length && !lleno ? (
          <div className="espia-quitadas">
            <span>Quitadas antes:</span>
            {quitadas.map((v) => (
              <button key={v.id} className="chip" disabled={guardando} onClick={() => void agregar(v.username)} title="Volver a agregar">
                + @{v.username}
              </button>
            ))}
          </div>
        ) : null}
      </section>

      <div className="card filtros comp-filtros">
        {cuentaActiva ? (
          <button className="chip" aria-pressed="true" onClick={() => setCuentaActiva(null)} title="Ver todas las cuentas">
            Solo @{cuentaActiva} ✕
          </button>
        ) : null}
        <div className="chips" role="group" aria-label="Formato">
          {[[null, "Todo"], ["REEL", "Reels"], ["CARRUSEL", "Carruseles"], ["IMAGEN", "Fotos"]].map(([v, t]) => (
            <button key={t} className="chip" aria-pressed={formato === v} onClick={() => setFormato(v)}>{t}</button>
          ))}
        </div>
        <select className="control" value={periodo} onChange={(e) => setPeriodo(Number(e.target.value) as Periodo)} aria-label="Periodo">
          <option value={30}>Últimos 30 días</option>
          <option value={90}>Últimos 90 días</option>
          <option value={365}>Último año</option>
        </select>
        <select className="control" value={orden} onChange={(e) => setOrden(e.target.value as typeof orden)} aria-label="Ordenar">
          <option value="funciono">Lo que mejor les funcionó</option>
          <option value="reciente">Más recientes</option>
          <option value="likes">Más me gusta</option>
        </select>
      </div>

      {biblioteca.length ? (
        <div className="top-grilla">
          {biblioteca.slice(0, 60).map((p) => (
            <article className="top-pieza comp-lib" key={p.id}>
              <a className="top-media" href={p.permalink ?? undefined} target="_blank" rel="noreferrer">
                <Miniatura pieza={p} />
                {p.ratio !== null && p.ratio >= 1.5 ? <span className="top-rango">Le funcionó {p.ratio.toLocaleString("es-CL", { maximumFractionDigits: 1 })}x</span> : null}
                <span className="top-formato">@{p.cuenta} · {FORMATO[p.formato ?? ""] ?? "Post"}</span>
              </a>
              <div className="top-cuerpo">
                <p>{p.primera_linea || "Sin texto"}</p>
                <div className="top-mets">
                  <span title="Me gusta"><Icono nombre="like" size={12} /> {compacto(p.likes)}</span>
                  <span title="Comentarios"><Icono nombre="comentario" size={12} /> {compacto(p.comentarios)}</span>
                  <small>{fechaCorta(p.fecha)}</small>
                </div>
                <button className="btn" disabled={guardadas.has(p.id)} onClick={() => void guardarIdea(p)}>
                  {guardadas.has(p.id) ? "Guardada en tu banco" : "Guardar idea"}
                </button>
              </div>
            </article>
          ))}
        </div>
      ) : (
        <div className="card" style={{ padding: "var(--e5)", color: "var(--texto-2)" }}>
          {lista && !activas.length
            ? "Agrega tu primer competidor arriba. Sus mejores publicaciones aparecen aquí apenas termine el análisis."
            : analizando && !cuentas.length
              ? "Estamos analizando tus competidores. Sus publicaciones aparecen aquí apenas termine."
              : "No hay publicaciones con estos filtros."}
        </div>
      )}
    </div>
  );
}
