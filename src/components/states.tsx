import type { ReactNode } from "react";
import { Icono, type NombreIcono } from "./icons";
import type { Estado } from "../hooks/useApi";

/* ==========================================================================
   Los tres estados, siempre. El ORDEN DE LAS PREGUNTAS importa y es lo que
   mas se equivoca:

     1. Hay error?            -> mostrarlo, con boton de reintentar
     2. Es la PRIMERA carga?  -> esqueleto con la forma del contenido
     3. Esta vacio?           -> instruccion exacta de como llenarlo
     4. Datos

   Si preguntas por `cargando` antes que por el error, un fallo durante un
   refresco se muestra como un esqueleto eterno.
   ========================================================================== */

export function Esqueleto({ filas = 3, alto = 84 }: { filas?: number; alto?: number }) {
  return (
    <div className="lista" aria-busy="true" aria-label="Cargando">
      {Array.from({ length: filas }, (_, i) => (
        <div key={i} className="esq" style={{ height: alto }} />
      ))}
    </div>
  );
}

export function EsqueletoGrilla({ n = 8 }: { n?: number }) {
  return (
    <div className="grilla" aria-busy="true" aria-label="Cargando piezas">
      {Array.from({ length: n }, (_, i) => (
        <div key={i} className="esq" style={{ aspectRatio: "3 / 5" }} />
      ))}
    </div>
  );
}

export function Error({
  mensaje,
  onReintentar,
  reintentando,
}: {
  mensaje: string;
  onReintentar?: () => void;
  reintentando?: boolean;
}) {
  return (
    <div className="card estado" data-tipo="error" role="alert">
      <div className="estado-icono">
        <Icono nombre="error" size={20} />
      </div>
      <h3>No se pudieron cargar los datos</h3>
      <p>{mensaje}</p>
      {onReintentar ? (
        <button className="btn" onClick={onReintentar} disabled={reintentando}>
          <Icono nombre="refrescar" size={14} />
          {reintentando ? "Reintentando…" : "Reintentar"}
        </button>
      ) : null}
    </div>
  );
}

/**
 * El vacio no es una excepcion: buena parte de los datos se llenan corriendo un
 * script a mano, asi que "todavia no hay datos" es un estado NORMAL. Por eso
 * siempre trae el comando exacto. Un vacio sin instruccion deja al usuario
 * adivinando.
 */
export function Vacio({
  titulo,
  detalle,
  comando,
  onReintentar,
}: {
  titulo: string;
  detalle?: string;
  comando?: string;
  onReintentar?: () => void;
}) {
  return (
    <div className="card estado" data-tipo="vacio">
      <div className="estado-icono">
        <Icono nombre="vacio" size={20} />
      </div>
      <h3>{titulo}</h3>
      {detalle ? <p>{detalle}</p> : null}
      {comando ? (
        <>
          <p>Corre esto desde la raiz del repo:</p>
          <code className="comando">{comando}</code>
        </>
      ) : null}
      {onReintentar ? (
        <button className="btn" onClick={onReintentar}>
          <Icono nombre="refrescar" size={14} />
          Volver a comprobar
        </button>
      ) : null}
    </div>
  );
}

/** Un cero mudo no sirve: si una seccion sale vacia por una razon conocida, la
 *  pantalla explica por que y que hacer. */
export function SinDatosSeccion({ titulo, porque }: { titulo: string; porque: string }) {
  return (
    <div className="card estado">
      <div className="estado-icono">
        <Icono nombre="aviso" size={20} />
      </div>
      <h3>{titulo}</h3>
      <p>{porque}</p>
    </div>
  );
}

/** Primer ingreso de un alumno: la cuenta ya esta conectada pero la ingesta
 *  todavia no trajo nada. No es un error ni un vacio: es una espera. */
export function Sincronizando({ detalle }: { detalle?: string }) {
  return (
    <div className="card estado" data-tipo="sincronizando" role="status">
      <div className="estado-icono">
        <Icono nombre="refrescar" size={20} />
      </div>
      <h3>Sincronizando tu Instagram</h3>
      <p>Estamos trayendo tus publicaciones de Instagram por primera vez. Esto puede tomar unos minutos.</p>
      {detalle ? <p>{detalle}</p> : null}
    </div>
  );
}

/** Seccion que todavia no abre para este usuario. Dice que viene y que va a
 *  hacer, en vez de esconderla o mostrar un error de permisos. */
export function Pronto({ icono, titulo, texto }: { icono: NombreIcono; titulo: string; texto: string }) {
  return (
    <div className="card estado" data-tipo="pronto" role="status">
      <div className="estado-icono">
        <Icono nombre={icono} size={20} />
      </div>
      <h3>{titulo}</h3>
      <p>{texto}</p>
    </div>
  );
}

/**
 * El arbol de decision, en un solo lugar. Cada vista lo consume en vez de
 * reimplementarlo (y equivocar el orden).
 */
export function Vista<T extends object>({
  estado,
  esqueleto,
  children,
}: {
  estado: Estado<T>;
  esqueleto?: ReactNode;
  children: (datos: T) => ReactNode;
}) {
  if (estado.error) {
    return <Error mensaje={estado.error} onReintentar={estado.recargar} reintentando={estado.cargando} />;
  }
  if (estado.primeraCarga && estado.cargando) {
    return <>{esqueleto ?? <Esqueleto />}</>;
  }
  if (estado.aviso) {
    return (
      <Vacio
        titulo={estado.aviso.error}
        detalle={estado.aviso.detalle}
        comando={estado.aviso.comando}
        onReintentar={estado.recargar}
      />
    );
  }
  if (!estado.datos) {
    return (
      <Vacio
        titulo="Sin datos"
        detalle="Todavía no hay información disponible. Vuelve a comprobarlo o contacta al equipo."
        onReintentar={estado.recargar}
      />
    );
  }
  return <>{children(estado.datos)}</>;
}
