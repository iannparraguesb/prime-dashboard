import { useCallback, useEffect, useMemo, useState } from "react";
import { Badge } from "../components/ui";
import { Icono } from "../components/icons";
import {
  COLUMNAS, FORMATOS, NOMBRE_FORMATO_IDEA, enviarIdea, guardarSugerencia, origenTexto,
  type EstadoIdea, type FormatoIdea, type Idea, type Sugerencia,
} from "../lib/ideas";
import type { Analisis } from "../tipos";

type Vista = "sugerencias" | "banco";

export function Mesa({ jwt }: { d: Analisis; jwt: string | null }) {
  const [vista, setVista] = useState<Vista>("sugerencias");
  const [formato, setFormato] = useState<FormatoIdea | null>(null);
  const [ideas, setIdeas] = useState<Idea[] | null>(null);
  const [puedeEditar, setPuedeEditar] = useState(false);
  const [sugs, setSugs] = useState<Sugerencia[]>([]);
  const [quedan, setQuedan] = useState(0);
  const [cargandoSugs, setCargandoSugs] = useState(false);
  const [aviso, setAviso] = useState<{ tipo: "ok" | "error"; texto: string } | null>(null);

  const auth = useMemo((): Record<string, string> => (jwt ? { authorization: `Bearer ${jwt}` } : {}), [jwt]);

  const cargarIdeas = useCallback(async () => {
    try {
      const r = await fetch("/api/ideas", { headers: auth });
      const d = await r.json();
      if (!r.ok || d.error) throw new Error(d.error);
      setIdeas(d.filas);
      setPuedeEditar(Boolean(d.puede_editar));
    } catch (e) {
      setAviso({ tipo: "error", texto: e instanceof Error && e.message ? e.message : "No se pudo cargar el banco." });
      setIdeas([]);
    }
  }, [auth]);

  const cargarSugs = useCallback(async (desde: number, reemplazar: boolean) => {
    setCargandoSugs(true);
    try {
      const q = new URLSearchParams({ desde: String(desde) });
      if (formato) q.set("formato", formato);
      const r = await fetch(`/api/ideas/sugerencias?${q}`, { headers: auth });
      const d = await r.json();
      if (!r.ok || d.error) throw new Error(d.error);
      setSugs((prev) => (reemplazar ? d.filas : [...prev, ...d.filas]));
      setQuedan(d.quedan);
    } catch (e) {
      setAviso({ tipo: "error", texto: e instanceof Error && e.message ? e.message : "No se pudieron cargar las sugerencias." });
    } finally {
      setCargandoSugs(false);
    }
  }, [auth, formato]);

  useEffect(() => { void cargarIdeas(); }, [cargarIdeas]);
  useEffect(() => { void cargarSugs(0, true); }, [cargarSugs]);

  const accion = async (fn: () => Promise<unknown>, ok: string) => {
    setAviso(null);
    try {
      await fn();
      setAviso({ tipo: "ok", texto: ok });
      await cargarIdeas();
    } catch (e) {
      setAviso({ tipo: "error", texto: e instanceof Error ? e.message : "No se pudo guardar." });
    }
  };

  const decidir = (s: Sugerencia, estado: EstadoIdea) => {
    setSugs((prev) => prev.filter((x) => x.clave !== s.clave));
    void accion(() => guardarSugerencia(jwt, s, estado), estado === "descartada" ? "Descartada. No vuelve a aparecer." : "Guardada en tu banco.");
  };

  const visibles = (ideas ?? []).filter((i) => !formato || i.formato === formato);
  const enBanco = (ideas ?? []).length;

  return (
    <div className="lista" style={{ gap: "var(--e4)" }}>
      <div className="neg-cabecera">
        <div className="chips" role="tablist">
          <button className="chip" role="tab" aria-pressed={vista === "sugerencias"} onClick={() => setVista("sugerencias")}>
            Ideas para ti
          </button>
          <button className="chip" role="tab" aria-pressed={vista === "banco"} onClick={() => setVista("banco")}>
            Mi banco <span className="chip-n">{enBanco}</span>
          </button>
        </div>
        <div className="chips" role="group" aria-label="Formato">
          <button className="chip" aria-pressed={formato === null} onClick={() => setFormato(null)}>Todo</button>
          {FORMATOS.map((f) => (
            <button key={f.v} className="chip" aria-pressed={formato === f.v} onClick={() => setFormato(f.v)}>{f.plural}</button>
          ))}
        </div>
      </div>

      {aviso ? <div className={aviso.tipo === "error" ? "login-error" : "comp-ok"} role="status">{aviso.texto}</div> : null}

      {vista === "sugerencias" ? (
        <>
          <div className="ideas-grilla">
            {sugs.map((s) => (
              <article className="card idea-card" key={s.clave}>
                <div className="idea-top">
                  <Badge tono="oro">{NOMBRE_FORMATO_IDEA[s.formato]}</Badge>
                  <span className="idea-origen">{origenTexto(s)}</span>
                </div>
                {s.referencia_thumb ? (
                  <a className="idea-ref" href={s.referencia_url ?? undefined} target="_blank" rel="noreferrer">
                    <img src={s.referencia_thumb} alt="" loading="lazy" />
                    <span>Ver referencia <Icono nombre="externo" size={11} /></span>
                  </a>
                ) : null}
                <h3>{s.titulo}</h3>
                <p className="idea-hook">“{s.hook}”</p>
                <p className="idea-motivo">{s.motivo}</p>
                {puedeEditar ? (
                  <div className="idea-acciones">
                    <button className="btn btn-primario" onClick={() => decidir(s, "idea")}>Guardar</button>
                    <button className="btn" onClick={() => decidir(s, "descartada")}>Descartar</button>
                  </div>
                ) : null}
              </article>
            ))}
            {cargandoSugs && !sugs.length ? Array.from({ length: 6 }, (_, k) => <div key={k} className="esq" style={{ height: 220 }} />) : null}
          </div>
          {!cargandoSugs && !sugs.length ? (
            <div className="card" style={{ padding: "var(--e5)", color: "var(--texto-2)" }}>Ya revisaste todas las ideas de este formato. Vuelve mañana: se suman nuevas a medida que publicas y que la competencia publica.</div>
          ) : null}
          {quedan > 0 ? (
            <button className="btn ideas-mas" disabled={cargandoSugs} onClick={() => void cargarSugs(sugs.length, false)}>
              {cargandoSugs ? "Cargando…" : `Ver más ideas (${quedan})`}
            </button>
          ) : null}
        </>
      ) : (
        <>
          {puedeEditar ? <NuevaIdea onGuardar={(c) => accion(() => enviarIdea(jwt, "POST", c), "Idea agregada.")} formato={formato} /> : null}
          <div className="tablero">
            {COLUMNAS.map((col, k) => {
              const items = visibles.filter((i) => i.estado === col.v);
              return (
                <section className="tablero-col" key={col.v}>
                  <h3>{col.t} <span className="chip-n">{items.length}</span></h3>
                  {items.map((i) => (
                    <TarjetaIdea
                      key={i.id} i={i} editable={puedeEditar}
                      siguiente={COLUMNAS[k + 1]?.v} anterior={COLUMNAS[k - 1]?.v}
                      mover={(estado) => accion(() => enviarIdea(jwt, "PATCH", { id: i.id, estado }), estado === "descartada" ? "Idea descartada." : "Idea movida.")}
                      guardarNota={(nota) => accion(() => enviarIdea(jwt, "PATCH", { id: i.id, nota: nota || null }), "Nota guardada.")}
                    />
                  ))}
                  {!items.length ? <p className="tablero-vacio">Nada aquí todavía.</p> : null}
                </section>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

function NuevaIdea({ onGuardar, formato }: { onGuardar: (c: object) => Promise<void>; formato: FormatoIdea | null }) {
  const [titulo, setTitulo] = useState("");
  const [f, setF] = useState<FormatoIdea>(formato ?? "historia");
  const [hook, setHook] = useState("");
  const [ocupado, setOcupado] = useState(false);
  return (
    <form
      className="card idea-nueva"
      onSubmit={async (e) => {
        e.preventDefault();
        if (!titulo.trim() || ocupado) return;
        setOcupado(true);
        await onGuardar({ titulo: titulo.trim(), formato: f, hook: hook.trim() || null });
        setTitulo(""); setHook(""); setOcupado(false);
      }}
    >
      <input className="control" value={titulo} maxLength={200} onChange={(e) => setTitulo(e.target.value)} placeholder="Anota una idea…" aria-label="Idea" />
      <input className="control" value={hook} maxLength={300} onChange={(e) => setHook(e.target.value)} placeholder="Hook (opcional)" aria-label="Hook" />
      <select className="control" value={f} onChange={(e) => setF(e.target.value as FormatoIdea)} aria-label="Formato">
        {FORMATOS.map((x) => <option key={x.v} value={x.v}>{x.t}</option>)}
      </select>
      <button className="btn btn-primario" disabled={ocupado || !titulo.trim()}>{ocupado ? "Guardando…" : "Agregar"}</button>
    </form>
  );
}

function TarjetaIdea({ i, editable, siguiente, anterior, mover, guardarNota }: {
  i: Idea; editable: boolean; siguiente?: EstadoIdea; anterior?: EstadoIdea;
  mover: (e: EstadoIdea) => void; guardarNota: (n: string) => void;
}) {
  const [nota, setNota] = useState(i.nota ?? "");
  return (
    <article className="card tablero-tarjeta">
      <div className="idea-top">
        <Badge tono="oro">{NOMBRE_FORMATO_IDEA[i.formato]}</Badge>
        {i.referencia_url ? <a className="idea-origen" href={i.referencia_url} target="_blank" rel="noreferrer">{origenTexto(i)} <Icono nombre="externo" size={11} /></a> : <span className="idea-origen">{origenTexto(i)}</span>}
      </div>
      <h4>{i.titulo}</h4>
      {i.hook ? <p className="idea-hook">“{i.hook}”</p> : null}
      <details className="tablero-nota">
        <summary>{i.nota ? "Guion y notas" : "Agregar guion o notas"}</summary>
        {editable ? (
          <>
            <textarea className="control" rows={4} maxLength={3000} value={nota} onChange={(e) => setNota(e.target.value)} placeholder="Guion, visual, CTA…" />
            <button className="btn" disabled={nota === (i.nota ?? "")} onClick={() => guardarNota(nota)}>Guardar nota</button>
          </>
        ) : <p>{i.nota}</p>}
      </details>
      {editable ? (
        <div className="idea-acciones">
          {anterior ? <button className="btn" onClick={() => mover(anterior)} aria-label="Volver a la etapa anterior">←</button> : null}
          {siguiente ? <button className="btn btn-primario" onClick={() => mover(siguiente)}>{siguiente === "publicada" ? "Marcar publicada" : "Avanzar →"}</button> : null}
          <button className="btn idea-descartar" onClick={() => mover("descartada")} aria-label="Descartar idea">Descartar</button>
        </div>
      ) : null}
    </article>
  );
}
