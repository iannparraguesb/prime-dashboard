import { useState } from "react";
import { Icono } from "./icons";
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

export function Login({ s }: { s: EstadoSesion }) {
  const [email, setEmail] = useState("");
  const [clave, setClave] = useState("");
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
    <div className="login">
      <form
        className="card login-caja"
        onSubmit={(ev) => {
          ev.preventDefault();
          if (!puede) return;
          if (registro) void crearCuenta();
          else void s.entrar(email, clave);
        }}
      >
        <div className="marca" style={{ marginBottom: "var(--e5)" }}>
          <div className="marca-punto">P</div>
          <div>
            <div className="marca-txt">Prime Club</div>
            <div className="marca-sub">Inteligencia de contenido</div>
          </div>
        </div>

        <h1 style={{ fontSize: 22 }}>{registro ? "Crear cuenta de alumno" : "Entrar"}</h1>
        <p className="login-sub">
          {registro
            ? "Necesitas el código que te mandó el equipo de Prime Club. Sirve una sola vez."
            : "Acceso para el equipo y los alumnos de Prime Club."}
        </p>

        <label className="login-campo">
          <span>Correo</span>
          <input
            className="control"
            type="email"
            autoComplete="username"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="tu@correo.com"
            autoFocus
          />
        </label>

        <label className="login-campo">
          <span>Clave</span>
          <input
            className="control"
            type="password"
            autoComplete={registro ? "new-password" : "current-password"}
            minLength={registro ? 10 : undefined}
            value={clave}
            onChange={(e) => setClave(e.target.value)}
          />
          {registro ? <small className="login-ayuda">Mínimo 10 caracteres.</small> : null}
        </label>

        {registro ? (
          <label className="login-campo">
            <span>Código de invitación</span>
            <input
              className="control"
              autoComplete="one-time-code"
              autoCapitalize="characters"
              spellCheck={false}
              value={codigo}
              onChange={(e) => setCodigo(e.target.value)}
              placeholder="XXXXX-XXXXX"
            />
          </label>
        ) : null}

        {/* El error va visible y con la causa, no solo en la consola. */}
        {error ? (
          <div className="login-error" role="alert">
            <Icono nombre="error" size={15} />
            <span>{error}</span>
          </div>
        ) : null}

        <button className="btn" data-variante="oro" type="submit" disabled={!puede}>
          {registrando ? "Creando tu cuenta…" : s.cargando ? "Entrando…" : registro ? "Crear cuenta" : "Entrar"}
          {ocupado ? null : <Icono nombre="externo" size={14} />}
        </button>

        <button type="button" className="login-cambio" onClick={cambiarModo} disabled={ocupado}>
          {registro ? "Ya tengo cuenta: entrar" : "¿Eres alumno y tienes un código? Crea tu cuenta"}
        </button>
      </form>
    </div>
  );
}
