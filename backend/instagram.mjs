/**
 * Conexion de Instagram para alumnos (Instagram API with Instagram Login).
 *
 *   POST /api/instagram/iniciar      -> { url }   a donde mandar al alumno
 *   POST /api/instagram/callback     <- { code, state }  (lo envia /conectar/instagram)
 *   POST /api/instagram/desconectar
 *
 * Reglas:
 *  - El `state` es aleatorio (32 bytes), se guarda solo su hash, vence en 10
 *    minutos y se consume una vez, y solo por quien lo pidio (RPC atomica).
 *  - El instagram_user_id sale de Meta, nunca del navegador.
 *  - El token va a Supabase Vault. No se devuelve, no se loguea, no viaja en
 *    URLs propias. Los errores publicos no incluyen respuestas de Meta.
 *  - Unico lugar del servidor que usa SUPABASE_SERVICE_KEY, y solo para las
 *    RPCs que exigen service_role (consumir el state y guardar la conexion).
 */
import crypto from "node:crypto";
import { HttpError, json, readBody } from "./security.mjs";

const SCOPES = ["instagram_business_basic", "instagram_business_manage_insights"];
const API = "https://graph.instagram.com";
const VERSION = "v23.0";
const CUENTAS_PROFESIONALES = new Set(["BUSINESS", "MEDIA_CREATOR"]);

export function configuracion(env) {
  const c = {
    appId: env.IG_APP_ID, secreto: env.IG_APP_SECRET, redirect: env.IG_REDIRECT_URI,
    supabase: (env.SUPABASE_URL || "").replace(/\/+$/, ""), anon: env.SUPABASE_ANON_KEY, servicio: env.SUPABASE_SERVICE_KEY,
  };
  if (Object.values(c).some((v) => !v)) throw new HttpError(503, "La conexión con Instagram todavía no está habilitada.");
  // Opcional: sin token ni repo, la primera sincronizacion espera al cron.
  return { ...c, gh: { token: env.GH_WORKFLOW_TOKEN || "", repo: env.GH_REPO || "", ref: env.GH_WORKFLOW_REF || "main" } };
}

export const hashEstado = (estado) => crypto.createHash("sha256").update(estado).digest("hex");

/** URL de autorizacion de Instagram. Separada para poder probarla. */
export function urlAutorizacion(c, estado) {
  const q = new URLSearchParams({
    client_id: c.appId, redirect_uri: c.redirect, response_type: "code", scope: SCOPES.join(","), state: estado,
  });
  return `https://www.instagram.com/oauth/authorize?${q}`;
}

const ERRORES_RPC = {
  cuenta_del_equipo: [400, "Las cuentas del equipo no conectan Instagram desde aquí."],
  cuenta_en_uso: [409, "Esta cuenta de Instagram ya está conectada a otro usuario del panel."],
  sin_permiso: [403, "No tienes permiso para cambiar esta conexión."],
  workspace_suspendido: [403, "Tu acceso está suspendido. Escríbele al equipo de Prime Club."],
  estado_invalido: [400, "El enlace de conexión no es válido. Vuelve a intentarlo."],
};

async function rpc(c, nombre, args, { jwt = null, servicio = false } = {}) {
  const clave = servicio ? c.servicio : c.anon;
  const r = await fetch(`${c.supabase}/rest/v1/rpc/${nombre}`, {
    method: "POST",
    signal: AbortSignal.timeout(10000),
    headers: { apikey: clave, authorization: `Bearer ${servicio ? c.servicio : jwt}`, "content-type": "application/json" },
    body: JSON.stringify(args),
  });
  const texto = await r.text();
  if (!r.ok) {
    const conocido = Object.keys(ERRORES_RPC).find((k) => texto.includes(k));
    if (conocido) throw new HttpError(...ERRORES_RPC[conocido]);
    throw new HttpError(502, "No pudimos guardar la conexión. Inténtalo de nuevo.");
  }
  return texto ? JSON.parse(texto) : null;
}

/** Llamada a Meta. Ningun detalle de la respuesta llega al usuario. */
async function meta(url, opciones = {}) {
  const r = await fetch(url, { ...opciones, signal: AbortSignal.timeout(10000) });
  const d = await r.json().catch(() => ({}));
  if (!r.ok || d.error || d.error_type) {
    console.error(JSON.stringify({ evento: "instagram_oauth_error", paso: new URL(url).pathname, estado: r.status }));
    throw new HttpError(502, "Instagram no aceptó la conexión. Vuelve a intentarlo en unos minutos.");
  }
  return d;
}

/** code -> token corto -> token de 60 dias -> perfil. Exportada para pruebas con fetch simulado. */
export async function intercambiar(c, code, redirect) {
  const corto = await meta("https://api.instagram.com/oauth/access_token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: c.appId, client_secret: c.secreto, grant_type: "authorization_code", redirect_uri: redirect, code }),
  });
  const datosCorto = Array.isArray(corto.data) ? corto.data[0] : corto;
  if (!datosCorto?.access_token) throw new HttpError(502, "Instagram no aceptó la conexión. Vuelve a intentarlo en unos minutos.");
  const permisos = String(datosCorto.permissions ?? "").split(",").map((x) => x.trim()).filter(Boolean);

  const largo = await meta(`${API}/access_token?${new URLSearchParams({ grant_type: "ig_exchange_token", client_secret: c.secreto, access_token: datosCorto.access_token })}`);
  const perfil = await meta(`${API}/${VERSION}/me?fields=user_id,username,account_type`, {
    headers: { authorization: `Bearer ${largo.access_token}` },
  });
  if (!CUENTAS_PROFESIONALES.has(perfil.account_type)) {
    throw new HttpError(400, "Tu cuenta de Instagram tiene que ser profesional (empresa o creador). Cámbiala en Instagram y vuelve a intentarlo.");
  }
  const faltan = SCOPES.filter((s) => permisos.length && !permisos.includes(s));
  if (faltan.length) throw new HttpError(400, "Para analizar tu contenido necesitamos que aceptes todos los permisos. Vuelve a intentarlo.");
  return {
    igUserId: String(perfil.user_id ?? perfil.id),
    username: perfil.username ?? null,
    tipo: perfil.account_type,
    token: largo.access_token,
    expira: new Date(Date.now() + Number(largo.expires_in ?? 5_184_000) * 1000).toISOString(),
    permisos: permisos.length ? permisos : SCOPES,
  };
}

/** Pide a GitHub Actions la sincronizacion apenas un alumno conecta, en vez de
 *  esperar el cron (GitHub lo atrasa hasta 10 h). Nunca lanza: la conexion ya
 *  quedo guardada y, si esto falla, el cron la recoge igual. */
export async function dispararSincronizacion(c) {
  const { token, repo, ref } = c.gh;
  if (!token || !repo) {
    console.error(JSON.stringify({ evento: "instagram_sync_sin_disparo" }));
    return false;
  }
  try {
    const r = await fetch(`https://api.github.com/repos/${repo}/actions/workflows/sync-instagram.yml/dispatches`, {
      method: "POST",
      signal: AbortSignal.timeout(8000),
      headers: {
        authorization: `Bearer ${token}`, accept: "application/vnd.github+json", "content-type": "application/json",
        "user-agent": "prime-dashboard-contenido", "x-github-api-version": "2022-11-28",
      },
      body: JSON.stringify({ ref }),
    });
    if (r.ok) return true;
    console.error(JSON.stringify({ evento: "instagram_sync_disparo_error", estado: r.status }));
  } catch (e) {
    console.error(JSON.stringify({ evento: "instagram_sync_disparo_error", error: e?.name }));
  }
  return false;
}

export async function rutaInstagram(req, res, user, ruta, env) {
  const c = configuracion(env);
  if (user.tipo !== "alumno") throw new HttpError(400, "Las cuentas del equipo no conectan Instagram desde aquí.");

  if (ruta === "/api/instagram/iniciar") {
    const estado = crypto.randomBytes(32).toString("base64url");
    await rpc(c, "crear_estado_oauth", { p_hash: hashEstado(estado), p_redirect: c.redirect }, { jwt: user.jwt });
    return json(res, { url: urlAutorizacion(c, estado) });
  }

  if (ruta === "/api/instagram/callback") {
    const b = await readBody(req);
    if (typeof b.state !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(b.state)) throw new HttpError(400, "El enlace de conexión no es válido. Vuelve a intentarlo.");
    if (typeof b.code !== "string" || !b.code || b.code.length > 2000) throw new HttpError(400, "Instagram no devolvió un código válido. Vuelve a intentarlo.");
    const filas = await rpc(c, "consumir_estado_oauth", { p_hash: hashEstado(b.state), p_usuario: user.id }, { servicio: true });
    const estado = Array.isArray(filas) ? filas[0] : null;
    if (!estado) throw new HttpError(400, "El enlace de conexión venció o ya se usó. Vuelve a intentarlo.");
    // Instagram agrega "#_" al final del code en algunas versiones.
    const conexion = await intercambiar(c, b.code.replace(/#_$/, ""), estado.redirect_uri);
    await rpc(c, "guardar_conexion_instagram", {
      p_workspace: estado.workspace_id, p_usuario: user.id, p_ig: conexion.igUserId, p_username: conexion.username,
      p_tipo: conexion.tipo, p_token: conexion.token, p_expira: conexion.expira, p_scopes: conexion.permisos,
    }, { servicio: true });

    // Con await: en Vercel, lo que queda pendiente al responder puede no ejecutarse.
    await dispararSincronizacion(c);

    return json(res, { ok: true, username: conexion.username });
  }

  if (ruta === "/api/instagram/desconectar") {
    await rpc(c, "desconectar_instagram", {}, { jwt: user.jwt });
    return json(res, { ok: true });
  }
  throw new HttpError(404, "La ruta no existe.");
}
