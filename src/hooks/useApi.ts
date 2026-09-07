import { useCallback, useEffect, useRef, useState } from 'react';

export interface Estado<T> {
  datos: T | null; cargando: boolean; primeraCarga: boolean; error: string | null;
  aviso: { error: string; comando?: string; detalle?: string } | null;
  actualizado: Date | null; recargar: () => void;
}
interface RespuestaConError { error?: string; comando?: string; detalle?: string }

export function useApi<T extends RespuestaConError>(ruta: string, jwt?: string | null): Estado<T> {
  const clave = `${jwt || ''}:${ruta}`;
  const [revision, setRevision] = useState(0);
  const [estado, setEstado] = useState<{clave:string; datos:T|null; error:string|null; cargando:boolean; actualizado:Date|null}>({clave:'',datos:null,error:null,cargando:true,actualizado:null});
  const secuencia = useRef(0);
  useEffect(() => {
    const controller = new AbortController();
    const turno = ++secuencia.current;
    if (!jwt) {
      setEstado({clave,datos:null,error:null,cargando:false,actualizado:null});
      return () => controller.abort();
    }
    setEstado(prev => ({clave,datos:prev.clave===clave?prev.datos:null,error:null,cargando:true,actualizado:prev.clave===clave?prev.actualizado:null}));
    const timer = window.setTimeout(() => controller.abort(new Error('La consulta tardó demasiado. Inténtalo de nuevo.')), 25000);
    void (async () => {
      try {
        const r = await fetch(ruta,{headers:{accept:'application/json',authorization:`Bearer ${jwt}`},signal:controller.signal});
        const data = await r.json().catch(() => { throw new Error('No pudimos leer la respuesta del servicio.'); }) as T;
        if (!r.ok || data.error) throw new Error(data.error || 'No pudimos completar la consulta.');
        if (turno===secuencia.current && !controller.signal.aborted) setEstado({clave,datos:data,error:null,cargando:false,actualizado:new Date()});
      } catch(e) {
        if (turno!==secuencia.current || (controller.signal.aborted && controller.signal.reason?.name==='AbortError')) return;
        setEstado({clave,datos:null,error:e instanceof Error ? e.message : 'Revisa tu conexión e inténtalo de nuevo.',cargando:false,actualizado:null});
      } finally {window.clearTimeout(timer);}
    })();
    return () => {secuencia.current++; window.clearTimeout(timer); controller.abort();};
  },[clave,ruta,jwt,revision]);
  const recargar = useCallback(() => setRevision(v=>v+1),[]);
  // No mostrar ni un frame de datos de otra ruta/identidad antes del efecto.
  const actual = estado.clave===clave ? estado : {datos:null,error:null,cargando:!!jwt,actualizado:null};
  return {...actual,primeraCarga:actual.datos===null,aviso:null,recargar};
}
