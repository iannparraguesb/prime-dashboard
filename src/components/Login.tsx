import { useState, type ReactNode } from "react";
import { Icono, type NombreIcono } from "./icons";
import type { EstadoSesion } from "../hooks/useSesion";

/** Crea la cuenta del alumno con su codigo de invitacion. El servidor valida el
 *  codigo y crea la cuenta; despues se entra con la misma clave. */
async function registrar(email: string, clave: string, codigo: string) {
  const r = await fetch("/api/registro", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: email.trim(), clave, codigo }),
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok || d.error) throw new Error(d.error || "No pudimos crear tu cuenta. Inténtalo de nuevo.");
}

/** Lo que el panel hace de verdad, para el equipo y para los alumnos. En vez de
 *  testimonios: no hay ninguno documentado sobre el panel y no se inventan. */
const VENTAJAS: { icono: NombreIcono; titulo: string; texto: string }[] = [
  { icono: "piezas", titulo: "Qué funcionó de verdad", texto: "Guardados sobre alcance, comparados con la mediana de tu propio formato." },
  { icono: "historias", titulo: "Dónde se va la gente", texto: "La curva de abandono de tus historias, slide por slide." },
  { icono: "calendario", titulo: "Todo lo que publicaste", texto: "Tu calendario día por día, con el alcance de cada pieza." },
];

function Campo({ id, etiqueta, ayuda, children }: { id: string; etiqueta: string; ayuda?: string; children: ReactNode }) {
  return (
    <div className="acceso-campo">
      <label htmlFor={id}>{etiqueta}</label>
      <div className="acceso-input">{children}</div>
      {ayuda ? <small className="login-ayuda">{ayuda}</small> : null}
    </div>
  );
}

export function Login({ s }: { s: EstadoSesion }) {
  const [email, setEmail] = useState("");
  const [clave, setClave] = useState("");
  const [verClave, setVerClave] = useState(false);
  const [modo, setModo] = useState<"entrar" | "registro">("entrar");
  const [codigo, setCodigo] = useState("");
  const [registrando, setRegistrando] = useState(false);
  const [errorRegistro, setErrorRegistro] = useState<string | null>(null);

  if (s.faltaConfig) {
    return (
      <div className="login">
        <div className="card login-caja" data-tipo="error">
          <h1>Falta configuración</h1>
          <p>
            No hay <code>VITE_SUPABASE_URL</code> ni <code>VITE_SUPABASE_ANON_KEY</code>. Agrégalas
            al <code>.env</code> de la raíz de este repo con el mismo valor que{" "}
            <code>SUPABASE_URL</code> y <code>SUPABASE_ANON_KEY</code> (ver <code>.env.example</code>),
            y reinicia <code>npm run dev</code>: Vite solo las lee al arrancar.
          </p>
        </div>
      </div>
    );
  }

  const registro = modo === "registro";
  const ocupado = s.cargando || registrando;
  const puede = email.trim().length > 3 && (registro ? clave.length >= 10 && codigo.trim().length >= 10 : clave.length > 0) && !ocupado;
  const error = registro ? errorRegistro : s.error;

  const crearCuenta = async () => {
    setRegistrando(true);
    setErrorRegistro(null);
    try {
      await registrar(email, clave, codigo);
      // La cuenta ya existe: si entrar fallara, el error se ve en el modo entrar.
      setModo("entrar");
      await s.entrar(email, clave);
    } catch (e) {
      setErrorRegistro(e instanceof Error ? e.message : "No pudimos crear tu cuenta. Inténtalo de nuevo.");
    } finally {
      setRegistrando(false);
    }
  };

  const cambiarModo = () => {
    setModo(registro ? "entrar" : "registro");
    setErrorRegistro(null);
    setClave("");
  };

  return (
    <div className="acceso">
      <section className="acceso-lado">
        <div className="acceso-caja">
          <div className="marca acceso-entra">
            <div className="marca-punto">P</div>
            <div>
              <div className="marca-txt">Prime Club</div>
              <div className="marca-sub">Inteligencia de contenido</div>
            </div>
          </div>

          <div className="acceso-encabezado">
            <h1 className="acceso-titulo acceso-entra" data-paso="1">{registro ? "Crea tu cuenta" : "Entra a tu panel"}</h1>
            <p className="acceso-sub acceso-entra" data-paso="2">
              {registro
                ? "Necesitas el código que te mandó el equipo de Prime Club. Sirve una sola vez."
                : "Acceso para el equipo y los alumnos de Prime Club."}
            </p>
          </div>

          <form
            className="acceso-form"
            onSubmit={(ev) => {
              ev.preventDefault();
              if (!puede) return;
              if (registro) void crearCuenta();
              else void s.entrar(email, clave);
            }}
          >
            <div className="acceso-entra" data-paso="3">
              <Campo id="acceso-email" etiqueta="Correo">
                <input
                  id="acceso-email"
                  type="email"
                  autoComplete="username"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="tu@correo.com"
                  autoFocus
                />
              </Campo>
            </div>

            <div className="acceso-entra" data-paso="4">
              <Campo id="acceso-clave" etiqueta="Clave" ayuda={registro ? "Mínimo 10 caracteres." : undefined}>
                <input
                  id="acceso-clave"
                  type={verClave ? "text" : "password"}
                  autoComplete={registro ? "new-password" : "current-password"}
                  minLength={registro ? 10 : undefined}
                  value={clave}
                  onChange={(e) => setClave(e.target.value)}
                  placeholder={registro ? "Elige una clave" : "Tu clave"}
                />
                <button
                  type="button"
                  className="acceso-ojo"
                  onClick={() => setVerClave((v) => !v)}
                  aria-label={verClave ? "Ocultar la clave" : "Mostrar la clave"}
                  aria-pressed={verClave}
                >
                  <Icono nombre={verClave ? "vistaNo" : "vista"} size={18} />
                </button>
              </Campo>
            </div>

            {registro ? (
              <div className="acceso-entra" data-paso="5">
                <Campo id="acceso-codigo" etiqueta="Código de invitación">
                  <input
                    id="acceso-codigo"
                    autoComplete="one-time-code"
                    autoCapitalize="characters"
                    spellCheck={false}
                    value={codigo}
                    onChange={(e) => setCodigo(e.target.value)}
                    placeholder="XXXXX-XXXXX"
                  />
                </Campo>
              </div>
            ) : null}

            {/* El error va visible y con la causa, no solo en la consola. */}
            {error ? (
              <div className="login-error" role="alert">
                <Icono nombre="error" size={15} />
                <span>{error}</span>
              </div>
            ) : null}

            {/* La animacion va en el contenedor: en el boton fijaria la opacidad y
                taparia el estado deshabilitado. */}
            <div className="acceso-entra" data-paso="6">
              <button className="btn acceso-boton" data-variante="oro" type="submit" disabled={!puede}>
                {registrando ? "Creando tu cuenta…" : s.cargando ? "Entrando…" : registro ? "Crear cuenta" : "Entrar"}
              </button>
            </div>
          </form>

          <p className="acceso-cambio acceso-entra" data-paso="7">
            {registro ? "¿Ya tienes cuenta?" : "¿Eres alumno y tienes un código?"}{" "}
            <button type="button" onClick={cambiarModo} disabled={ocupado}>
              {registro ? "Entrar" : "Crea tu cuenta"}
            </button>
          </p>
        </div>
      </section>

      <aside className="acceso-hero" aria-label="Qué encuentras en el panel">
        <div className="acceso-hero-fondo" />
        <div className="acceso-hero-texto">
          <span className="acceso-eyebrow">Panel de contenido</span>
          <h2>Qué publicar, qué repetir y qué dejar de hacer.</h2>
          <p>Con tus propios datos de Instagram, medidos sin promedios engañosos.</p>
        </div>
        <ul className="acceso-ventajas">
          {VENTAJAS.map((v, i) => (
            <li key={v.titulo} className="acceso-ventaja" data-paso={8 + i}>
              <span className="acceso-ventaja-icono"><Icono nombre={v.icono} size={18} /></span>
              <div>
                <strong>{v.titulo}</strong>
                <p>{v.texto}</p>
              </div>
            </li>
          ))}
        </ul>
      </aside>
    </div>
  );
}
