import { useCallback, useState } from "react";

export type Tema = "claro" | "oscuro";
const CLAVE = "prime-tema";

function leer(): Tema {
  try {
    return localStorage.getItem(CLAVE) === "oscuro" ? "oscuro" : "claro";
  } catch {
    return "claro";
  }
}

/** Aplica el tema al <html>. Se llama antes del primer render para que no parpadee. */
export function aplicarTema(t: Tema = leer()) {
  if (t === "oscuro") document.documentElement.dataset.theme = "dark";
  else delete document.documentElement.dataset.theme;
}

export function useTema() {
  const [tema, setTema] = useState<Tema>(leer);
  const alternar = useCallback(() => {
    setTema((actual) => {
      const nuevo: Tema = actual === "claro" ? "oscuro" : "claro";
      aplicarTema(nuevo);
      try { localStorage.setItem(CLAVE, nuevo); } catch { /* sin almacenamiento: vale para esta visita */ }
      return nuevo;
    });
  }, []);
  return { tema, alternar };
}
