import { useCallback, useEffect, useState } from "react";

export interface EstadoInstagram {
  estado: "pendiente" | "activa" | "vencida" | "revocada" | "error";
  username: string | null;
  ultima_sincronizacion: string | null;
  token_expira_en: string | null;
  error: string | null;
}
export interface Yo {
  email: string | null;
  tipo: "equipo" | "alumno";
  rol: string;
  instagram: EstadoInstagram | null;
}

/** Quien es la sesion actual. Decide el menu: el equipo ve todo; un alumno, su contenido. */
export function useYo(jwt: string | null) {
  const [yo, setYo] = useState<Yo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    if (!jwt) { setYo(null); return; }
    const ctrl = new AbortController();
    setError(null);
    fetch("/api/yo", { headers: { authorization: `Bearer ${jwt}` }, signal: ctrl.signal })
      .then(async (r) => {
        const d = await r.json().catch(() => ({}));
        if (!r.ok || d.error) throw new Error(d.error || "No pudimos cargar tu cuenta.");
        setYo(d as Yo);
      })
      .catch((e) => { if (!ctrl.signal.aborted) setError(e instanceof Error ? e.message : "No pudimos cargar tu cuenta."); });
    return () => ctrl.abort();
  }, [jwt, revision]);
  const recargar = useCallback(() => setRevision((v) => v + 1), []);
  return { yo, error, recargar };
}
