/** Contrato de datos que produce tools/ig_analizar.py.
 *  `null` significa "la API no lo devolvio". No es cero. */

export type Numerico = number | null;

export interface Pieza {
  id: string;
  permalink: string | null;
  fecha: string;
  tipo: "REELS" | "FEED";
  formato: string | null;
  thumb: string | null;
  primera_linea: string;
  pilares: string[];
  alcance: Numerico;
  vistas: Numerico;
  guardados: Numerico;
  compartidos: Numerico;
  likes: Numerico;
  comentarios: Numerico;
  interacciones: Numerico;
  seguidores: Numerico;
  guardado_pct: Numerico;
  compartido_pct: Numerico;
  like_pct: Numerico;
  comentario_pct: Numerico;
  metricas_faltantes: string[];
  multiplicador: Numerico;
}

export interface Historia {
  id: string;
  permalink: string | null;
  hora: string | null;
  formato: string | null;
  thumb: string | null;
  alcance: Numerico;
  respuestas: Numerico;
  navegacion: Numerico;
  visitas_perfil: Numerico;
  seguidores_ganados: Numerico;
  interacciones: Numerico;
  visita_perfil_pct: Numerico;
  metricas_faltantes: string[];
}

export interface PiezaCompetencia {
  id: string;
  permalink: string | null;
  fecha: string;
  formato: string | null;
  thumb: string | null;
  primera_linea: string;
  likes: Numerico;
  comentarios: Numerico;
  interaccion_sobre_seguidores_pct: Numerico;
}

export interface CuentaCompetencia {
  username?: string;
  seguidores?: Numerico;
  publicaciones?: Numerico;
  n_muestra?: number;
  interaccion_mediana_pct?: Numerico;
  piezas?: PiezaCompetencia[];
  error?: string;
}

export interface Correlacion {
  rho: Numerico;
  p: Numerico;
  n: number;
  nota?: string;
}

export interface Propuesta {
  accion: string;
  pieza_id: string | null;
  permalink: string | null;
  thumb: string | null;
  titulo: string;
  motivo: string;
}

export interface StatsPilar {
  n: number;
  guardado_pct_mediana: Numerico;
  compartido_pct_mediana: Numerico;
  alcance_mediano: Numerico;
}

/** Fila liviana del calendario. Incluye piezas que NO superan el piso de
 *  alcance: el calendario dice que se publico, no que rindio. */
export interface FilaCalendario {
  alcance?: Numerico;
  id: string;
  fecha: string;
  permalink: string | null;
  tipo: "REELS" | "FEED";
  formato: string | null;
  thumb: string | null;
  primera_linea: string;
  guardado_pct: Numerico;
  multiplicador: Numerico;
  apto_ranking: boolean;
  pide_palabra_clave: boolean | null;
}

export interface FilaAnuncio {
  id: string;
  nombre: string | null;
  campana: string | null;
  conjunto: string | null;
  estado: string | null;
  permalink: string | null;
  es_dark_post: boolean | null;
  moneda: string | null;
  gasto: Numerico;
  impresiones: Numerico;
  alcance: Numerico;
  clicks: Numerico;
  clicks_enlace: Numerico;
  ctr: Numerico;
  cpm: Numerico;
  frecuencia: Numerico;
  conversaciones: Numerico;
  costo_por_conversacion: Numerico;
  costo_por_click: Numerico;
  retencion_video: Numerico;
  fecha_snapshot: string | null;
}

export interface FilaCampana {
  campana: string | null;
  moneda: string | null;
  anuncios: Numerico;
  activos: Numerico;
  gasto: Numerico;
  impresiones: Numerico;
  conversaciones: Numerico;
  costo_por_conversacion: Numerico;
  ctr_mediano: Numerico;
}

export interface Analisis {
  generado: string;
  cuenta: {
    username: string | null;
    nombre: string | null;
    followers_count: Numerico;
    media_count: Numerico;
    foto: string | null;
  };
  snapshot: string;
  piso_alcance: number;
  /** Meses hacia atras que entran al analisis. Fuera de esta ventana el
   *  contenido sigue en la base pero no se muestra. */
  ventana_meses?: number;
  n_total: number;
  n_con_alcance: number;
  n_solidos: number;
  base_por_formato: Record<string, { n: number; guardado_pct_mediana: Numerico }>;
  rankings: { todas: Pieza[] };
  calendario?: FilaCalendario[];
  anuncios?: { filas: FilaAnuncio[]; campanas: FilaCampana[]; monedas: string[]; nota: string };
  por_pilar: Record<string, StatsPilar>;
  correlaciones: Record<string, Correlacion | string>;
  audiencia: {
    ciudades: Record<string, number>;
    paises: Record<string, number>;
    edad: Record<string, number>;
    genero: Record<string, number>;
    seguidores: Numerico;
    nota: string | null;
  };
  historias: {
    capturadas: string | null;
    activas: number;
    filas: Historia[];
    nota: string;
    error?: string;
  };
  competencia: { cuentas: Record<string, CuentaCompetencia>; nota: string };
  mesa: { propuestas: Propuesta[]; criterio: string };
  /** Presente solo cuando el backend todavia no tiene datos. */
  error?: string;
  comando?: string;
  detalle?: string;
}

export type Rol = "direccion" | "contenido";
