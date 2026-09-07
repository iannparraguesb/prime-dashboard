/** Formas que devuelven las vistas de Supabase, generadas desde la base real
 *  (`generate_typescript_types`) y recortadas a lo que consume la API.
 *
 *  OJO: las tasas vienen en FRACCIÓN (0.0034), no en porcentaje. La conversión
 *  ×100 la hace la capa de API antes de entregar al panel. */

export interface VPiezaRanking {
  post_id: string | null;
  cuenta_id: string | null;
  permalink: string | null;
  fecha_publicacion: string | null;
  fecha_snapshot: string | null;
  formato: string | null;
  fuente: string | null;
  primera_linea: string | null;
  pide_palabra_clave: boolean | null;
  alcance: number | null;
  vistas: number | null;
  guardados: number | null;
  compartidos: number | null;
  comentarios: number | null;
  likes: number | null;
  visitas_perfil: number | null;
  seguidores_ganados: number | null;
  metricas_faltantes: string[] | null;
  tasa_guardado: number | null;
  tasa_compartido: number | null;
  tasa_comentario: number | null;
  tasa_like: number | null;
  tasa_visita_perfil: number | null;
  apto_ranking: boolean | null;
  base_formato: number | null;
  multiplicador: number | null;
}

export interface VBaseFormato {
  cuenta_id: string | null;
  formato: string | null;
  n: number | null;
  mediana_guardado: number | null;
  mediana_compartido: number | null;
  mediana_alcance: number | null;
}

export interface VPilarRendimiento {
  pilar: string | null;
  n: number | null;
  mediana_guardado: number | null;
  mediana_compartido: number | null;
  mediana_alcance: number | null;
}

export interface VEfectoPalabraClave {
  pide_palabra_clave: boolean | null;
  n: number | null;
  mediana_guardado: number | null;
  mediana_alcance: number | null;
}

export interface FilaCuenta {
  id: string;
  username: string;
  nombre: string | null;
  es_propia: boolean;
}

export interface FilaConfig {
  clave: string;
  valor: number;
  nota: string;
}

export interface FilaPiezaPilar {
  post_id: string;
  pilar: string;
}
