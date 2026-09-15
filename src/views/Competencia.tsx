import { useCallback, useEffect, useMemo, useState } from "react";
import { SinDatosSeccion } from "../components/states";
import { Base, Nota, Badge, num, pct, compacto, fechaCorta, NADA } from "../components/ui";
import { Icono } from "../components/icons";
import { ordenarCuentas, resumirCuenta } from "../lib/competencia";
import type { Analisis, PiezaCompetencia } from "../tipos";

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
          texto: `@${cuerpo.competidor?.username} agregada. Queda en cola: el análisis corre con ` +
            `el servicio de captura`,
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

  const cuentas = useMemo(() => {
    const hoy = d.snapshot ? new Date(`${d.snapshot}T12:00:00Z`) : new Date();
    const filas = Object.entries(d.competencia?.cuentas ?? {}).map(([username, datos]) => ({
      username,
      datos,
      resumen: resumirCuenta(datos.piezas ?? [], hoy, periodo),
    }));
    return ordenarCuentas(filas);
  }, [d.competencia?.cuentas, d.snapshot, periodo]);
  const medianas = cuentas.map((x) => x.resumen.mediana).filter((x): x is number => x !== null).sort((a, b) => a - b);
  const medianaMercado = medianas.length
    ? medianas.length % 2
      ? medianas[Math.floor(medianas.length / 2)]
      : (medianas[medianas.length / 2 - 1] + medianas[medianas.length / 2]) / 2
    : null;
  const piezasVisibles = cuentaActiva
    ? cuentas.find((x) => x.username === cuentaActiva)?.datos.piezas ?? []
    : [];
  const filas = lista?.filas ?? [];
  const tope = lista?.tope ?? 5;
  const activos = lista?.activos ?? 0;
  const lleno = activos >= tope;

  return (
    <div className="lista" style={{ gap: "var(--e5)" }}>
      <section className="comp-hero card">
        <div>
          <span className="kpi-lbl">Radar competitivo</span>
          <h2>Compara señales públicas, sin inventar métricas privadas</h2>
          <p>Instagram entrega likes, comentarios y seguidores de cuentas Business/Creator públicas. El panel normaliza esas señales como interacción sobre seguidores.</p>
        </div>
        <label className="filtro-grupo">
          <span className="filtro-lbl">Ventana comparable</span>
          <select className="control" value={periodo} onChange={(e) => setPeriodo(Number(e.target.value) as Periodo)}>
            <option value={30}>Últimos 30 días</option>
            <option value={90}>Últimos 90 días</option>
            <option value={365}>Últimos 12 meses</option>
          </select>
        </label>
      </section>

      <div className="kpis">
        <div className="card kpi"><div className="kpi-lbl"><Icono nombre="competencia" size={13} /> Cuentas activas</div><div className="kpi-val num">{num(cuentas.length)}</div><div className="kpi-pie">{num(activos)} de {num(tope)} cupos usados</div></div>
        <div className="card kpi"><div className="kpi-lbl"><Icono nombre="alcance" size={13} /> Mediana del mercado</div><div className="kpi-val num">{pct(medianaMercado, 3)}</div><div className="kpi-pie">interacción / seguidores en {periodo} días</div></div>
        <div className="card kpi"><div className="kpi-lbl"><Icono nombre="piezas" size={13} /> Piezas medidas</div><div className="kpi-val num">{num(cuentas.reduce((s, x) => s + x.resumen.medidas, 0))}</div><div className="kpi-pie">solo publicaciones con señal disponible</div></div>
        <div className="card kpi"><div className="kpi-lbl"><Icono nombre="reloj" size={13} /> Mayor cadencia</div><div className="kpi-val num">{cuentas.length ? `${cuentas.reduce((m, x) => Math.max(m, x.resumen.porSemana ?? 0), 0).toLocaleString("es-CL", { maximumFractionDigits: 1 })}/sem` : NADA}</div><div className="kpi-pie">ritmo observado en la ventana</div></div>
      </div>

      {cuentas.length ? (
        <section>
          <div className="comp-seccion-cab"><div><span className="kpi-lbl">Benchmark</span><h2>Quién está ganando atención</h2></div><Base>{num(cuentas.length)} cuentas · ordenadas por interacción mediana</Base></div>
          <div className="comp-comparativa">
            {cuentas.map(({ username, datos, resumen }, i) => {
              const max = Math.max(...cuentas.map((x) => x.resumen.mediana ?? 0), 0.0001);
              return (
                <article className="card comp-cuenta" key={username} data-activa={cuentaActiva === username || undefined}>
                  <div className="comp-cuenta-top"><span className="comp-pos">#{i + 1}</span><Badge tono={i === 0 ? "oro" : undefined}>{resumen.publicadas} piezas / {periodo}d</Badge></div>
                  <a className="comp-usuario" href={`https://instagram.com/${username}`} target="_blank" rel="noreferrer">@{username}</a>
                  <div className="comp-seguidores">{compacto(datos.seguidores ?? null)} seguidores</div>
                  <div className="comp-dato"><strong>{pct(resumen.mediana, 3)}</strong><span>interacción mediana</span></div>
                  <div className="barra comp-barra"><span style={{ width: `${((resumen.mediana ?? 0) / max) * 100}%` }} /></div>
                  <div className="comp-meta"><span>{resumen.porSemana == null ? NADA : `${resumen.porSemana.toLocaleString("es-CL")}/sem`}</span><span>{num(resumen.medidas)} medidas</span></div>
                  <button className="btn comp-ver" onClick={() => setCuentaActiva(cuentaActiva === username ? null : username)}>{cuentaActiva === username ? "Ocultar piezas" : "Ver mejores piezas"}</button>
                </article>
              );
            })}
          </div>
        </section>
      ) : null}

      {cuentaActiva ? (
        <section className="comp-explorador">
          <div className="comp-seccion-cab"><div><span className="kpi-lbl">Contenido analizado</span><h2>@{cuentaActiva}</h2></div><button className="chip" onClick={() => setCuentaActiva(null)}>Cerrar</button></div>
          <div className="comp-piezas-grid">
            {[...piezasVisibles].sort((a, b) => (b.interaccion_sobre_seguidores_pct ?? -1) - (a.interaccion_sobre_seguidores_pct ?? -1)).slice(0, 12).map((p) => (
              <a className="comp-pieza" href={p.permalink ?? undefined} target="_blank" rel="noreferrer" key={p.id}>
                <div className="comp-pieza-media"><Miniatura pieza={p} /><Badge>{FORMATO[p.formato ?? ""] ?? p.formato ?? "Pieza"}</Badge></div>
                <div className="comp-pieza-cuerpo"><p>{p.primera_linea || "Sin texto disponible"}</p><div className="comp-pieza-metricas"><span>♥ {compacto(p.likes)}</span><span>◌ {compacto(p.comentarios)}</span><strong>{pct(p.interaccion_sobre_seguidores_pct, 3)}</strong></div><Base>{fechaCorta(p.fecha)}</Base></div>
              </a>
            ))}
          </div>
        </section>
      ) : null}

      {/* ---------- alta ---------- */}
      <div className="card" style={{ padding: "var(--e4)" }}>
        <div className="comp-alta">
          <div className="filtro-grupo" style={{ flex: 1, minWidth: 240 }}>
            <span className="filtro-lbl">Agregar competidor</span>
            <input
              aria-label="Agregar competidor"
              className="comp-input"
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

        <Base>
          Acepta la URL del perfil, el @usuario o el usuario pelado. La cuenta tiene que ser{" "}
          <b>Business o Creator y pública</b> — con una cuenta personal o privada, Instagram no
          devuelve nada y el estado queda en Error con la razón escrita. El tope de {num(tope)} lo
          impone la base de datos, no esta pantalla.
        </Base>
      </div>

      {/* ---------- estado de captura ---------- */}
      {cargando && !filas.length ? (
        <div className="esq" style={{ height: 120 }} />
      ) : lista?.error ? (
        <SinDatosSeccion titulo="No se pudo leer la lista" porque={lista.error} />
      ) : !filas.length ? (
        <SinDatosSeccion
          titulo="Todavía no hay competidores"
          porque="Agrega el primero arriba. Después corre `el servicio de captura` para que traiga su contenido."
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

      <Nota>{lista?.nota ?? d.competencia?.nota}</Nota>

      {/* La exploración visual de piezas vive arriba; esta tabla operativa se mantiene
          para diagnosticar cola, errores y activar/desactivar cuentas. */}
    </div>
  );
}
