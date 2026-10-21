import { lazy, Suspense, useEffect, useState } from "react";
import { useApi } from "./hooks/useApi";
import { useYo } from "./hooks/useYo";
import { useTema } from "./hooks/useTema";
import { ConectarInstagram, RegresoInstagram } from "./views/Instagram";
import { useSesion } from "./hooks/useSesion";
import { Login } from "./components/Login";
import { BarraSuperior } from "./components/BarraSuperior";
import { Vista, EsqueletoGrilla, Pronto } from "./components/states";
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
const Alumnos = lazy(() => import("./views/Alumnos").then(m => ({ default: m.Alumnos })));
const Mesa = lazy(() => import("./views/Mesa").then(m => ({ default: m.Mesa })));
import type { Analisis, Rol } from "./tipos";

type Seccion = "resumen" | "calendario" | "piezas" | "palabra-clave" | "historias" | "competencia" | "audiencia" | "anuncios" | "mesa" | "negocio" | "instagram" | "alumnos";

const SECCIONES: { id: Seccion; texto: string; icono: NombreIcono; pregunta: string }[] = [
  { id: "resumen", texto: "Dashboard", icono: "resumen", pregunta: "Resumen global de tu marca personal." },
  { id: "calendario", texto: "Calendario", icono: "calendario", pregunta: "Todo lo que publicaste, día por día." },
  { id: "piezas", texto: "Publicaciones", icono: "piezas", pregunta: "Qué funcionó de verdad. Busca, filtra y ordena." },
  { id: "historias", texto: "Historias", icono: "historias", pregunta: "Qué historia retuvo y llevó gente al perfil." },
  { id: "audiencia", texto: "Tu audiencia", icono: "audiencia", pregunta: "Quién te sigue y desde dónde." },
  { id: "negocio", texto: "Ventas", icono: "dinero", pregunta: "Cuánto vendiste, de dónde vino y cuánto costó conseguirlo." },
  { id: "anuncios", texto: "Anuncios", icono: "megafono", pregunta: "Cuánto cuesta cada conversación y qué creativo la trae." },
  { id: "mesa", texto: "Mesa de trabajo", icono: "idea", pregunta: "Ideas para tu próxima publicación." },
  { id: "competencia", texto: "Espía", icono: "competencia", pregunta: "Lo que publica tu competencia y qué le funciona." },
  { id: "palabra-clave", texto: "Palabra clave", icono: "etiqueta", pregunta: "Qué pasa cuando pides comentar una palabra." },
  { id: "instagram", texto: "Mi Instagram", icono: "imagen", pregunta: "Tu cuenta conectada y qué datos vemos." },
  { id: "alumnos", texto: "Alumnos", icono: "perfil", pregunta: "Quién puede crear su cuenta en el panel." },
];

/** Menu como el de Moka: una lista plana con lo de todos los dias; abajo, las
 *  herramientas de consulta ocasional y los ajustes. */
const PRINCIPAL: Seccion[] = ["resumen", "piezas", "historias", "competencia", "audiencia", "negocio", "anuncios", "mesa"];
const HERRAMIENTAS: Seccion[] = ["calendario", "palabra-clave"];
const AJUSTES: Seccion[] = ["alumnos", "instagram"];

/** Lo que ve un alumno: su contenido y su conexion. Nada del negocio de Leo. */
const DEL_ALUMNO: Seccion[] = ["resumen", "calendario", "piezas", "historias", "audiencia", "instagram"];
/** En el menu del alumno pero todavia cerradas: muestran "Pronto" y no piden datos. */
const PRONTO_ALUMNO: Seccion[] = ["competencia"];

const ROLES: { id: Rol; texto: string; entrada: Seccion }[] = [
  { id: "direccion", texto: "Dirección", entrada: "resumen" },
  { id: "contenido", texto: "Contenido", entrada: "mesa" },
];

export default function App() {
  const s = useSesion();
  const jwt = s.sesion?.access_token ?? null;
  const { tema, alternar } = useTema();

  const [rol, setRol] = useState<Rol>("direccion");
  const [verMasManual, setVerMas] = useState(false);
  const [seccion, setSeccion] = useState<Seccion>(() => {
    const value = window.location.hash.slice(1);
    return SECCIONES.some(s=>s.id===value) ? value as Seccion : "resumen";
  });
  useEffect(() => {
    const navegar = () => { const id=window.location.hash.slice(1); if(SECCIONES.some(s=>s.id===id))setSeccion(id as Seccion); };
    window.addEventListener('hashchange',navegar);return ()=>window.removeEventListener('hashchange',navegar);
  }, []);
  const { yo, error: errorYo, recargar: recargarYo } = useYo(jwt);
  const esAlumno = yo?.tipo === "alumno";
  const conectado = !!yo?.instagram && ["activa", "vencida", "error"].includes(yo.instagram.estado);
  // Invitar alumnos es solo de admin: el resto del equipo ni ve la entrada.
  const permitida = (id: Seccion) => (esAlumno ? DEL_ALUMNO.includes(id) : id !== "instagram" && (id !== "alumnos" || yo?.rol === "admin"));
  const enMenu = (id: Seccion) => permitida(id) || (esAlumno && PRONTO_ALUMNO.includes(id));
  // Un alumno sin Instagram conectado no tiene datos que mostrar: va directo a conectar.
  const vista: Seccion = esAlumno
    ? (!conectado ? "instagram" : enMenu(seccion) ? seccion : "resumen")
    : permitida(seccion) ? seccion : "resumen";
  const pronto = esAlumno && PRONTO_ALUMNO.includes(vista);
  // Estas vistas no leen /api/analisis: cada una trae lo suyo, o nada todavia.
  const sinAnalisis = vista === "instagram" || vista === "alumnos" || pronto;
  const estado = useApi<Analisis>(`/api/analisis?seccion=${vista}`, yo && !sinAnalisis ? jwt : null);
  const elegir = (id: Seccion) => { setSeccion(id); window.history.replaceState(null,"",`#${id}`); window.scrollTo({ top: 0 }); };

  // Puerta de entrada. `cargando` sin sesion es el arranque: preguntarle a
  // Supabase si ya hay una. Sin esta espera, el login parpadea en cada recarga.
  if (s.cargando && !s.sesion) {
    return <div className="login"><div className="esq" style={{ width: 360, height: 300 }} /></div>;
  }
  if (!s.sesion) return <Login s={s} />;
  if (window.location.pathname === "/conectar/instagram") {
    return <RegresoInstagram jwt={jwt} alTerminar={() => { window.history.replaceState(null, "", "/#instagram"); setSeccion("instagram"); recargarYo(); }} />;
  }
  if (errorYo) {
    return <div className="login"><div className="card login-caja" data-tipo="error"><p>{errorYo}</p><button className="btn" onClick={recargarYo}>Reintentar</button><button className="btn" onClick={() => void s.salir()}>Salir</button></div></div>;
  }
  if (!yo) return <div className="login"><div className="esq" style={{ width: 360, height: 300 }} /></div>;

  const actual = SECCIONES.find((x) => x.id === vista)!;
  // Si estas dentro de una herramienta, su grupo queda abierto.
  const verMas = verMasManual || HERRAMIENTAS.includes(vista);
  const boton = (id: Seccion) => {
    const x = SECCIONES.find((y) => y.id === id)!;
    return (
      <button key={id} aria-current={vista === id} onClick={() => elegir(id)}>
        <Icono nombre={x.icono} size={17} />
        {x.texto}
        {esAlumno && PRONTO_ALUMNO.includes(id) ? <span className="nav-pronto">Pronto</span> : null}
      </button>
    );
  };
  const ig = yo.instagram;
  const reconectar = esAlumno && ig && (ig.estado === "vencida" || ig.estado === "error");

  return (
    <div className="app" key={s.sesion.user.id}>
      <nav className="lateral" aria-label="Secciones">
        <div className="marca">
          <div className="marca-punto">P</div>
          <div>
            <div className="marca-txt">Prime Club</div>
            <div className="marca-sub">{esAlumno ? "Tu panel" : "Panel de Leo"}</div>
          </div>
        </div>

        <div className="nav">
          <div className="nav-grupo">{PRINCIPAL.filter(enMenu).map(boton)}</div>
        </div>

        <div className="nav nav-abajo">
          {HERRAMIENTAS.some(permitida) ? (
            <div className="nav-grupo">
              <button className="nav-mas" aria-expanded={verMas} onClick={() => setVerMas((v) => !v)}>
                <Icono nombre="herramientas" size={17} />
                Más herramientas
                <span className="nav-flecha"><Icono nombre="chevron" size={14} /></span>
              </button>
              {verMas ? <div className="nav-sub">{HERRAMIENTAS.filter(permitida).map(boton)}</div> : null}
            </div>
          ) : null}
          <div className="nav-grupo">{AJUSTES.filter(permitida).map(boton)}</div>
        </div>

        <div className="rol">
          {!esAlumno ? (
            <div className="rol-ops" role="group" aria-label="Punto de vista">
              {ROLES.map((r) => (
                <button key={r.id} aria-pressed={rol === r.id} onClick={() => { setRol(r.id); elegir(r.entrada); }}>
                  {r.texto}
                </button>
              ))}
            </div>
          ) : null}
          <div className="usuario-pie">
            <span title={s.sesion.user.email ?? ""}>{s.sesion.user.email}</span>
            <button className="salir" onClick={() => void s.salir()}>
              <Icono nombre="salir" size={15} /> Salir
            </button>
          </div>
        </div>
      </nav>

      <main className="principal">
        <BarraSuperior
          jwt={jwt}
          activa={!esAlumno || conectado}
          etiqueta={esAlumno ? "Alumno" : yo.rol === "admin" ? "Equipo" : "Lectura"}
          tema={tema}
          alternarTema={alternar}
          recargar={vista === "instagram" ? recargarYo : estado.recargar}
          cargando={estado.cargando}
        />

        {reconectar ? (
          <div className="aviso-global" role="alert">
            <Icono nombre="aviso" size={16} />
            <span>{ig?.error ?? "Tu cuenta de Instagram necesita volver a conectarse."} Mientras tanto tus datos no se actualizan.</span>
            <button className="btn" onClick={() => elegir("instagram")}>Reconectar</button>
          </div>
        ) : null}

        <header className="cabecera">
          <div>
            <h1>{actual.texto}</h1>
            <p>{actual.pregunta}</p>
          </div>
          {/* Cada vista puede poner aca sus controles (p. ej. el periodo del Dashboard). */}
          <div className="cabecera-acciones" id="cabecera-acciones" />
        </header>

        {vista === "instagram" ? <ConectarInstagram yo={yo} jwt={jwt} recargar={recargarYo} /> : vista === "alumnos" ? (
          <Suspense fallback={<EsqueletoGrilla />}><Alumnos jwt={jwt} /></Suspense>
        ) : pronto ? (
          <Pronto
            icono="competencia"
            titulo="Espía llega pronto"
            texto="Vas a poder agregar hasta 5 cuentas de tu competencia y ver qué publican, cuánta interacción logran y cómo te comparas con ellas. Estamos terminando esta sección: si ya tienes en mente qué cuentas vigilar, cuéntaselo al equipo de Prime Club."
          />
        ) : (
        <Suspense fallback={<EsqueletoGrilla />}><Vista estado={estado} esqueleto={vista === "piezas" ? <EsqueletoGrilla /> : undefined}>
          {(d) => {
            switch (vista) {
              case "resumen":
                return <Resumen d={d} equipo={!esAlumno} jwt={jwt} admin={!esAlumno && yo.rol === "admin"} />;
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
                return <Negocio key={s.sesion?.user.id} d={d} jwt={jwt} recargar={estado.recargar} />;
              case "mesa":
                return <Mesa key={s.sesion?.user.id} d={d} jwt={jwt} />;
            }
          }}
        </Vista></Suspense>
        )}
      </main>
    </div>
  );
}
