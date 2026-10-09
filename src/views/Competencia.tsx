import { useCallback, useEffect, useMemo, useState } from "react";
import { SinDatosSeccion } from "../components/states";
import { Badge, num, compacto, fechaCorta, NADA } from "../components/ui";
import { Icono } from "../components/icons";
import { ordenarCuentas, resumirCuenta } from "../lib/competencia";
import type { Analisis, PiezaCompetencia } from "../tipos";
import { guardarSugerencia, tema, type FormatoIdea } from "../lib/ideas";

type Periodo = 30 | 90 | 365;

const FORMATO: Record<string, string> = {
  REEL: "Reel",
  CARRUSEL: "Carrusel",
  IMAGEN: "Imagen",
  OTRO: "Otro",
};

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
}

interface Lista {
  filas?: Vigilada[];
  activos?: number;
  tope?: number;
  quedan?: number;
  nota?: string;
  error?: string;
  detalle?: string;
}

const ESTADO: Record<Vigilada["estado"], { texto: string; tono?: "oro" | "bien" | "mal" }> = {
  pendiente: { texto: "En cola" },
  analizando: { texto: "Analizando…", tono: "oro" },
  listo: { texto: "Analizada", tono: "bien" },
  error: { texto: "Error", tono: "mal" },
};

export function Competencia({ d, jwt }: { d: Analisis; jwt: string | null }) {
  const [lista, setLista] = useState<Lista | null>(null);
  const [cargando, setCargando] = useState(true);
  const [entrada, setEntrada] = useState("");
  const [guardando, setGuardando] = useState(false);
  const [msg, setMsg] = useState<{ tipo: "ok" | "error"; texto: string } | null>(null);
  const [periodo, setPeriodo] = useState<Periodo>(30);
  const [cuentaActiva, setCuentaActiva] = useState<string | null>(null);

  const cargar = useCallback(async () => {
    setCargando(true);
    try {
      const r = await fetch("/api/competidores", {
        headers: jwt ? { authorization: `Bearer ${jwt}` } : {},
      });
      setLista(await r.json());
    } catch (e) {
      setLista({ error: e instanceof Error ? e.message : String(e) });
    } finally {
      setCargando(false);
    }
  }, [jwt]);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  const agregar = async () => {
    if (!entrada.trim() || guardando) return;
    setGuardando(true);
    setMsg(null);
    try {
      const r = await fetch("/api/competidores", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(jwt ? { authorization: `Bearer ${jwt}` } : {}),
        },
        body: JSON.stringify({ username: entrada.trim() }),
      });
      const cuerpo = await r.json();
      // El error va visible con su causa. Nunca solo a la consola.
      if (cuerpo.error) setMsg({ tipo: "error", texto: cuerpo.error });
      else {
        setMsg({
          tipo: "ok",
          texto: `@${cuerpo.competidor?.username} agregada. Sus publicaciones aparecen mañana.`,
        });
        setEntrada("");
        await cargar();
      }
    } catch (e) {
      setMsg({ tipo: "error", texto: e instanceof Error ? e.message : String(e) });
    } finally {
      setGuardando(false);
    }
  };

  const alternar = async (v: Vigilada) => {
    setMsg(null);
    try {
    const r = await fetch("/api/competidores", {
      method: "PATCH",
      headers: {
        "content-type": "application/json",
        ...(jwt ? { authorization: `Bearer ${jwt}` } : {}),
      },
      body: JSON.stringify({ id: v.id, activa: !v.activa }),
    });
    const body = await r.json();
    if (!r.ok || body.error) throw new Error(body.error || "No se pudo actualizar.");
    await cargar();
    } catch(e) { setMsg({tipo:"error",texto:e instanceof Error ? e.message : "No se pudo actualizar."}); }
  };

  const [formato, setFormato] = useState<string | null>(null);
  const [orden, setOrden] = useState<"funciono" | "reciente" | "likes">("funciono");
  const [guardadas, setGuardadas] = useState<Set<string>>(new Set());

  const cuentas = useMemo(() => {
    const hoy = d.snapshot ? new Date(`${d.snapshot}T12:00:00Z`) : new Date();
    const filas = Object.entries(d.competencia?.cuentas ?? {}).map(([username, datos]) => ({
      username,
      datos,
      resumen: resumirCuenta(datos.piezas ?? [], hoy, periodo),
    }));
    return ordenarCuentas(filas);
  }, [d.competencia?.cuentas, d.snapshot, periodo]);

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

  const filas = lista?.filas ?? [];
  const tope = lista?.tope ?? 5;
  const activos = lista?.activos ?? 0;
  const lleno = activos >= tope;

  return (
    <div className="lista" style={{ gap: "var(--e5)" }}>
      <div className="comp-cuentas">
        {cuentas.map(({ username, datos, resumen }) => (
          <article className="card comp-mini" key={username} data-activa={cuentaActiva === username || undefined}>
            <button className="comp-mini-sel" onClick={() => setCuentaActiva(cuentaActiva === username ? null : username)} aria-pressed={cuentaActiva === username}>
              <strong>@{username}</strong>
              <span>{compacto(datos.seguidores ?? null)} seguidores · {resumen.porSemana == null ? NADA : `${resumen.porSemana.toLocaleString("es-CL")} posts/sem`}</span>
            </button>
            <a className="comp-mini-ads" href={`https://www.facebook.com/ads/library/?active_status=active&ad_type=all&country=ALL&q=${encodeURIComponent(username)}&search_type=keyword_unordered`} target="_blank" rel="noreferrer">
              Ver sus anuncios activos <Icono nombre="externo" size={11} />
            </a>
          </article>
        ))}
      </div>

      <div className="card filtros comp-filtros">
        <div className="chips" role="group" aria-label="Cuenta">
          <button className="chip" aria-pressed={cuentaActiva === null} onClick={() => setCuentaActiva(null)}>Todas</button>
          {cuentas.map((c) => <button key={c.username} className="chip" aria-pressed={cuentaActiva === c.username} onClick={() => setCuentaActiva(c.username)}>@{c.username}</button>)}
        </div>
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

      {msg?.tipo === "error" ? <div className="login-error" role="alert">{msg.texto}</div> : null}

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
        <div className="card" style={{ padding: "var(--e5)", color: "var(--texto-2)" }}>No hay publicaciones con estos filtros.</div>
      )}

      <details className="card comp-gestion">
        <summary>Cuentas que sigues ({num(activos)} de {num(tope)})</summary>
      {/* ---------- alta ---------- */}
      <div className="card" style={{ padding: "var(--e4)" }}>
        <div className="comp-alta">
          <div className="filtro-grupo" style={{ flex: 1, minWidth: 240 }}>
            <span className="filtro-lbl">Agregar competidor</span>
            <input
              aria-label="Agregar competidor"
              className="control"
              value={entrada}
              onChange={(e) => setEntrada(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void agregar();
              }}
              placeholder="instagram.com/usuario  ·  @usuario  ·  usuario"
              disabled={guardando || lleno}
            />
          </div>
          <button
            className="btn"
            data-variante="oro"
            onClick={() => void agregar()}
            disabled={guardando || lleno || !entrada.trim()}
            title={lleno ? `Ya tienes ${tope} competidores activos` : undefined}
          >
            <Icono nombre="competencia" size={14} />
            {guardando ? "Agregando…" : "Agregar"}
          </button>
          <div className="comp-cupo" data-lleno={lleno || undefined}>
            <strong>{num(activos)} / {num(tope)}</strong>
            <span>{lleno ? "cupo lleno" : `${num(lista?.quedan ?? 0)} disponibles`}</span>
          </div>
        </div>

        {msg ? (
          <div className={msg.tipo === "error" ? "login-error" : "comp-ok"} role="alert"
               style={{ marginTop: "var(--e3)" }}>
            <Icono nombre={msg.tipo === "error" ? "error" : "mesa"} size={15} />
            <span>{msg.texto}</span>
          </div>
        ) : null}

        <p className="comp-ayuda">Pega el perfil o el @usuario. La cuenta tiene que ser pública y de empresa o creador.</p>
      </div>

      {/* ---------- estado de captura ---------- */}
      {cargando && !filas.length ? (
        <div className="esq" style={{ height: 120 }} />
      ) : lista?.error ? (
        <SinDatosSeccion titulo="No se pudo leer la lista" porque={lista.error} />
      ) : !filas.length ? (
        <SinDatosSeccion
          titulo="Todavía no hay competidores"
          porque="Agrega la primera cuenta arriba. Su contenido aparece al día siguiente."
        />
      ) : (
        <div className="tabla-caja">
          <table>
            <thead>
              <tr>
                <th>Cuenta</th>
                <th>Estado</th>
                <th>Analizada</th>
                <th className="n">Seguidores</th>
                <th className="n">Piezas</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {filas.map((v) => {
                const datos = d.competencia?.cuentas?.[v.username];
                const e = ESTADO[v.estado];
                return (
                  <tr key={v.id} style={{ opacity: v.activa ? 1 : 0.45 }}>
                    <td>
                      <a href={v.url ?? `https://instagram.com/${v.username}`} target="_blank" rel="noreferrer">
                        @{v.username}
                      </a>
                      {v.nombre ? (
                        <div style={{ fontSize: 11, color: "var(--texto-3)" }}>{v.nombre}</div>
                      ) : null}
                      {v.nota ? (
                        <details className="comp-nota">
                          <summary>Investigación</summary>
                          <p>{v.nota}</p>
                        </details>
                      ) : null}
                      {v.estado === "error" && v.ultimo_error ? (
                        <div style={{ fontSize: 11, color: "var(--mal)", whiteSpace: "normal", maxWidth: 380 }}>
                          {v.ultimo_error}
                        </div>
                      ) : null}
                    </td>
                    <td><Badge tono={e.tono}>{e.texto}</Badge></td>
                    <td>{v.analizada_en ? fechaCorta(v.analizada_en) : NADA}</td>
                    <td className="n">{compacto(datos?.seguidores ?? null)}</td>
                    <td className="n">{num(datos?.n_muestra ?? null)}</td>
                    <td>
                      <button className="chip" onClick={() => void alternar(v)}>
                        {v.activa ? "Desactivar" : "Activar"}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      </details>

      {/* La exploración visual de piezas vive arriba; esta tabla operativa se mantiene
          para diagnosticar cola, errores y activar/desactivar cuentas. */}
    </div>
  );
}
