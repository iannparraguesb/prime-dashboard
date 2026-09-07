import { useState } from "react";
import { Icono } from "./icons";
import type { EstadoSesion } from "../hooks/useSesion";

export function Login({ s }: { s: EstadoSesion }) {
  const [email, setEmail] = useState("");
  const [clave, setClave] = useState("");

  if (s.faltaConfig) {
    return (
      <div className="login">
        <div className="card login-caja" data-tipo="error">
          <h1>Falta configuración</h1>
          <p>
            No hay <code>VITE_SUPABASE_URL</code> ni <code>VITE_SUPABASE_ANON_KEY</code>. Se
            generan desde el <code>.env</code> de la raíz del repo al archivo{" "}
            <code>projects/dashboard-contenido/.env.local</code>.
          </p>
        </div>
      </div>
    );
  }

  const puede = email.trim().length > 3 && clave.length > 0 && !s.cargando;

  return (
    <div className="login">
      <form
        className="card login-caja"
        onSubmit={(ev) => {
          ev.preventDefault();
          if (puede) void s.entrar(email, clave);
        }}
      >
        <div className="marca" style={{ marginBottom: "var(--e5)" }}>
          <div className="marca-punto">P</div>
          <div>
            <div className="marca-txt">Prime Club</div>
            <div className="marca-sub">Inteligencia de contenido</div>
          </div>
        </div>

        <h1 style={{ fontSize: 22 }}>Entrar</h1>
        <p className="login-sub">
          Acceso solo para el equipo. Si tu correo no está en la lista, el panel no muestra datos
          aunque la cuenta exista.
        </p>

        <label className="login-campo">
          <span>Correo</span>
          <input
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
            type="password"
            autoComplete="current-password"
            value={clave}
            onChange={(e) => setClave(e.target.value)}
          />
        </label>

        {/* El error va visible y con la causa, no solo en la consola. */}
        {s.error ? (
          <div className="login-error" role="alert">
            <Icono nombre="error" size={15} />
            <span>{s.error}</span>
          </div>
        ) : null}

        <button className="btn" data-variante="oro" type="submit" disabled={!puede}>
          {s.cargando ? "Entrando…" : "Entrar"}
          {s.cargando ? null : <Icono nombre="externo" size={14} />}
        </button>
      </form>
    </div>
  );
}
