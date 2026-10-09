import { lazy, Suspense, useEffect, useState } from "react";
import { useApi } from "./hooks/useApi";
import { useSesion } from "./hooks/useSesion";
import { Login } from "./components/Login";
import { Vista, EsqueletoGrilla } from "./components/states";
import { Icono, type NombreIcono } from "./components/icons";
const Resumen = lazy(() => import("./views/Resumen").then(m => ({ default: m.Resumen })));
const Piezas = lazy(() => import("./views/Piezas").then(m => ({ default: m.Piezas })));
const Calendario = lazy(() => import("./views/Calendario").then(m => ({ default: m.Calendario })));
const PalabraClave = lazy(() => import("./views/PalabraClave").then(m => ({ default: m.PalabraClave })));
const Historias = lazy(() => import("./views/Historias").then(m => ({ default: m.Historias })));
const Competencia = lazy(() => import("./views/Competencia").then(m => ({ default: m.Competencia })));
const Audiencia = lazy(() => import("./views/Audiencia").then(m => ({ default: m.Audiencia })));
const Anuncios = lazy(() => import("./views/Anuncios").then(m => ({ default: m.Anuncios })));
const Negocio = lazy(() => import("./views/Negocio").then(m => ({ default: m.Negocio })));
const Mesa = lazy(() => import("./views/Mesa").then(m => ({ default: m.Mesa })));
import type { Analisis, Rol } from "./tipos";

type Seccion = "resumen" | "calendario" | "piezas" | "palabra-clave" | "historias" | "competencia" | "audiencia" | "anuncios" | "mesa" | "negocio";

const SECCIONES: { id: Seccion; texto: string; icono: NombreIcono; pregunta: string }[] = [
  { id: "negocio", texto: "Negocio", icono: "resumen", pregunta: "Cuánto vendiste y cuánto costó conseguirlo." },
  { id: "resumen", texto: "Resumen", icono: "resumen", pregunta: "Cómo le está yendo a tu cuenta." },
  {
    id: "calendario",
    texto: "Calendario",
    icono: "historias",
    pregunta: "Todo lo que publicaste, día por día.",
  },
  { id: "piezas", texto: "Piezas", icono: "piezas", pregunta: "Que funciono de verdad, ordenable y filtrable." },
  {
    id: "palabra-clave",
    texto: "Palabra clave",
    icono: "comentario",
    pregunta: "Que efecto tiene pedir palabra clave y cuantas hay en circulacion.",
  },
  { id: "historias", texto: "Historias", icono: "historias", pregunta: "Que historia retuvo y llevo al perfil." },
  { id: "competencia", texto: "Competencia", icono: "competencia", pregunta: "Como se compara con otras cuentas." },
  { id: "audiencia", texto: "Audiencia", icono: "audiencia", pregunta: "Quien sigue la cuenta y de donde." },
  { id: "anuncios", texto: "Anuncios", icono: "competencia", pregunta: "Cuanto cuesta cada conversacion y que creativo la trae." },
  { id: "mesa", texto: "Mesa de trabajo", icono: "mesa", pregunta: "Que conviene volver a hacer." },
];

const ROLES: { id: Rol; texto: string; nota: string; entrada: Seccion }[] = [
  {
    id: "direccion",
    texto: "Direccion",
    nota: "Iann: entra por el resumen y ordena por multiplicador, que es lo que dice si una pieza rindio sobre lo normal de su formato.",
    entrada: "resumen",
  },
  {
    id: "contenido",
    texto: "Contenido",
    nota: "Leo: entra por la mesa de trabajo, que dice que volver a producir, y ordena las piezas por tasa de guardado.",
    entrada: "mesa",
  },
];

export default function App() {
  const s = useSesion();
  const jwt = s.sesion?.access_token ?? null;

  const [rol, setRol] = useState<Rol>("direccion");
  const [seccion, setSeccion] = useState<Seccion>(() => {
    const value = window.location.hash.slice(1);
    return SECCIONES.some(s=>s.id===value) ? value as Seccion : "resumen";
  });
  useEffect(() => {
    const navegar = () => { const id=window.location.hash.slice(1); if(SECCIONES.some(s=>s.id===id))setSeccion(id as Seccion); };
    window.addEventListener('hashchange',navegar);return ()=>window.removeEventListener('hashchange',navegar);
  }, []);
  const estado = useApi<Analisis>(`/api/analisis?seccion=${seccion}`, jwt);
  const elegir = (id: Seccion) => { setSeccion(id); window.history.replaceState(null,"",`#${id}`); };

  // Puerta de entrada. `cargando` sin sesion es el arranque: preguntarle a
  // Supabase si ya hay una. Sin esta espera, el login parpadea en cada recarga.
  if (s.cargando && !s.sesion) {
    return <div className="login"><div className="esq" style={{ width: 360, height: 300 }} /></div>;
  }
  if (!s.sesion) return <Login s={s} />;

  const actual = SECCIONES.find((x) => x.id === seccion)!;

  const cambiarRol = (r: Rol) => {
    setRol(r);
    elegir(ROLES.find((x) => x.id === r)!.entrada);
  };

  return (
    <div className="app" key={s.sesion.user.id}>
      <nav className="lateral">
        <div className="marca">
          <div className="marca-punto">P</div>
          <div>
            <div className="marca-txt">Prime Club</div>
            <div className="marca-sub">Panel de Leo</div>
          </div>
        </div>

        <div className="nav">
          {SECCIONES.map((s) => (
            <button key={s.id} aria-current={seccion === s.id} onClick={() => elegir(s.id)}>
              <Icono nombre={s.icono} size={15} />
              {s.texto}
            </button>
          ))}
        </div>

        <div className="rol">
          <div className="rol-lbl">Punto de vista</div>
          <div className="rol-ops">
            {ROLES.map((r) => (
              <button key={r.id} aria-pressed={rol === r.id} onClick={() => cambiarRol(r.id)}>
                {r.texto}
              </button>
            ))}
          </div>

          <div className="usuario-pie">
            <span>{s.sesion.user.email}</span>
            <button onClick={() => void s.salir()}>Salir</button>
          </div>
        </div>
      </nav>

      <main className="principal">
        <header className="cabecera">
          <div>
            <h1>{actual.texto}</h1>
            <p>{actual.pregunta}</p>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "var(--e3)" }}>
            {estado.actualizado ? (
              <span title="Hora de lectura del dashboard; no sincroniza Instagram" style={{ fontSize: 12, color: "var(--texto-3)" }}>
                <Icono nombre="reloj" size={12} />{" "}
                {estado.actualizado.toLocaleTimeString("es-CL", { hour: "2-digit", minute: "2-digit" })}
              </span>
            ) : null}
            <button className="btn" onClick={estado.recargar} disabled={estado.cargando}>
              <Icono nombre="refrescar" size={14} />
              {estado.cargando ? "Cargando…" : "Volver a cargar"}
            </button>
          </div>
        </header>

        <Suspense fallback={<EsqueletoGrilla />}><Vista estado={estado} esqueleto={seccion === "piezas" ? <EsqueletoGrilla /> : undefined}>
          {(d) => {
            switch (seccion) {
              case "resumen":
                return <Resumen d={d} />;
              case "calendario":
                return <Calendario d={d} />;
              case "piezas":
                return <Piezas d={d} rol={rol} jwt={jwt} />;
              case "palabra-clave":
                return <PalabraClave d={d} />;
              case "historias":
                return <Historias d={d} />;
              case "competencia":
                return <Competencia key={s.sesion?.user.id} d={d} jwt={jwt} />;
              case "audiencia":
                return <Audiencia d={d} />;
              case "anuncios":
                return <Anuncios d={d} />;
              case "negocio":
                return <Negocio d={d} />;
              case "mesa":
                return <Mesa key={s.sesion?.user.id} d={d} jwt={jwt} />;
            }
          }}
        </Vista></Suspense>
      </main>
    </div>
  );
}
