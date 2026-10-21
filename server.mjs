/**
 * Backend del panel: lee Supabase (PostgREST) y arma el objeto `Analisis` que
 * define src/tipos.ts. Sin dependencias: fetch global de Node y node:fs para
 * leer el .env de la raiz del workspace.
 *
 * Tres reglas gobiernan este archivo. Ninguna es opcional.
 *
 * 1. LAS VISTAS DEVUELVEN FRACCIONES; EL PANEL ESPERA PORCENTAJES.
 *    `tasa_guardado` viene 0,0034 y la tarjeta tiene que decir 0,34 %. La
 *    multiplicacion por 100 vive aca, en la capa de API, y en ningun otro lado.
 *    Si se olvida, todos los numeros salen 100 veces mas chicos y el error es
 *    invisible hasta que alguien los compare a mano.
 *
 * 2. `null` SE PROPAGA COMO `null`, JAMAS COMO `0`.
 *    Un dato que la fuente no entrego no es un fracaso medido. Convertirlo a 0
 *    rompe todas las medianas y hace creer que una pieza rindio cero cuando en
 *    realidad no se midio.
 *
 * 3. Los datos se consultan con el JWT del usuario y RLS. Las escrituras
 *    validan rol y propietario; el backend no usa service_role.
 *    Los errores públicos omiten detalles de proveedores y credenciales.
 */
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { HttpError, json, readBody, textField, uuid, rateLimit, reportError } from "./backend/security.mjs";
import { sugerencias } from "./backend/ideas.mjs";
import { rutaInstagram } from "./backend/instagram.mjs";
import { atribuirVentas, claveInstagram } from "./backend/atribucion.mjs";
import { registrarAlumno, rutaInvitaciones } from "./backend/registro.mjs";

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const RAIZ = path.resolve(AQUI, "..", "..");
const PUERTO = Number(process.env.PUERTO_API || 5175);
const RUTA_ENV = path.join(RAIZ, ".env");

/* --------------------------------------------------------------------------
   Credenciales
   -------------------------------------------------------------------------- */

/** Parser de .env minimo: `CLAVE=valor`, ignora comentarios y comillas. */
function leerEnv(ruta) {
  const salida = {};
  let texto;
  try {
    texto = readFileSync(ruta, "utf8");
  } catch {
    return salida;
  }
  for (const linea of texto.split(/\r?\n/)) {
    const limpia = linea.trim();
    if (!limpia || limpia.startsWith("#")) continue;
    const corte = limpia.indexOf("=");
    if (corte < 1) continue;
    const clave = limpia.slice(0, corte).trim();
    let valor = limpia.slice(corte + 1).trim();
    if (
      (valor.startsWith('"') && valor.endsWith('"')) ||
      (valor.startsWith("'") && valor.endsWith("'"))
    ) {
      valor = valor.slice(1, -1);
    }
    salida[clave] = valor;
  }
  return salida;
}

const ENV = { ...leerEnv(RUTA_ENV), ...leerEnv(path.join(AQUI, ".env")), ...process.env };
const SUPABASE_URL = (process.env.SUPABASE_URL || ENV.SUPABASE_URL || "").replace(/\/+$/, "");
// Solo lectura: nunca la service key. Si alguien la pone aca, el navegador
// termina con permisos de escritura sobre toda la base.
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || ENV.SUPABASE_ANON_KEY || "";

/** El token de Meta caduca. Cuando eso pasa, el backfill deja de correr y el
 *  panel se congela en silencio: sigue mostrando datos, solo que cada vez mas
 *  viejos. Por eso la fecha viaja al panel y se avisa ANTES, no despues. */
function estadoToken() {
  const fecha = ENV.IG_TOKEN_EXPIRA;
  if (!fecha) return null;
  const cad = new Date(`${fecha}T00:00:00`);
  if (Number.isNaN(cad.getTime())) return null;
  const dias = Math.floor((cad - new Date()) / 86_400_000);
  return {
    expira: fecha,
    dias_restantes: dias,
    urgente: dias <= 7,
    vencido: dias < 0,
    nota:
      dias < 0
        ? `El token de Meta vencio hace ${Math.abs(dias)} dias. El backfill y las miniaturas nuevas estan detenidos: lo que ves sigue siendo real, pero deja de actualizarse.`
        : dias <= 7
          ? `El token de Meta vence en ${dias} dias. Renuevalo antes o el backfill se detiene sin aviso.`
          : null,
  };
}



/* --------------------------------------------------------------------------
   Cliente PostgREST
   -------------------------------------------------------------------------- */

const PAGINA = 1000;
const MAX_FILAS = 10000;

/** Trae una tabla o vista completa, paginando por Range para no depender del
 *  limite de filas que tenga configurado el proyecto. */
async function traer(recurso, consulta = "select=*", jwt = null) {
  const orden = { cuenta:"id", cuenta_metrica:"cuenta_id,fecha_snapshot,fuente", pieza:"post_id", pieza_metrica:"post_id,fecha_snapshot,fuente", pieza_pilar:"post_id,pilar", config:"clave", v_pieza_ranking:"post_id", v_base_formato:"cuenta_id,formato", v_pilar_rendimiento:"pilar", v_efecto_palabra_clave:"pide_palabra_clave", audiencia_snapshot:"fecha_snapshot,corte,clave", historia:"historia_id", historia_metrica:"historia_id,fecha_snapshot", v_anuncio:"ad_id", v_campana:"campana,moneda", usuario:"id", negocio_gasto_diario:"fecha,campana_id", negocio_dolar:"mes", negocio_agenda:"id", negocio_lead:"id", negocio_llamada:"id", negocio_carga:"fuente", meta_mensual:"mes,metrica" };
  if (!consulta.includes("order=") && orden[recurso]) consulta += `&order=${orden[recurso]}`;
  const filas = [];
  for (let desde = 0; desde < MAX_FILAS; desde += PAGINA) {
    const url = `${SUPABASE_URL}/rest/v1/${recurso}?${consulta}`;
    const r = await fetch(url, {
      signal: AbortSignal.timeout(12000),
      headers: {
        apikey: SUPABASE_ANON_KEY,
        // El JWT del usuario, no la anon key: el RLS decide que ve cada uno.
        // Sin sesion la anon key no lee nada, y eso es a proposito.
        authorization: `Bearer ${jwt ?? SUPABASE_ANON_KEY}`,
        accept: "application/json",
        range: `${desde}-${desde + PAGINA - 1}`,
      },
    });
    if (!r.ok) {
      const cuerpo = await r.text();
      throw new Error(`${recurso}: HTTP ${r.status} — ${cuerpo.slice(0, 300)}`);
    }
    const lote = await r.json();
    filas.push(...lote);
    if (lote.length < PAGINA) return filas;
  }
  throw new HttpError(422, "La consulta supera el límite de datos. Reduce el período.");
}

/* --------------------------------------------------------------------------
   Numeros
   -------------------------------------------------------------------------- */

/** Fraccion -> porcentaje. `null` sigue siendo `null`: si la vista no calculo
 *  la tasa (falta alcance o falta el numerador) el panel muestra un guion, no
 *  un cero. Esta funcion es el punto donde la trampa se resuelve. */
function aPorcentaje(v, decimales = 4) {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  return redondear(n * 100, decimales);
}

/** Numero tal cual, preservando el null. No convierte, no rellena. */
function aNumero(v) {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function redondear(n, decimales) {
  if (n === null) return null;
  const f = 10 ** decimales;
  return Math.round(n * f) / f;
}

function mediana(xs) {
  const v = xs.filter((x) => x !== null && x !== undefined && Number.isFinite(x)).sort((a, b) => a - b);
  if (!v.length) return null;
  const m = Math.floor(v.length / 2);
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
}

/* --------------------------------------------------------------------------
   Spearman — puerto directo de tools/ig_analizar.py, para que el panel siga
   leyendo el mismo numero que leia antes de la migracion.
   -------------------------------------------------------------------------- */

function rangos(xs) {
  const orden = xs.map((_, i) => i).sort((a, b) => xs[a] - xs[b]);
  const r = new Array(xs.length).fill(0);
  let i = 0;
  while (i < orden.length) {
    let j = i;
    while (j + 1 < orden.length && xs[orden[j + 1]] === xs[orden[i]]) j += 1;
    const promedio = (i + j) / 2 + 1;
    for (let k = i; k <= j; k += 1) r[orden[k]] = promedio;
    i = j + 1;
  }
  return r;
}

function betacf(a, b, x, iteraciones = 200) {
  const tiny = 1e-30;
  const qab = a + b;
  const qap = a + 1;
  const qam = a - 1;
  let c = 1;
  let d = 1 - (qab * x) / qap;
  if (Math.abs(d) < tiny) d = tiny;
  d = 1 / d;
  let h = d;
  for (let m = 1; m <= iteraciones; m += 1) {
    const m2 = 2 * m;
    let aa = (m * (b - m) * x) / ((qam + m2) * (a + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < tiny) d = tiny;
    c = 1 + aa / c;
    if (Math.abs(c) < tiny) c = tiny;
    d = 1 / d;
    h *= d * c;
    aa = (-(a + m) * (qab + m) * x) / ((a + m2) * (qap + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < tiny) d = tiny;
    c = 1 + aa / c;
    if (Math.abs(c) < tiny) c = tiny;
    d = 1 / d;
    const de = d * c;
    h *= de;
    if (Math.abs(de - 1) < 3e-9) break;
  }
  return h;
}

function lgamma(z) {
  const g = [
    676.5203681218851, -1259.1392167224028, 771.32342877765313,
    -176.61502916214059, 12.507343278686905, -0.13857109526572012,
    9.9843695780195716e-6, 1.5056327351493116e-7,
  ];
  if (z < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * z)) - lgamma(1 - z);
  const x = z - 1;
  let a = 0.99999999999980993;
  const t = x + 7.5;
  for (let i = 0; i < g.length; i += 1) a += g[i] / (x + i + 1);
  return 0.5 * Math.log(2 * Math.PI) + (x + 0.5) * Math.log(t) - t + Math.log(a);
}

function betainc(a, b, x) {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const lbeta = lgamma(a + b) - lgamma(a) - lgamma(b);
  const front = Math.exp(lbeta + a * Math.log(x) + b * Math.log(1 - x));
  if (x < (a + 1) / (a + b + 2)) return (front * betacf(a, b, x)) / a;
  return 1 - (front * betacf(b, a, 1 - x)) / b;
}

/** Rho de Spearman + p de dos colas. Devuelve null si no hay muestra util:
 *  un rho inventado sobre 3 puntos es peor que decir que no se puede calcular. */
function spearman(xs, ys) {
  const pares = xs
    .map((x, i) => [x, ys[i]])
    .filter(([x, y]) => x !== null && x !== undefined && y !== null && y !== undefined);
  const n = pares.length;
  if (n < 5) {
    return { rho: null, p: null, n, nota: "muestra insuficiente para calcular correlacion" };
  }
  const rx = rangos(pares.map((p) => p[0]));
  const ry = rangos(pares.map((p) => p[1]));
  const mx = rx.reduce((s, v) => s + v, 0) / n;
  const my = ry.reduce((s, v) => s + v, 0) / n;
  let num = 0;
  let sx = 0;
  let sy = 0;
  for (let i = 0; i < n; i += 1) {
    num += (rx[i] - mx) * (ry[i] - my);
    sx += (rx[i] - mx) ** 2;
    sy += (ry[i] - my) ** 2;
  }
  const den = Math.sqrt(sx * sy);
  if (den === 0) return { rho: null, p: null, n, nota: "sin varianza" };
  const rho = num / den;
  let p;
  if (Math.abs(rho) >= 1) {
    p = 0;
  } else {
    const gl = n - 2;
    const t = rho * Math.sqrt(gl / (1 - rho * rho));
    p = betainc(gl / 2, 0.5, gl / (gl + t * t));
  }
  return { rho: redondear(rho, 3), p: redondear(p, 4), n };
}

/* --------------------------------------------------------------------------
   Traduccion de las vistas al contrato de src/tipos.ts
   -------------------------------------------------------------------------- */

const NOTA_FASE_5 =
  "Lo llena la Fase 5 (backfill de la API de Instagram). Windsor no entrega este corte, " +
  "asi que hoy no hay dato: no es cero, es que no se midio.";

/** Las miniaturas viven en Supabase Storage, no en Instagram. Las URLs que
 *  devuelve la Graph API son firmadas y caducan en dias; la ruta del bucket no.
 *  `tools/ig_miniaturas.py` las descarga y deja aca solo el nombre del archivo. */
const BUCKET_MINIATURAS = "miniaturas";
function urlMiniatura(thumbPath) {
  if (!thumbPath) return null;
  return `${SUPABASE_URL}/storage/v1/object/public/${BUCKET_MINIATURAS}/${thumbPath}`;
}

function primeraLinea(v) {
  return typeof v === "string" ? v : "";
}

/** Una fila de v_pieza_ranking -> una `Pieza`. Todas las tasas cruzan aca su
 *  conversion a porcentaje; ningun null se rellena. */
function aPieza(fila, pilaresPorPieza, interaccionesPorPieza, palabraPorPieza) {
  return {
    id: fila.post_id,
    permalink: fila.permalink ?? null,
    fecha: fila.fecha_publicacion ?? "",
    tipo: fila.formato === "REEL" ? "REELS" : "FEED",
    formato: fila.formato ?? null,
    thumb: urlMiniatura(fila.thumb_path),
    primera_linea: primeraLinea(fila.primera_linea),
    pilares: pilaresPorPieza.get(fila.post_id) ?? [],
    alcance: aNumero(fila.alcance),
    vistas: aNumero(fila.vistas),
    guardados: aNumero(fila.guardados),
    compartidos: aNumero(fila.compartidos),
    likes: aNumero(fila.likes),
    comentarios: aNumero(fila.comentarios),
    interacciones: interaccionesPorPieza.get(fila.post_id) ?? null,
    seguidores: aNumero(fila.seguidores_ganados),
    guardado_pct: aPorcentaje(fila.tasa_guardado),
    compartido_pct: aPorcentaje(fila.tasa_compartido),
    like_pct: aPorcentaje(fila.tasa_like),
    comentario_pct: aPorcentaje(fila.tasa_comentario),
    metricas_faltantes: Array.isArray(fila.metricas_faltantes) ? fila.metricas_faltantes : [],
    multiplicador: redondear(aNumero(fila.multiplicador), 3),
    // Extra fuera de la interfaz `Pieza`, que la vista de palabra clave lee de
    // forma defensiva. No rompe a nadie: TypeScript solo exige que esten los
    // campos declarados, no que no haya mas.
    palabra_clave: palabraPorPieza?.get(fila.post_id) ?? null,
    pide_palabra_clave: fila.pide_palabra_clave ?? null,
  };
}

/** La mesa de trabajo. Los umbrales salen de la tabla `config`, no de
 *  constantes: mover un criterio es cambiar una fila, no editar este archivo.
 *  Cada motivo lleva los numeros concretos adentro; una lista ordenada sin
 *  explicacion no es una propuesta, es un ranking mas. */
function construirMesa(solidas, cfg, hoy) {
  const multReeditar = cfg.mult_reeditar ?? 1.5;
  const multPauta = cfg.mult_pauta ?? 1.8;
  const propuestas = [];

  const dias = (fecha) => {
    if (!fecha) return 0;
    const t = Date.parse(`${fecha}T00:00:00Z`);
    if (Number.isNaN(t)) return 0;
    return Math.floor((hoy - t) / 86_400_000);
  };

  // 1. Ganadores viejos que ya nadie ve -> reeditar.
  const viejos = solidas
    .filter((p) => p.multiplicador !== null && p.multiplicador >= multReeditar && dias(p.fecha) >= 90)
    .sort((a, b) => b.multiplicador - a.multiplicador)
    .slice(0, 5);
  for (const p of viejos) {
    propuestas.push({
      accion: "Reeditar y volver a publicar",
      pieza_id: p.id,
      permalink: p.permalink,
      thumb: p.thumb ?? null,
      titulo: p.primera_linea,
      motivo:
        `Guardo ${formatoPct(p.guardado_pct)} sobre alcance, x${formatoMult(p.multiplicador)} ` +
        `la mediana de su formato (${formatoPct(p.base_pct)}), y tiene ${dias(p.fecha)} dias. ` +
        `Rindio y ya nadie lo ve.`,
    });
  }

  // 2. Alta senal, poca distribucion -> candidato a pauta. El contenido
  //    convence; lo que falta es distribucion, y eso se compra.
  const alcanceMediano = mediana(solidas.map((p) => p.alcance)) ?? 0;
  const subdistribuidas = solidas
    .filter(
      (p) =>
        p.multiplicador !== null &&
        p.multiplicador >= multPauta &&
        p.alcance !== null &&
        p.alcance < alcanceMediano
    )
    .sort((a, b) => b.multiplicador - a.multiplicador)
    .slice(0, 4);
  for (const p of subdistribuidas) {
    propuestas.push({
      accion: "Candidato a creativo de pauta",
      pieza_id: p.id,
      permalink: p.permalink,
      thumb: p.thumb ?? null,
      titulo: p.primera_linea,
      motivo:
        `x${formatoMult(p.multiplicador)} en guardado (${formatoPct(p.guardado_pct)} contra ` +
        `${formatoPct(p.base_pct)} de su formato) pero solo ${p.alcance.toLocaleString("es-CL")} ` +
        `de alcance, bajo la mediana de ${Math.round(alcanceMediano).toLocaleString("es-CL")}. ` +
        `El contenido convence; lo que falta es distribucion, y eso se compra.`,
    });
  }

  return {
    propuestas,
    criterio:
      `Reeditar: multiplicador >= ${formatoMult(multReeditar)} y 90+ dias. ` +
      `Pauta: multiplicador >= ${formatoMult(multPauta)} con alcance bajo la mediana ` +
      `(${Math.round(alcanceMediano).toLocaleString("es-CL")}). Ambos umbrales viven en la tabla ` +
      `config de Supabase, no en el codigo. Todo se calcula solo sobre las piezas que superan ` +
      `el piso de alcance.`,
  };
}

function formatoPct(v) {
  return v === null || v === undefined ? "sin dato" : `${v.toLocaleString("es-CL", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`;
}

function formatoMult(v) {
  return v === null || v === undefined
    ? "—"
    : v.toLocaleString("es-CL", { minimumFractionDigits: 1, maximumFractionDigits: 2 });
}

/* --------------------------------------------------------------------------
   Construccion del objeto Analisis
   -------------------------------------------------------------------------- */

function faltaConfig() {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    return {
      error: "Faltan credenciales de Supabase.",
      comando: "Define SUPABASE_URL y SUPABASE_ANON_KEY en .env",
      detalle: `Se busco en ${path.relative(RAIZ, RUTA_ENV)} y en las variables de entorno. ` +
        `Este servidor solo lee: la SERVICE_KEY no sirve aca y no debe usarse.`,
    };
  }
  return null;
}

/** `cuentaId` es SIEMPRE una cuenta exacta: la de Leo para el equipo, la propia
 *  para un alumno. Nunca "todo lo que no sea competencia": con alumnos eso
 *  mezclaria sus publicaciones en el panel de Leo. */
async function construirAnalisis(jwt, seccion = "completo", cuentaId) {
  if (!cuentaId) throw new HttpError(500, "Falta la cuenta a analizar.");
  const deCuenta = `cuenta_id=eq.${encodeURIComponent(cuentaId)}`;
  const necesita = (...secciones) => seccion === "completo" || secciones.includes(seccion);
  const si = (activa, recurso, consulta = "select=*") => activa ? traer(recurso, consulta, jwt) : Promise.resolve([]);
  const sinConfig = faltaConfig();
  if (sinConfig) return sinConfig;
  if (seccion === "piezas") {
    const cfg = await traer("config", "select=valor&clave=eq.piso_alcance", jwt);
    return { piso_alcance: Number(cfg[0]?.valor ?? 500) };
  }
  if (seccion === "anuncios") {
    const [filas, campanas] = await Promise.all([traer("v_anuncio", "select=*", jwt), traer("v_campana", "select=*", jwt)]);
    return { anuncios: construirAnuncios(filas, campanas) };
  }
  if (seccion === "negocio") return await construirNegocio(jwt, deCuenta);
  if (seccion === "historias") {
    const [filas, metricas] = await Promise.all([traer("historia", `select=*&${deCuenta}&order=publicado_en.desc,historia_id.asc`, jwt), traer("historia_metrica", "select=*&order=fecha_snapshot.desc,historia_id.asc", jwt)]);
    return { historias: construirHistorias(filas, metricas) };
  }
  if (seccion === "audiencia") {
    const [filas, cuenta] = await Promise.all([traer("audiencia_snapshot", `select=*&${deCuenta}&order=fecha_snapshot.desc,corte.asc,clave.asc`, jwt), traer("cuenta_metrica", `select=*&${deCuenta}&order=fecha_snapshot.desc&limit=1`, jwt)]);
    return { audiencia: construirAudiencia(filas, cuenta[0] ?? {}) };
  }

  const [
        // ⚠️ ESTE ORDEN IMPORTA: cada nombre corresponde POSICIONALMENTE a una
    // llamada de Promise.all de abajo. Si agregas una consulta, agrega su
    // nombre en la MISMA posicion. Desalinearlo no da error: cada variable
    // recibe en silencio los datos de otra consulta.
    ranking,
    baseFormato,
    pilarRendimiento,
    efectoPalabra,
    vinculosPilar,
    piezasCatalogo,
    cuentas,
    cuentaMetrica,
    config,
    metricas,
    audienciaFilas,
    historiasFilas,
    historiasMetricas,
    cuentasTodas,
    piezasExternas,
    metricasExternas,
    metricasCuenta,
    anunciosFilas,
    campanasFilas,
  
  ] = await Promise.all([
    // Solo la cuenta propia. Desde que se cargan competidores, v_pieza_ranking
    // tambien trae sus piezas, y contarlas inflaba n_total y metia sus posts en
    // el calendario de Leo. La competencia se lee aparte, en su seccion.
    traer("v_pieza_ranking", `select=*&${deCuenta}`, jwt),
    traer("v_base_formato", `select=*&${deCuenta}`, jwt),
    si(necesita("resumen", "piezas", "palabra-clave"), "v_pilar_rendimiento", `select=*&${deCuenta}`),
    si(necesita("palabra-clave"), "v_efecto_palabra_clave", `select=*&${deCuenta}`),
    traer("pieza_pilar", "select=post_id,pilar", jwt),
    // Desde la Fase 5, `pieza` tambien guarda publicaciones de la competencia
    // (cuenta_id con prefijo `externa:`). Contarlas como catalogo de Leo
    // inflaba n_total sin que nada avisara.
    traer("pieza", `select=post_id,palabra_clave,cuenta_id&${deCuenta}`, jwt),
    traer("cuenta", `select=*&id=eq.${encodeURIComponent(cuentaId)}`, jwt),
    // Solo la cuenta propia: sin el filtro, la fila mas reciente puede ser de
    // un competidor y el KPI "Seguidores" del Resumen muestra los de otra
    // cuenta. Paso: mostro 751.269 de @therealbrianmark en vez de 106.345.
    traer("cuenta_metrica", `select=*&${deCuenta}&order=fecha_snapshot.desc&limit=90`, jwt),
    traer("config", "select=clave,valor", jwt),
    si(necesita("piezas"), "pieza_metrica", "select=post_id,fecha_snapshot,fuente,interacciones_totales"),
    si(necesita("audiencia"), "audiencia_snapshot", `select=corte,clave,valor,fecha_snapshot&${deCuenta}&order=fecha_snapshot.desc`),
    si(necesita("historias", "calendario", "resumen"), "historia", `select=*&${deCuenta}`),
    si(necesita("historias", "calendario", "resumen"), "historia_metrica", "select=*&order=fecha_snapshot.desc"),
    si(necesita("competencia"), "cuenta", "select=id,username,es_propia"),
    si(necesita("competencia"), "pieza", "select=post_id,cuenta_id,permalink,fecha_publicacion,formato,primera_linea,thumb_path&cuenta_id=like.externa:*"),
    si(necesita("competencia"), "pieza_metrica", "select=post_id,likes,comentarios,fecha_snapshot&order=fecha_snapshot.desc"),
    si(necesita("competencia"), "cuenta_metrica", "select=cuenta_id,seguidores,publicaciones,fecha_snapshot&order=fecha_snapshot.desc"),
    si(necesita("anuncios"), "v_anuncio", "select=*"),
    si(necesita("anuncios"), "v_campana", "select=*"),
  ]);

  // n_total son las piezas DENTRO DE LA VENTANA de analisis (config.ventana_meses).
  // El contenido anterior sigue en la base pero no se muestra: la cuenta cambio de
  // mensaje y de tamano, asi que mezclarlo mide otra epoca.
  const enVentana = ranking.filter((f) => f.en_ventana === true);
  const nTotal = enVentana.length;
  if (!ranking.length) {
    return {
      error: "Todavía no hay publicaciones disponibles para esta cuenta. Contacta al equipo si acabas de conectar Instagram.",
    };
  }

  const cfg = Object.fromEntries(config.map((f) => [f.clave, Number(f.valor)]));

  // Pilares por pieza. Una pieza puede estar en varios, asi que las filas de
  // `por_pilar` no suman el total y eso esta bien.
  const pilaresPorPieza = new Map();
  for (const v of vinculosPilar) {
    if (!pilaresPorPieza.has(v.post_id)) pilaresPorPieza.set(v.post_id, []);
    pilaresPorPieza.get(v.post_id).push(v.pilar);
  }
  for (const lista of pilaresPorPieza.values()) lista.sort();

  // Interacciones: no estan en la vista. Se resuelven contra la MISMA
  // observacion que uso la vista (post_id + fecha_snapshot + fuente), no
  // contra cualquier fila de la tabla.
  const porObservacion = new Map();
  for (const m of metricas) {
    porObservacion.set(`${m.post_id}|${m.fecha_snapshot}|${m.fuente}`, aNumero(m.interacciones_totales));
  }
  const interaccionesPorPieza = new Map();
  for (const f of ranking) {
    const clave = `${f.post_id}|${f.fecha_snapshot}|${f.fuente}`;
    interaccionesPorPieza.set(f.post_id, porObservacion.has(clave) ? porObservacion.get(clave) : null);
  }

  // La palabra clave declarada en la tabla `pieza`. La vista de palabra clave
  // sabe derivarla del caption, pero el dato declarado siempre gana al inferido.
  const palabraPorPieza = new Map(
    piezasCatalogo.map((p) => [p.post_id, p.palabra_clave ?? null])
  );

  const piezas = ranking.map((f) => aPieza(f, pilaresPorPieza, interaccionesPorPieza, palabraPorPieza));
  const baseDeFila = new Map(ranking.map((f) => [f.post_id, aPorcentaje(f.base_formato)]));
  for (const p of piezas) p.base_pct = baseDeFila.get(p.id) ?? null;

  const aptos = new Set(ranking.filter((f) => f.apto_ranking === true).map((f) => f.post_id));
  const solidas = piezas
    .filter((p) => aptos.has(p.id))
    .sort((a, b) => {
      if (a.guardado_pct === null) return 1;
      if (b.guardado_pct === null) return -1;
      return b.guardado_pct - a.guardado_pct;
    });

  // El calendario responde "que se publico y cuando", no "que rindio". Por eso
  // lleva TODAS las piezas, incluidas las que no superan el piso de alcance: un
  // calendario que esconde 8 publicaciones miente sobre la cadencia de Leo.
  // Va como campo aparte y liviano para no inflar `rankings.todas`.
  const idsEnVentana = new Set(enVentana.map((f) => f.post_id));
  const calendario = piezas
    .filter((p) => idsEnVentana.has(p.id))
    .map((p) => ({
      id: p.id,
      fecha: p.fecha,
      permalink: p.permalink,
      tipo: p.tipo,
      formato: p.formato,
      thumb: p.thumb,
      primera_linea: p.primera_linea,
      alcance: p.alcance,
      vistas: p.vistas,
      guardados: p.guardados,
      likes: p.likes,
      comentarios: p.comentarios,
      compartidos: p.compartidos,
      guardado_pct: p.guardado_pct,
      multiplicador: p.multiplicador,
      apto_ranking: aptos.has(p.id),
      pide_palabra_clave: p.pide_palabra_clave ?? null,
    }))
    .sort((a, b) => (a.fecha < b.fecha ? 1 : a.fecha > b.fecha ? -1 : 0));

  const nConAlcance = enVentana.filter((f) => f.alcance !== null && f.alcance !== undefined).length;

  const base_por_formato = {};
  for (const f of baseFormato) {
    if (!f.formato) continue;
    base_por_formato[f.formato] = {
      n: aNumero(f.n) ?? 0,
      guardado_pct_mediana: aPorcentaje(f.mediana_guardado),
    };
  }

  const por_pilar = {};
  for (const f of pilarRendimiento) {
    if (!f.pilar) continue;
    por_pilar[f.pilar] = {
      n: aNumero(f.n) ?? 0,
      guardado_pct_mediana: aPorcentaje(f.mediana_guardado),
      compartido_pct_mediana: aPorcentaje(f.mediana_compartido),
      alcance_mediano: aNumero(f.mediana_alcance),
    };
  }
  // "Sin clasificar" no es un pilar de la tabla: es el resto. Se calcula aca
  // para que se vea cuanto del catalogo el lexico no logro clasificar.
  const sinPilar = solidas.filter((p) => p.pilares.length === 0);
  por_pilar["Sin clasificar"] = {
    n: sinPilar.length,
    guardado_pct_mediana: redondear(mediana(sinPilar.map((p) => p.guardado_pct)), 4),
    compartido_pct_mediana: redondear(mediana(sinPilar.map((p) => p.compartido_pct)), 4),
    alcance_mediano: mediana(sinPilar.map((p) => p.alcance)),
  };

  const correlaciones = {
    like_pct_vs_guardado_pct: spearman(
      solidas.map((p) => p.like_pct),
      solidas.map((p) => p.guardado_pct)
    ),
    comentario_pct_vs_guardado_pct: spearman(
      solidas.map((p) => p.comentario_pct),
      solidas.map((p) => p.guardado_pct)
    ),
    alcance_vs_guardado_pct: spearman(
      solidas.map((p) => p.alcance),
      solidas.map((p) => p.guardado_pct)
    ),
    nota:
      "Rho de Spearman sobre las piezas que superan el piso de alcance. Se publica el numero " +
      "que salio, no una intuicion. Un rho cercano a 0 significa que esa metrica NO predice el " +
      "guardado: es un resultado, no un fallo del calculo.",
  };

  const snapshot = ranking
    .map((f) => f.fecha_snapshot)
    .filter(Boolean)
    .sort()
    .pop() ?? "";

  const hoy = snapshot ? Date.parse(`${snapshot}T00:00:00Z`) : Date.now();
  const mesa = construirMesa(solidas, cfg, hoy);

  // `base_pct` era andamio del motivo de la mesa; no esta en el contrato.
  for (const p of piezas) delete p.base_pct;

  const cuenta = cuentas[0] ?? {};
  const ultima = cuentaMetrica[0] ?? {};

  return {
    generado: new Date().toISOString(),
    cuenta: {
      username: cuenta.username ?? null,
      nombre: cuenta.nombre ?? null,
      followers_count: aNumero(ultima.seguidores),
      media_count: aNumero(ultima.publicaciones),
      foto: null,
      // Una medicion por corrida de la ingesta, de la mas vieja a la mas nueva.
      seguidores_historial: [...cuentaMetrica].reverse()
        .filter((m) => aNumero(m.seguidores) !== null)
        .map((m) => ({ fecha: m.fecha_snapshot, seguidores: aNumero(m.seguidores) })),
    },
    snapshot,
    piso_alcance: cfg.piso_alcance ?? 500,
    ventana_meses: cfg.ventana_meses ?? 12,
    n_total: nTotal,
    n_con_alcance: nConAlcance,
    n_solidos: solidas.length,
    base_por_formato,
    rankings: { todas: solidas },
    calendario,
    por_pilar,
    correlaciones,
    // Extra fuera de `Analisis`: lo consume src/views/PalabraClave.tsx, que lo
    // lee de forma defensiva. Sale de v_efecto_palabra_clave, con la misma
    // conversion a porcentaje que todo lo demas.
    efecto_palabra_clave: efectoPalabra.map((f) => ({
      pide_palabra_clave: f.pide_palabra_clave ?? null,
      n: aNumero(f.n),
      guardado_pct_mediana: aPorcentaje(f.mediana_guardado),
      alcance_mediano: aNumero(f.mediana_alcance),
    })),
    audiencia: construirAudiencia(audienciaFilas, ultima),
    historias: construirHistorias(historiasFilas, historiasMetricas),
    competencia: construirCompetencia(cuentasTodas, piezasExternas, metricasCuenta, metricasExternas),
    token: estadoToken(),
    anuncios: construirAnuncios(anunciosFilas, campanasFilas),
    mesa,
  };
}

/** Demografia: se toma el snapshot mas reciente por corte. Si un corte no vino,
 *  se devuelve vacio con su nota; no se rellena con ceros. */
function construirAudiencia(filas, ultimaCuenta) {
  const porCorte = { city: {}, country: {}, age: {}, gender: {} };
  const masReciente = filas.length ? filas[0].fecha_snapshot : null;
  for (const f of filas) {
    if (f.fecha_snapshot !== masReciente) continue;
    if (porCorte[f.corte]) porCorte[f.corte][f.clave] = aNumero(f.valor);
  }
  const vacio = Object.values(porCorte).every((o) => !Object.keys(o).length);
  return {
    ciudades: porCorte.city,
    paises: porCorte.country,
    edad: porCorte.age,
    genero: porCorte.gender,
    seguidores: aNumero(ultimaCuenta.seguidores),
    nota: vacio
      ? "Sin demografia. La API la entrega solo con 100+ seguidores en la dimension y con " +
        "instagram_manage_insights vigente. " + NOTA_FASE_5
      : `Snapshot del ${masReciente}. Instagram recalcula la demografia a su ritmo, asi que ` +
        "no cuadra al dia con el conteo de perfil.",
  };
}

/** Historias: la API NO tiene archivo mas alla de 24 horas. Lo que hay es lo que
 *  capturo la extraccion el dia que corrio. */
function construirHistorias(historias, metricas) {
  const porId = new Map();
  for (const m of metricas) if (!porId.has(m.historia_id)) porId.set(m.historia_id, m);
  const filas = historias
    .map((h) => {
      const m = porId.get(h.historia_id) ?? {};
      const alcance = aNumero(m.alcance);
      const visitas = aNumero(m.visitas_perfil);
      return {
        id: h.historia_id,
        permalink: h.permalink ?? null,
        hora: h.publicado_en ?? null,
        formato: h.formato ?? null,
        thumb: null,
        alcance,
        respuestas: aNumero(m.respuestas),
        navegacion: aNumero(m.navegacion),
        visitas_perfil: visitas,
        seguidores_ganados: aNumero(m.seguidores_ganados),
        interacciones: aNumero(m.interacciones),
        visita_perfil_pct: alcance > 0 && visitas !== null ? redondear((visitas / alcance) * 100, 4) : null,
        metricas_faltantes: [],
      };
    })
    .sort((a, b) => String(b.hora ?? "").localeCompare(String(a.hora ?? "")));
  return {
    capturadas: filas.length ? filas[0].hora : null,
    activas: filas.length,
    filas,
    nota:
      "La API de Instagram NO tiene archivo de historias: solo devuelve las activas de las " +
      "ultimas 24 horas. Sin una corrida diaria de ig_dump.py, aca solo se ven las de ese dia.",
  };
}

/** Competencia: de cuentas ajenas la API solo entrega likes y comentarios. Sin
 *  alcance no hay tasa de guardado, y por eso se compara interaccion sobre
 *  seguidores y no se rankea junto al contenido propio. */
function construirCompetencia(cuentas, piezas, metricas, metricasPieza) {
  const externas = cuentas.filter((c) => c.es_propia === false);
  const seguidoresPor = new Map();
  for (const m of metricas) if (!seguidoresPor.has(m.cuenta_id)) seguidoresPor.set(m.cuenta_id, m);
  // likes y comentarios por pieza: es lo UNICO que la API entrega de terceros.
  const metPorPieza = new Map();
  for (const m of (metricasPieza ?? [])) {
    if (!metPorPieza.has(m.post_id)) metPorPieza.set(m.post_id, m);
  }
  const salida = {};
  for (const c of externas) {
    const mc = seguidoresPor.get(c.id) ?? {};
    const seguidores = aNumero(mc.seguidores);
    const suyas = piezas
      .filter((p) => p.cuenta_id === c.id)
      .map((p) => ({
        id: p.post_id,
        permalink: p.permalink ?? null,
        fecha: p.fecha_publicacion ?? "",
        formato: p.formato ?? null,
        thumb: urlMiniatura(p.thumb_path),
        primera_linea: primeraLinea(p.primera_linea),
        likes: aNumero(metPorPieza.get(p.post_id)?.likes),
        comentarios: aNumero(metPorPieza.get(p.post_id)?.comentarios),
        interaccion_sobre_seguidores_pct: (() => {
          const m = metPorPieza.get(p.post_id);
          const inter = (aNumero(m?.likes) ?? 0) + (aNumero(m?.comentarios) ?? 0);
          // Sin seguidores no hay denominador: null, no 0.
          if (!seguidores || (m?.likes == null && m?.comentarios == null)) return null;
          return redondear((inter / seguidores) * 100, 4);
        })(),
      }))
      .sort((a, b) => String(b.fecha).localeCompare(String(a.fecha)));
    salida[c.username] = {
      username: c.username,
      seguidores,
      publicaciones: aNumero(mc.publicaciones),
      n_muestra: suyas.length,
      interaccion_mediana_pct: (() => {
        const xs = suyas
          .map((x) => x.interaccion_sobre_seguidores_pct)
          .filter((v) => v !== null)
          .sort((a, b) => a - b);
        if (!xs.length) return null;
        const k = Math.floor(xs.length / 2);
        return redondear(xs.length % 2 ? xs[k] : (xs[k - 1] + xs[k]) / 2, 4);
      })(),
      piezas: suyas,
    };
  }
  return {
    cuentas: salida,
    nota:
      "De cuentas ajenas la API solo entrega likes y comentarios: no hay alcance ni guardados, " +
      "de nadie, ni con permisos. Por eso estas piezas no entran a ningun ranking. Los conteos " +
      "cuenta debe ser Business o Creator y publica.",
  };
}

/** Anuncios de Meta. La MONEDA viaja siempre y no se convierte: la cuenta
 *  factura en CLP y el ticket del programa es en USD; mezclarlas produce un
 *  numero equivocado por un factor de ~950 que parece creible. */
function construirAnuncios(anuncios, campanas) {
  const filas = anuncios.map((a) => ({
    id: a.ad_id,
    nombre: a.nombre ?? null,
    campana: a.campana ?? null,
    conjunto: a.conjunto ?? null,
    estado: a.estado ?? null,
    permalink: a.permalink_ig ?? null,
    es_dark_post: a.es_dark_post ?? null,
    moneda: a.moneda ?? null,
    gasto: aNumero(a.gasto),
    impresiones: aNumero(a.impresiones),
    alcance: aNumero(a.alcance),
    clicks: aNumero(a.clicks),
    clicks_enlace: aNumero(a.clicks_enlace),
    ctr: aNumero(a.ctr),
    cpm: aNumero(a.cpm),
    frecuencia: aNumero(a.frecuencia),
    conversaciones: aNumero(a.conversaciones),
    costo_por_conversacion: redondear(aNumero(a.costo_por_conversacion), 0),
    costo_por_click: redondear(aNumero(a.costo_por_click), 0),
    // Retencion de video llega en fraccion: se pasa a porcentaje aca, igual
    // que todas las tasas del panel.
    retencion_video: aPorcentaje(a.retencion_video, 1),
    fecha_snapshot: a.fecha_snapshot ?? null,
  }));
  const monedas = [...new Set(filas.map((f) => f.moneda).filter(Boolean))];
  return {
    filas,
    campanas: campanas.map((c) => ({
      campana: c.campana ?? null,
      moneda: c.moneda ?? null,
      anuncios: aNumero(c.anuncios),
      activos: aNumero(c.activos),
      gasto: aNumero(c.gasto),
      impresiones: aNumero(c.impresiones),
      conversaciones: aNumero(c.conversaciones),
      costo_por_conversacion: redondear(aNumero(c.costo_por_conversacion), 0),
      ctr_mediano: aNumero(c.ctr_mediano),
    })),
    monedas,
    nota:
      monedas.length > 1
        ? `ATENCION: hay ${monedas.length} monedas en la cuenta (${monedas.join(", ")}). ` +
          "Ningun total esta sumado entre monedas."
        : `Todos los montos en ${monedas[0] ?? "?"}. No se convierten a USD: fijar un tipo de ` +
          "cambio de referencia es una decision, no un calculo.",
  };
}

/* --------------------------------------------------------------------------
   Negocio — gasto, agendas, llamadas, ventas
   Carga: tools/finanzas_a_supabase.py (workspace Prime club). Solo rol admin.

   Tres fuentes con coberturas distintas. Un periodo fuera de la cobertura de
   una fuente devuelve null para sus metricas, nunca 0: "el setter no anotaba"
   no es "no hubo ventas".
   -------------------------------------------------------------------------- */

const DIA_MS = 86_400_000;

const isoDia = (d) => d.toISOString().slice(0, 10);
const aFecha = (iso) => new Date(`${iso}T00:00:00Z`);
const lunesDe = (iso) => { const d = aFecha(iso); return isoDia(new Date(d - ((d.getUTCDay() + 6) % 7) * DIA_MS)); };
const mesDe = (iso) => `${iso.slice(0, 7)}-01`;
const finDeMes = (iso) => { const d = aFecha(iso); return isoDia(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0))); };
const sumar = (filas, f) => filas.reduce((s, x) => s + (aNumero(f(x)) ?? 0), 0);
const dividir = (a, b, escala = 1, decimales = 2) =>
  a === null || b === null || !b ? null : redondear((a / b) * escala, decimales);
const normalizarNombre = (t) => String(t ?? "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").split(/\s+/).filter(Boolean).join(" ");

async function construirNegocio(jwt, deCuenta) {
  const [gasto, dolar, agendas, leads, llamadas, cargas] = await Promise.all([
    traer("negocio_gasto_diario", "select=*", jwt),
    traer("negocio_dolar", "select=*", jwt),
    traer("negocio_agenda", "select=*", jwt),
    traer("negocio_lead", "select=id,creado,fuente,origen", jwt),
    traer("negocio_llamada", "select=*", jwt),
    traer("negocio_carga", "select=*", jwt),
  ]);
  // Sin la migracion 0015 la tabla no existe: Negocio sigue funcionando y el
  // panel avisa que las metas no estan disponibles, en vez de caerse entero.
  const metas = await traer("meta_mensual", "select=mes,metrica,objetivo", jwt)
    .catch((e) => (/PGRST205|42P01/.test(String(e?.message)) ? null : Promise.reject(e)));
  // Solo las piezas cuyo link anoto el setter en una venta: el catalogo entero
  // son miles de filas. El like es un prefiltro; el cruce exacto lo hace
  // atribuirVentas comparando la clave completa.
  const links = [...new Set(llamadas.filter((l) => l.resultado === "Cerró").map((l) => claveInstagram(l.detalle)).filter(Boolean))];
  const codigos = (prefijo) => links.filter((k) => k.startsWith(prefijo)).map((k) => k.slice(prefijo.length));
  const contiene = (cs) => `or=(${cs.map((c) => `permalink.like.*${c}*`).join(",")})`;
  const [enPiezas, enHistorias] = [codigos("publicacion:"), codigos("historia:")];
  const [piezas, historias] = await Promise.all([
    enPiezas.length ? traer("pieza", `select=post_id,permalink,fecha_publicacion,formato,primera_linea,thumb_path&${deCuenta}&${contiene(enPiezas)}`, jwt) : [],
    enHistorias.length ? traer("historia", `select=historia_id,permalink,publicado_en&${deCuenta}&${contiene(enHistorias)}`, jwt) : [],
  ]);
  if (!gasto.length && !agendas.length && !llamadas.length) {
    return {
      error: "Todavia no se cargaron datos de negocio.",
      comando: "python3 tools/finanzas_a_supabase.py",
      detalle: "Se corre desde el workspace Prime club, con la migracion 0011_negocio.sql aplicada.",
    };
  }

  const cob = Object.fromEntries(cargas.map((c) => [c.fuente, c]));
  const tc = Object.fromEntries(dolar.map((d) => [d.mes, aNumero(d.clp_por_usd)]));
  const hoy = isoDia(new Date());
  // Cubre si el periodo toca el rango de la fuente.
  const cubre = (fuente, inicio, fin) => {
    const c = cob[fuente];
    return Boolean(c && inicio <= c.cubre_hasta && fin >= c.cubre_desde);
  };

  const periodo = (inicio, fin) => {
    const en = (iso) => iso >= inicio && iso <= fin;
    const g = gasto.filter((x) => en(x.fecha));
    const conMeta = cubre("meta", inicio, fin);
    const gastoClp = conMeta ? sumar(g, (x) => x.gasto) : null;
    // Si a algun dia le falta el dolar del mes, el total en USD no existe.
    const sinTc = g.some((x) => !tc[mesDe(x.fecha)]);
    const gastoUsd = conMeta && !sinTc ? redondear(g.reduce((s, x) => s + aNumero(x.gasto) / tc[mesDe(x.fecha)], 0), 2) : null;

    const conGhl = cubre("ghl", inicio, fin);
    const nAgendas = conGhl ? agendas.filter((a) => en(a.creado)).length : null;
    const nLeads = conGhl ? leads.filter((l) => en(l.creado)).length : null;
    const cerradasGhl = conGhl ? agendas.filter((a) => a.etapa === "Cerrada" && en(a.cambio_etapa)).length : null;

    const conSetter = cubre("setter", inicio, fin);
    const ll = llamadas.filter((x) => en(x.fecha));
    const nLlamadas = conSetter ? ll.length : null;
    const asistieron = conSetter ? ll.filter((x) => x.asistio === "Sí").length : null;
    const conResultado = conSetter ? ll.filter((x) => x.asistio === "Sí" || x.asistio === "No").length : null;
    const ventas = conSetter ? ll.filter((x) => x.resultado === "Cerró").length : null;
    const ingresos = conSetter ? sumar(ll.filter((x) => x.resultado === "Cerró"), (x) => x.monto_usd) : null;
    const ingresosAnuncio = conSetter ? sumar(ll.filter((x) => x.resultado === "Cerró" && x.fuente === "Anuncio"), (x) => x.monto_usd) : null;

    const porTipo = {};
    for (const x of g) porTipo[x.tipo] = (porTipo[x.tipo] ?? 0) + (aNumero(x.gasto) ?? 0);

    return {
      inicio,
      fin,
      en_curso: fin >= hoy,
      gasto_clp: gastoClp,
      gasto_usd: gastoUsd,
      gasto_por_tipo: conMeta ? Object.entries(porTipo).map(([tipo, clp]) => ({ tipo, gasto_clp: clp })).sort((a, b) => b.gasto_clp - a.gasto_clp) : [],
      conversaciones: conMeta ? sumar(g, (x) => x.conversaciones) : null,
      conv_reales: conMeta ? sumar(g, (x) => x.conv_reales) : null,
      registros: conMeta ? sumar(g, (x) => x.registros) : null,
      leads: nLeads,
      agendas: nAgendas,
      llamadas: nLlamadas,
      llamadas_con_resultado: conResultado,
      asistieron,
      ventas,
      ingresos_usd: ingresos,
      cerradas_ghl: cerradasGhl,
      // Tasas en porcentaje (regla 1). Show rate sobre llamadas con resultado
      // anotado: una llamada de manana sin anotar no es una inasistencia.
      show_rate: dividir(asistieron, conResultado, 100, 1),
      close_rate: dividir(ventas, asistieron, 100, 1),
      costo_conversacion_usd: dividir(gastoUsd, conMeta ? sumar(g, (x) => x.conversaciones) : null),
      costo_agenda_usd: dividir(gastoUsd, nAgendas),
      cac_usd: dividir(gastoUsd, ventas),
      roas_total: ingresos === null ? null : dividir(ingresos, gastoUsd),
      roas_anuncio: ingresosAnuncio === null ? null : dividir(ingresosAnuncio, gastoUsd),
    };
  };

  const fechas = [...gasto.map((x) => x.fecha), ...agendas.map((x) => x.creado), ...llamadas.map((x) => x.fecha)].filter((f) => f <= hoy).sort();
  const primero = fechas[0];
  const ultimo = fechas[fechas.length - 1];
  const meses = [];
  for (let m = mesDe(primero); m <= ultimo; m = isoDia(new Date(aFecha(finDeMes(m)).getTime() + DIA_MS))) meses.push(periodo(m, finDeMes(m)));
  const semanas = [];
  for (let s = lunesDe(primero); s <= ultimo; s = isoDia(new Date(aFecha(s).getTime() + 7 * DIA_MS))) {
    semanas.push(periodo(s, isoDia(new Date(aFecha(s).getTime() + 6 * DIA_MS))));
  }

  // Conciliacion: GHL (etapa Cerrada) contra el setter (resultado Cerro).
  const ghlCerradas = new Map(agendas.filter((a) => a.etapa === "Cerrada").map((a) => [normalizarNombre(a.nombre), a]));
  const setterPorNombre = new Map(llamadas.map((l) => [normalizarNombre(l.prospecto), l]));
  const claves = new Set([...ghlCerradas.keys(), ...llamadas.filter((l) => l.resultado === "Cerró").map((l) => normalizarNombre(l.prospecto))]);
  const conciliacion = [...claves].sort().map((k) => {
    const g = ghlCerradas.get(k);
    const s = setterPorNombre.get(k);
    const valor = aNumero(g?.valor);
    const monto = aNumero(s?.monto_usd);
    // GHL mezcla monedas: el ticket se anota en USD (997) o en pesos (997.000).
    // Ninguna venta en USD llega a 10.000, asi que sobre eso es CLP.
    const moneda = valor === null ? null : valor >= 10000 ? "CLP" : "USD";
    const tcVenta = g ? tc[mesDe(g.cambio_etapa)] ?? tc[Object.keys(tc).sort().at(-1)] : null;
    const valorUsd = moneda === "CLP" ? (tcVenta ? redondear(valor / tcVenta, 2) : null) : valor;
    let estado;
    let ok = false;
    if (g && s?.resultado === "Cerró") {
      // Tolerancia 3 %: el dolar del mes se mueve mientras el mes sigue abierto.
      ok = !(valorUsd && monto && Math.abs(valorUsd - monto) > Math.max(1, monto * 0.03));
      estado = ok ? "Venta en ambas fuentes" : "Monto distinto: corregir el valor en GHL";
    } else if (g && s) {
      estado = `GHL dice Cerrada; el setter anoto "${s.resultado ?? "sin resultado"}" y asistio "${s.asistio ?? "sin anotar"}"`;
    } else if (g) {
      estado = "Solo en GHL: falta en el registro del setter";
    } else {
      estado = "Solo en el setter: mover la tarjeta a Cerrada en GHL";
    }
    return {
      prospecto: g?.nombre ?? s?.prospecto ?? "",
      ghl_etapa: g?.etapa ?? null,
      ghl_fecha: g?.cambio_etapa ?? null,
      ghl_valor: valor,
      ghl_moneda: moneda,
      ghl_valor_usd: valorUsd,
      setter_resultado: s?.resultado ?? null,
      setter_asistio: s?.asistio ?? null,
      setter_monto_usd: monto,
      estado,
      ok,
    };
  });

  const contar = (filas, clave) => {
    const c = {};
    for (const f of filas) { const k = f[clave] || "Sin dato"; c[k] = (c[k] ?? 0) + 1; }
    return Object.entries(c).map(([nombre, n]) => ({ nombre, n })).sort((a, b) => b.n - a.n);
  };

  return {
    negocio: {
      hoy,
      cobertura: Object.fromEntries(["meta", "ghl", "setter", "dolar"].map((f) => [f, cob[f] ? {
        desde: cob[f].cubre_desde, hasta: cob[f].cubre_hasta, cargado_en: cob[f].cargado_en, nota: cob[f].nota ?? null,
      } : null])),
      dolar: dolar.map((d) => ({ mes: d.mes, clp_por_usd: aNumero(d.clp_por_usd), fuente: d.fuente })).sort((a, b) => a.mes.localeCompare(b.mes)),
      meses,
      semanas,
      origen_agendas: contar(agendas, "origen"),
      fuente_agendas: contar(agendas, "fuente_ghl"),
      fuente_leads: contar(leads, "fuente"),
      etapas: contar(agendas, "etapa"),
      fuente_llamadas: contar(llamadas, "fuente"),
      metas: metas === null ? null : metas.map((m) => ({ mes: m.mes, metrica: m.metrica, objetivo: aNumero(m.objetivo) })),
      atribucion: atribuirVentas(
        llamadas,
        piezas.map((p) => ({ id: p.post_id, permalink: p.permalink, fecha: p.fecha_publicacion, formato: p.formato,
          titulo: primeraLinea(p.primera_linea).slice(0, 90), thumb: urlMiniatura(p.thumb_path) })),
        historias.map((h) => ({ id: h.historia_id, permalink: h.permalink, fecha: h.publicado_en })),
      ),
      conciliacion,
      llamadas: [...llamadas].sort((a, b) => b.fecha.localeCompare(a.fecha) || a.prospecto.localeCompare(b.prospecto)).map((l) => ({
        fecha: l.fecha, prospecto: l.prospecto, fuente: l.fuente ?? null, asistio: l.asistio ?? null,
        nota: aNumero(l.nota), resultado: l.resultado ?? null, plan: l.plan ?? null, monto_usd: aNumero(l.monto_usd),
        objecion: l.objecion ?? null, seguimiento: l.seguimiento ?? null,
      })),
      agendas_recientes: [...agendas].sort((a, b) => b.creado.localeCompare(a.creado)).slice(0, 40).map((a) => ({
        creado: a.creado, nombre: a.nombre ?? null, fuente_ghl: a.fuente_ghl ?? null, origen: a.origen, etapa: a.etapa ?? null,
      })),
    },
  };
}

/* --------------------------------------------------------------------------
   Competidores — escritura
   El JWT se reenvia tal cual: el RLS decide si este usuario puede escribir, y
   el trigger de la base impone el tope de 5. Este servidor NO valida permisos
   ni el tope por su cuenta; si lo hiciera habria dos fuentes de verdad y una
   de las dos quedaria desactualizada.
   -------------------------------------------------------------------------- */

/** Acepta una URL de perfil, un @usuario o un usuario pelado. Devuelve el
 *  username en minusculas, o null si no se puede extraer. */
function normalizarUsuario(entrada) {
  const t = String(entrada ?? "").trim();
  if (!t) return null;
  const m = t.match(/^https?:\/\/(?:www\.)?instagram\.com\/([A-Za-z0-9._]+)\/?(?:[?#].*)?$/i);
  const bruto = m ? m[1] : t.replace(/^@/, "");
  if (!/^[A-Za-z0-9._]{1,30}$/.test(bruto)) return null;
  return bruto.toLowerCase();
}

async function rest(recurso, { metodo = "GET", cuerpo = null, jwt, prefer } = {}) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${recurso}`, {
    signal: AbortSignal.timeout(12000),
    method: metodo,
    headers: {
      apikey: SUPABASE_ANON_KEY,
      authorization: `Bearer ${jwt}`,
      "content-type": "application/json",
      ...(prefer ? { prefer } : {}),
    },
    body: cuerpo === null ? undefined : JSON.stringify(cuerpo),
  });
  const texto = await r.text();
  let datos = null;
  try {
    datos = texto ? JSON.parse(texto) : null;
  } catch {
    /* sin cuerpo */
  }
  return { ok: r.ok, estado: r.status, datos, texto };
}

async function listarCompetidores(jwt) {
  const r = await rest("cuenta_vigilada?select=*&order=agregada_en.desc", { jwt });
  if (!r.ok) {
    throw new HttpError(502, "No se pudo leer la lista de competidores.");
  }
  const filas = r.datos ?? [];
  const activos = filas.filter((f) => f.activa).length;
  return {
    filas,
    activos,
    tope: TOPE_COMPETIDORES,
    quedan: Math.max(0, TOPE_COMPETIDORES - activos),
    nota:
      "De cuentas ajenas la API de Instagram entrega SOLO likes y comentarios. " +
      "No hay alcance ni guardados de nadie, ni con permisos: por eso estas cuentas " +
      "se comparan por interaccion sobre seguidores y no entran a los rankings del " +
      "contenido propio. La cuenta debe ser Business o Creator y publica.",
  };
}

const TOPE_COMPETIDORES = 5;

async function salud(jwt, cuentaId) {
  const sinConfig = faltaConfig();
  if (sinConfig) {
    return { ok: false, fuente: "supabase", snapshot: null,
             n_piezas: 0, n_en_ventana: 0, error: sinConfig.error };
  }
  try {
    const filas = await traer(
      "v_pieza_ranking",
      `select=post_id,fecha_snapshot,en_ventana&cuenta_id=eq.${encodeURIComponent(cuentaId)}&order=fecha_snapshot.desc`,
      jwt
    );
    // Dos numeros a proposito: `n_piezas` es cuanto hay en la base y responde
    // "esta viva la conexion"; `n_en_ventana` es cuanto entra al analisis. Que
    // no coincidan es lo normal, y tenerlos separados evita que alguien lea el
    // conteo de salud como el catalogo del panel.
    return {
      ok: filas.length > 0,
      fuente: "supabase",
      token: estadoToken(),
      snapshot: filas[0]?.fecha_snapshot ?? null,
      n_piezas: filas.length,
      n_en_ventana: filas.filter((f) => f.en_ventana === true).length,
    };
  } catch (e) {
    return {
      ok: false,
      fuente: "supabase",
      token: estadoToken(),
      snapshot: null,
      n_piezas: 0,
      n_en_ventana: 0,
      error: "No se pudo consultar Supabase.",

    };
  }
}


/* --------------------------------------------------------------------------
   HTTP
   -------------------------------------------------------------------------- */

async function identidad(req) {
  const match = /^Bearer ([A-Za-z0-9_.-]+)$/.exec(req.headers.authorization || "");
  if (!match) throw new HttpError(401, "Inicia sesión para continuar.");
  const jwt = match[1];
  const r = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: SUPABASE_ANON_KEY, authorization: `Bearer ${jwt}` },
    signal: AbortSignal.timeout(6000),
  });
  if (!r.ok) throw new HttpError(r.status >= 500 ? 503 : 401, "Tu sesión no está disponible. Vuelve a iniciar sesión.");
  const user = await r.json();
  if (!user.id) throw new HttpError(401, "Sesión inválida.");
  const miembros = await traer("usuario", `select=id,rol&id=eq.${encodeURIComponent(user.id)}`, jwt);
  if (miembros.length) {
    // Equipo: analiza la cuenta de Leo (la unica es_propia).
    const propia = await traer("cuenta", "select=id&es_propia=is.true&limit=1", jwt);
    return { jwt, id: user.id, email: user.email ?? null, tipo: "equipo", rol: miembros[0].rol, cuentaId: propia[0]?.id ?? null, conexion: null };
  }
  // Alumno: solo su propia cuenta conectada. RLS de instagram_conexion ya
  // limita a su workspace. El registro abierto de Supabase esta desactivado:
  // todo usuario autenticado fuera del equipo lo creo un admin o entro con un
  // codigo de invitacion de un solo uso (backend/registro.mjs).
  const conexiones = await traer("instagram_conexion",
    "select=id,instagram_user_id,username,estado,token_expira_en,ultima_sincronizacion,ultimo_error_publico,actualizado_en&order=actualizado_en.desc", jwt);
  const vigente = conexiones.find((c) => ["activa", "vencida", "error"].includes(c.estado)) ?? null;
  return { jwt, id: user.id, email: user.email ?? null, tipo: "alumno", rol: "alumno", cuentaId: vigente?.instagram_user_id ?? null, conexion: vigente ?? conexiones[0] ?? null };
}

const SECCIONES_ALUMNO = new Set(["resumen", "calendario", "piezas", "historias"]);

function yo(user) {
  const c = user.conexion;
  return {
    email: user.email,
    tipo: user.tipo,
    rol: user.rol,
    instagram: c ? {
      estado: c.estado, username: c.username ?? null, ultima_sincronizacion: c.ultima_sincronizacion ?? null,
      token_expira_en: c.token_expira_en ?? null, error: c.ultimo_error_publico ?? null,
    } : null,
  };
}

const SECCIONES = new Set(["completo", "resumen", "calendario", "piezas", "palabra-clave", "historias", "competencia", "audiencia", "anuncios", "mesa", "negocio"]);

async function atender(req, res) {
  const url = new URL(req.url, "http://localhost");
  if (url.pathname === "/api/health") return json(res, { ok: true });
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) throw new HttpError(503, "Falta configurar el servicio de datos.");
  const methods = {
    "/api/analisis": ["GET"], "/api/salud": ["GET"], "/api/catalogo": ["GET"],
    "/api/competidores": ["GET", "POST", "PATCH", "DELETE"],
    "/api/plan": ["GET", "POST", "PATCH", "DELETE"],
    "/api/ideas": ["GET", "POST", "PATCH"],
    "/api/ideas/sugerencias": ["GET"],
    "/api/metas": ["POST", "DELETE"],
    "/api/registro": ["POST"],
    "/api/invitaciones": ["GET", "POST", "DELETE"],
    "/api/yo": ["GET"],
    "/api/cabecera": ["GET"],
    "/api/instagram/iniciar": ["POST"],
    "/api/instagram/callback": ["POST"],
    "/api/instagram/desconectar": ["POST"],
  };
  const permitidos = methods[url.pathname];
  if (!permitidos) throw new HttpError(404, "La ruta no existe.");
  if (!permitidos.includes(req.method)) return json(res, { error: "Método no permitido." }, 405, { allow: permitidos.join(", ") });
  // Solo confiar en la cabecera de IP normalizada por Vercel. Local: socket.
  const ip = ENV.VERCEL ? req.headers["x-vercel-forwarded-for"] || "unknown" : req.socket?.remoteAddress || "local";
  if (!await rateLimit(`ip:${ip}`, 120, ENV)) return json(res, { error: "Demasiadas solicitudes. Espera un minuto." }, 429, { "retry-after": "60" });
  // Unica ruta sin sesion: quien se registra todavia no tiene cuenta. Cuota
  // propia y baja para que adivinar codigos no sea practico.
  if (url.pathname === "/api/registro") {
    if (!await rateLimit(`registro:${ip}`, 5, ENV)) return json(res, { error: "Demasiados intentos. Espera un minuto." }, 429, { "retry-after": "60" });
    return await registrarAlumno(req, res, ENV);
  }
  const user = await identidad(req);
  if (!await rateLimit(`user:${user.id}:${req.method === "GET" ? "read" : "write"}`, req.method === "GET" ? 60 : 15, ENV)) {
    return json(res, { error: "Has alcanzado el límite. Espera un minuto." }, 429, { "retry-after": "60" });
  }
  const { jwt, cuentaId } = user;
  if (url.pathname === "/api/yo") return json(res, yo(user));
  if (url.pathname.startsWith("/api/instagram/")) return await rutaInstagram(req, res, user, url.pathname, ENV);
  if (user.tipo === "alumno") {
    // Un alumno solo llega a su contenido. Todo lo demas es del equipo.
    if (!["/api/salud", "/api/analisis", "/api/catalogo", "/api/cabecera"].includes(url.pathname)) throw new HttpError(403, "Esta sección es del equipo de Prime Club.");
    if (url.pathname === "/api/analisis" && !SECCIONES_ALUMNO.has(url.searchParams.get("seccion") || "")) throw new HttpError(403, "Esta sección es del equipo de Prime Club.");
    if (!cuentaId) return json(res, { error: "Conecta tu Instagram para ver tus datos." });
  } else if (!cuentaId) {
    throw new HttpError(503, "No se encontró la cuenta principal.");
  }
  if (url.pathname === "/api/salud") return json(res, await salud(jwt, cuentaId));
  if (url.pathname === "/api/cabecera") return json(res, await cabecera(jwt, cuentaId));
  if (url.pathname === "/api/analisis") {
    const seccion = url.searchParams.get("seccion") || "completo";
    if (!SECCIONES.has(seccion)) throw new HttpError(400, "La sección no es válida.");
    // Ingresos y nombres de prospectos: solo admin. RLS ya lo impide; esto
    // evita que otro rol reciba un panel vacio que parezca "cero ventas".
    if (seccion === "negocio" && user.rol !== "admin") throw new HttpError(403, "Esta sección es solo para administración.");
    const d = await construirAnalisis(jwt, seccion, cuentaId);
    if (seccion === "negocio") return json(res, d);
    if (!d.error && seccion !== "completo") {
      if (seccion === "resumen") {
        // Detalle completo solo de los ultimos 90 dias (mejores publicaciones);
        // del resto, lo justo para comparar contra el periodo anterior.
        const corte = new Date(Date.now() - 90 * 86_400_000).toISOString().slice(0, 10);
        const corteHist = new Date(Date.now() - 180 * 86_400_000).toISOString().slice(0, 10);
        d.rankings.todas = [];
        d.calendario = d.calendario.filter(p => p.fecha >= corteHist).map(p => p.fecha >= corte
          ? { id: p.id, fecha: p.fecha, permalink: p.permalink, formato: p.formato, thumb: p.thumb,
              primera_linea: p.primera_linea.slice(0, 90), alcance: p.alcance, vistas: p.vistas, guardados: p.guardados,
              likes: p.likes, comentarios: p.comentarios, compartidos: p.compartidos }
          // Del periodo anterior solo lo que compara el Dashboard ("vs anterior").
          : { fecha: p.fecha, alcance: p.alcance, vistas: p.vistas, guardados: p.guardados, likes: p.likes, comentarios: p.comentarios });
        d.historias.filas = d.historias.filas.filter(h => (h.hora ?? "") >= corteHist)
          .map(h => ({ id: h.id, hora: h.hora, alcance: h.alcance, respuestas: h.respuestas }));
        d.mesa.propuestas = d.mesa.propuestas.slice(0,1);
        delete d.por_pilar; delete d.correlaciones;
      }
      // Evita enviar catálogos que esta pantalla no presenta.
      if (seccion !== "calendario" && seccion !== "resumen") delete d.calendario;
      if (!["resumen", "piezas", "palabra-clave"].includes(seccion)) d.rankings = { todas: [] };
      if (seccion !== "mesa" && seccion !== "resumen") d.mesa = { propuestas: [], criterio: "" };
    }
    return json(res, d);
  }
  if (url.pathname === "/api/catalogo") return json(res, await catalogo(url.searchParams, jwt, cuentaId));
  if (url.pathname === "/api/plan") return await plan(req, res, user);
  if (url.pathname === "/api/ideas/sugerencias") return json(res, await listarSugerencias(url.searchParams, jwt, cuentaId));
  if (url.pathname === "/api/ideas") return await ideas(req, res, user);
  if (url.pathname === "/api/metas") return await metas(req, res, user);
  if (url.pathname === "/api/invitaciones") return await rutaInvitaciones(req, res, user, ENV);
  if (req.method === "GET") return json(res, await listarCompetidores(jwt));
  if (user.rol === "lectura") throw new HttpError(403, "Tu acceso es de lectura.");
  const cuerpo = await readBody(req);
  if (req.method === "POST") {
    const entrada = textField(cuerpo.username ?? cuerpo.url, "Usuario", 200);
    const username = normalizarUsuario(entrada);
    if (!username) throw new HttpError(400, "Escribe un usuario o una URL de perfil de Instagram válida.");
    const r = await rest("cuenta_vigilada", { metodo: "POST", jwt, prefer: "return=representation",
      cuerpo: [{ username, url: `https://www.instagram.com/${username}/`,
        nombre: textField(cuerpo.nombre, "Nombre", 120, true), nota: textField(cuerpo.nota, "Nota", 1000, true) }] });
    comprobarEscritura(r);
    return json(res, { ok: true, competidor: r.datos?.[0] }, 201);
  }
  const id = uuid(cuerpo.id);
  if (req.method === "PATCH" && typeof cuerpo.activa !== "boolean") throw new HttpError(400, "Indica si la cuenta está activa.");
  const r = await rest(`cuenta_vigilada?id=eq.${id}`, { metodo: "PATCH", jwt, prefer: "return=representation", cuerpo: { activa: req.method === "DELETE" ? false : cuerpo.activa } });
  comprobarEscritura(r);
  if (!r.datos?.length) throw new HttpError(404, "No se encontró la cuenta.");
  return json(res, { ok: true });
}

function comprobarEscritura(r) {
  if (r.ok) return;
  if (r.texto.includes("23505")) throw new HttpError(409, "Este registro ya existe.");
  if (r.texto.includes("Tope de")) throw new HttpError(409, "Se alcanzó el máximo de competidores activos.");
  if ([401,403].includes(r.estado) || r.texto.includes("row-level security")) throw new HttpError(403, "No tienes permiso para esta acción.");
  if (r.texto.includes("PGRST205") || r.texto.includes("42P01")) throw new HttpError(503, "Esta función necesita completar la configuración de la base de datos.");
  throw new HttpError(502, "No se pudo guardar el cambio. Inténtalo de nuevo.");
}

export default async function handler(req, res) {
  try { await atender(req, res); }
  catch (e) { if (!res.headersSent) reportError(res, e); else res.end(); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  createServer(handler).listen(PUERTO, "127.0.0.1", () => console.log(`API en http://localhost:${PUERTO}`));
}

async function catalogo(params, jwt, cuentaId) {
  const pagina = Number(params.get('pagina') || 1);
  const dias = params.get('dias') || '90';
  const formato = params.get('formato') || 'todos';
  const orden = params.get('orden') || 'fecha';
  const buscar = (params.get('buscar') || '').trim();
  if (!Number.isInteger(pagina) || pagina < 1 || pagina > 400 || !['7','30','90','365'].includes(dias)) throw new HttpError(400, 'Período o página inválidos.');
  if (!['todos','REEL','CARRUSEL','IMAGEN','OTRO'].includes(formato)) throw new HttpError(400, 'Formato inválido.');
  const ordenes = { fecha: 'fecha_publicacion.desc,post_id.desc', guardado: 'tasa_guardado.desc.nullslast,post_id.desc', alcance: 'alcance.desc.nullslast,post_id.desc' };
  if (!ordenes[orden] || buscar.length > 100) throw new HttpError(400, 'Filtro inválido.');
  const desde = new Date(Date.now() - Number(dias) * 86400000).toISOString().slice(0,10);
  const q = new URLSearchParams({ select: '*', cuenta_id: `eq.${cuentaId}`, fecha_publicacion: `gte.${desde}`, order: ordenes[orden] });
  if (formato !== 'todos') q.set('formato', `eq.${formato}`);
  if (params.get('solidas') === 'true') q.set('apto_ranking', 'is.true');
  if (buscar) q.set('primera_linea', `ilike.*${buscar.replace(/[%*_,()\\]/g, ' ')}*`);
  const size = 24;
  const r = await fetch(`${SUPABASE_URL}/rest/v1/v_pieza_ranking?${q}`, {
    headers: { apikey: SUPABASE_ANON_KEY, authorization: `Bearer ${jwt}`, prefer: 'count=exact', range: `${(pagina-1)*size}-${pagina*size-1}` },
    signal: AbortSignal.timeout(12000),
  });
  if (r.status === 416) return { filas: [], total: 0, pagina, paginas: 1 };
  if (!r.ok) throw new HttpError(502, 'No pudimos cargar las publicaciones.');
  const rows = await r.json();
  const total = Number((r.headers.get('content-range') || '').split('/')[1]);
  return { filas: rows.map(f => ({ ...aPieza(f, new Map(), new Map(), new Map()), apto_ranking: f.apto_ranking === true })), total: Number.isFinite(total) ? total : rows.length, pagina, paginas: Math.max(1, Math.ceil(total/size)) };
}

async function plan(req, res, {jwt, id}) {
  if (req.method === 'GET') {
    const r = await rest('dashboard_tarea?select=*&archivada=is.false&order=fecha.asc.nullslast,creado_en.desc&limit=200', {jwt});
    comprobarEscritura(r);
    return json(res, { filas: r.datos });
  }
  const body = await readBody(req);
  const cambio = {};
  if (req.method !== 'DELETE') {
    if (req.method === 'POST' || body.titulo !== undefined) cambio.titulo = textField(body.titulo, 'Título', 160);
    if (body.nota !== undefined) cambio.nota = textField(body.nota, 'Nota', 2000, true);
    if (body.fecha !== undefined) {
      if (body.fecha !== null && (!/^\d{4}-\d{2}-\d{2}$/.test(body.fecha) || Number.isNaN(Date.parse(body.fecha)) || new Date(body.fecha).toISOString().slice(0,10) !== body.fecha)) throw new HttpError(400, 'Fecha inválida.');
      cambio.fecha = body.fecha;
    }
    if (body.estado !== undefined) {
      if (!['pendiente','en_produccion','publicada'].includes(body.estado)) throw new HttpError(400, 'Estado inválido.');
      cambio.estado = body.estado;
    }
    if (body.pieza_id !== undefined) cambio.pieza_id = textField(body.pieza_id, 'Publicación', 80, true);
  }
  if (req.method === 'DELETE') cambio.archivada = true;
  const nuevo = req.method === 'POST';
  const recurso = nuevo ? 'dashboard_tarea' : `dashboard_tarea?id=eq.${uuid(body.id)}&usuario_id=eq.${id}`;
  const r = await rest(recurso, {jwt, metodo: nuevo ? 'POST' : 'PATCH', prefer: 'return=representation', cuerpo: nuevo ? {...cambio,usuario_id:id} : cambio});
  comprobarEscritura(r);
  if (!r.datos?.length) throw new HttpError(404, 'No se encontró la tarea.');
  return json(res, {ok:true,tarea:r.datos[0]}, nuevo ? 201 : 200);
}

/* --------------------------------------------------------------------------
   Banco de ideas. RLS decide: todos leen, solo admin escribe. El chequeo de rol
   aca es para responder un mensaje claro en vez de un error de base.
   -------------------------------------------------------------------------- */

const FORMATOS_IDEA = ["historia", "carrusel", "reel", "post"];
const ESTADOS_IDEA = ["idea", "en_produccion", "lista", "publicada", "descartada"];
const ORIGENES_IDEA = ["manual", "sugerida", "propia", "competencia"];

function opcion(v, validos, campo) {
  if (!validos.includes(v)) throw new HttpError(400, `${campo} no es válido.`);
  return v;
}

function urlHttps(v, campo) {
  if (v === undefined || v === null || v === "") return null;
  const t = textField(v, campo, 1000);
  if (!/^https:\/\//.test(t)) throw new HttpError(400, `${campo} no es válido.`);
  return t;
}

const METRICAS_META = ["ingresos_usd", "ventas", "agendas", "asistieron", "conversaciones"];

/** Metas mensuales de Negocio. POST guarda o reemplaza la meta del mes; DELETE
 *  la quita. El RLS de 0015 ya limita a admin; esto evita el viaje a la base. */
async function metas(req, res, { jwt, rol }) {
  if (rol !== "admin") throw new HttpError(403, "Solo administración puede editar las metas.");
  const b = await readBody(req);
  if (typeof b.mes !== "string" || !/^\d{4}-(0[1-9]|1[0-2])-01$/.test(b.mes)) throw new HttpError(400, "El mes no es válido.");
  const metrica = opcion(b.metrica, METRICAS_META, "La métrica");
  const clave = `mes=eq.${b.mes}&metrica=eq.${metrica}`;
  if (req.method === "DELETE") {
    const r = await rest(`meta_mensual?${clave}`, { jwt, metodo: "DELETE", prefer: "return=representation" });
    comprobarEscritura(r);
    return json(res, { ok: true });
  }
  const objetivo = typeof b.objetivo === "number" ? b.objetivo : Number.NaN;
  if (!Number.isFinite(objetivo) || objetivo <= 0 || objetivo >= 1e8) throw new HttpError(400, "El objetivo tiene que ser un número mayor que cero.");
  const r = await rest("meta_mensual?on_conflict=mes,metrica", {
    jwt, metodo: "POST", prefer: "resolution=merge-duplicates,return=representation",
    cuerpo: [{ mes: b.mes, metrica, objetivo }],
  });
  comprobarEscritura(r);
  return json(res, { ok: true, meta: r.datos?.[0] ?? null });
}

async function ideas(req, res, { jwt, rol }) {
  if (req.method === "GET") {
    const r = await rest("idea?select=*&estado=neq.descartada&order=actualizado_en.desc&limit=500", { jwt });
    comprobarEscritura(r);
    return json(res, { filas: r.datos ?? [], puede_editar: rol === "admin" });
  }
  if (rol !== "admin") throw new HttpError(403, "Solo Leo e Iann pueden editar el banco de ideas.");
  const b = await readBody(req);
  const cambio = {};
  if (req.method === "POST" || b.titulo !== undefined) cambio.titulo = textField(b.titulo, "Título", 200);
  if (req.method === "POST" || b.formato !== undefined) cambio.formato = opcion(b.formato, FORMATOS_IDEA, "El formato");
  if (b.estado !== undefined) cambio.estado = opcion(b.estado, ESTADOS_IDEA, "El estado");
  if (b.hook !== undefined) cambio.hook = textField(b.hook, "Hook", 300, true);
  if (b.nota !== undefined) cambio.nota = textField(b.nota, "Nota", 3000, true);
  if (b.fecha_plan !== undefined) {
    if (b.fecha_plan !== null && !/^\d{4}-\d{2}-\d{2}$/.test(b.fecha_plan)) throw new HttpError(400, "Fecha inválida.");
    cambio.fecha_plan = b.fecha_plan;
  }
  if (req.method === "POST") {
    cambio.origen = b.origen === undefined ? "manual" : opcion(b.origen, ORIGENES_IDEA, "El origen");
    cambio.motivo = textField(b.motivo, "Motivo", 500, true);
    cambio.clave_sugerencia = textField(b.clave_sugerencia, "Clave", 160, true);
    cambio.referencia_url = urlHttps(b.referencia_url, "El enlace de referencia");
    cambio.referencia_thumb = urlHttps(b.referencia_thumb, "La miniatura");
    cambio.referencia_cuenta = textField(b.referencia_cuenta, "Cuenta", 60, true);
  }
  const nuevo = req.method === "POST";
  const r = await rest(nuevo ? "idea" : `idea?id=eq.${uuid(b.id)}`, {
    jwt, metodo: nuevo ? "POST" : "PATCH", prefer: "return=representation", cuerpo: cambio,
  });
  comprobarEscritura(r);
  if (!r.datos?.length) throw new HttpError(404, "No se encontró la idea.");
  return json(res, { ok: true, idea: r.datos[0] }, nuevo ? 201 : 200);
}

async function listarSugerencias(params, jwt, cuentaId) {
  const formato = params.get("formato");
  if (formato && !FORMATOS_IDEA.includes(formato)) throw new HttpError(400, "El formato no es válido.");
  // "desde" = cuantas sugerencias sin guardar quedan en pantalla. Guardar o
  // descartar las saca de la lista, asi que paginar por numero de pagina saltaria ideas.
  const desde = Number(params.get("desde") ?? 0);
  if (!Number.isInteger(desde) || desde < 0 || desde > 5000) throw new HttpError(400, "El parámetro desde no es válido.");
  const [d, usadas] = await Promise.all([
    construirAnalisis(jwt, "competencia", cuentaId),
    rest("idea?select=clave_sugerencia&clave_sugerencia=not.is.null&limit=5000", { jwt }),
  ]);
  if (d.error) return d;
  comprobarEscritura(usadas);
  return sugerencias({
    piezas: d.rankings?.todas ?? [],
    cuentas: d.competencia?.cuentas ?? {},
    usadas: new Set((usadas.datos ?? []).map((x) => x.clave_sugerencia)),
    formato,
    desde,
  });
}

/* --------------------------------------------------------------------------
   Barra superior: los cuatro numeros que se miran primero, de la cuenta de
   quien mira (Leo para el equipo, la propia para un alumno).
   -------------------------------------------------------------------------- */
async function cabecera(jwt, cuentaId) {
  const id = encodeURIComponent(cuentaId);
  const desde = new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10);
  const [cuentas, metricas, piezas] = await Promise.all([
    traer("cuenta", `select=username,nombre&id=eq.${id}`, jwt),
    traer("cuenta_metrica", `select=fecha_snapshot,seguidores&cuenta_id=eq.${id}&order=fecha_snapshot.desc&limit=60`, jwt),
    traer("v_pieza_ranking", `select=alcance,guardados&cuenta_id=eq.${id}&fecha_publicacion=gte.${desde}`, jwt),
  ]);
  const ultima = metricas[0];
  // Base de comparacion: la medicion mas vieja dentro de los ultimos 30 dias.
  const base = [...metricas].reverse().find((m) => m.fecha_snapshot >= desde && aNumero(m.seguidores) !== null);
  const seguidores = aNumero(ultima?.seguidores);
  const suma = (k) => {
    const v = piezas.map((p) => aNumero(p[k])).filter((x) => x !== null);
    return v.length ? v.reduce((a, b) => a + b, 0) : null;
  };
  return {
    username: cuentas[0]?.username ?? null,
    nombre: cuentas[0]?.nombre ?? null,
    seguidores,
    seguidores_30d: seguidores !== null && base && base !== ultima ? seguidores - aNumero(base.seguidores) : null,
    alcance_30d: suma("alcance"),
    guardados_30d: suma("guardados"),
    publicaciones_30d: piezas.length,
    actualizado: ultima?.fecha_snapshot ?? null,
  };
}
