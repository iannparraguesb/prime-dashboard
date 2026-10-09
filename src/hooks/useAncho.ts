import { useEffect, useRef, useState } from "react";

/** Ancho real del contenedor. Los graficos dibujan en pixeles reales para que
 *  el texto no crezca ni se encoja con la pantalla, como pasa con un viewBox fijo. */
export function useAncho<T extends HTMLElement>(inicial = 720) {
  const ref = useRef<T>(null);
  const [ancho, setAncho] = useState(inicial);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const obs = new ResizeObserver(([e]) => setAncho(Math.max(280, Math.floor(e.contentRect.width))));
    obs.observe(el);
    return () => obs.disconnect();
  }, []);
  return [ref, ancho] as const;
}
