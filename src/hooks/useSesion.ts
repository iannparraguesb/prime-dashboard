import { useEffect, useState } from "react";
import type { Session } from "@supabase/auth-js";
import { supabase, faltaConfig } from "../lib/supabase";

export interface EstadoSesion {
  sesion: Session | null;
  cargando: boolean;
  error: string | null;
  faltaConfig: boolean;
  entrar: (email: string, clave: string) => Promise<void>;
  salir: () => Promise<void>;
}

/** La sesion vive en localStorage y se refresca sola. `cargando` arranca en true
 *  porque al montar hay que preguntarle a Supabase si ya hay sesion: sin eso, el
 *  panel parpadea la pantalla de login en cada recarga. */
export function useSesion(): EstadoSesion {
  const [sesion, setSesion] = useState<Session | null>(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!supabase) {
      setCargando(false);
      return;
    }
    let vivo = true;
    supabase.auth.getSession().then(({ data }) => {
      if (!vivo) return;
      setSesion(data.session ?? null);
      setCargando(false);
    }).catch(() => {
      if (vivo) {setError("No se pudo recuperar la sesión. Vuelve a entrar.");setSesion(null);setCargando(false);}
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => {
      if (vivo) setSesion(s ?? null);
    });
    return () => {
      vivo = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  const entrar = async (email: string, clave: string) => {
    if (!supabase) return;
    setError(null);
    setCargando(true);
    try {
    const { error: e } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password: clave,
    });
    if (e) {
      // El mensaje de Supabase viene en ingles y es generico a proposito (no
      // revela si el correo existe). Se traduce sin agregar informacion.
      setError(
        e.message.toLowerCase().includes("invalid")
          ? "Correo o clave incorrectos."
          : `No se pudo entrar: ${e.message}`
      );
    }
    } catch { setError("No se pudo conectar. Revisa tu conexión e inténtalo de nuevo."); }
    finally { setCargando(false); }
  };

  const salir = async () => {
    setSesion(null);
    try { await supabase?.auth.signOut({ scope: "local" }); } catch { setError("No se pudo cerrar la sesión remota."); }
  };

  return { sesion, cargando, error, faltaConfig, entrar, salir };
}
