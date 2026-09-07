import { useCallback, useEffect, useState } from "react";
import { SinDatosSeccion } from "../components/states";
import { Base, Nota, Badge, num, pct, compacto, fechaCorta, NADA } from "../components/ui";
import { Icono } from "../components/icons";
import type { Analisis } from "../tipos";

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

  const cuentas = Object.entries(d.competencia?.cuentas ?? {});
  const filas = lista?.filas ?? [];
  const tope = lista?.tope ?? 5;
  const activos = lista?.activos ?? 0;
  const lleno = activos >= tope;

  return (
    <div className="lista" style={{ gap: "var(--e5)" }}>
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

      {/* ---------- lista ---------- */}
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

      {/* ---------- contenido analizado ---------- */}
      {cuentas.map(([u, c]) =>
        c.error ? null : (
          <section key={u}>
            <h2 style={{ fontSize: 18, marginBottom: "var(--e3)" }}>
              @{c.username ?? u} <Badge>{num(c.n_muestra ?? null)} piezas</Badge>
            </h2>
            <div className="tabla-caja">
              <table>
                <thead>
                  <tr>
                    <th>Fecha</th>
                    <th>Primera línea</th>
                    <th className="n">Likes</th>
                    <th className="n">Comentarios</th>
                    <th className="n">Interacción / seguidores</th>
                  </tr>
                </thead>
                <tbody>
                  {(c.piezas ?? []).slice(0, 30).map((p) => (
                    <tr key={p.id}>
                      <td>{fechaCorta(p.fecha)}</td>
                      <td style={{ whiteSpace: "normal", minWidth: 260, maxWidth: 460 }}>
                        {p.primera_linea || NADA}
                      </td>
                      <td className="n">{compacto(p.likes)}</td>
                      <td className="n">{compacto(p.comentarios)}</td>
                      <td className="n">{pct(p.interaccion_sobre_seguidores_pct, 3)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Base>
              Sin alcance ni guardados: la API no los entrega de cuentas ajenas. La comparación
              honesta con esta fuente es interacción sobre base de seguidores, y sirve para leer
              tendencia y tema — no para replicar un ranking.
            </Base>
          </section>
        )
      )}
    </div>
  );
}
