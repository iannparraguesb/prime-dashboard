/**
 * Autoregistro de alumnos con codigo de invitacion.
 *
 *   POST /api/registro        <- { email, clave, codigo }   publico, con cuota por IP
 *   GET  /api/invitaciones    -> { filas }                  admin
 *   POST /api/invitaciones    <- { nota }  -> { codigo }    admin; el codigo se muestra una sola vez
 *   DELETE /api/invitaciones  <- { id }                     admin; revoca si no se uso
 *
 * Reglas:
 *  - El registro abierto de Supabase Auth sigue desactivado. La cuenta la crea
 *    este servidor con service_role, solo despues de reservar un codigo valido.
 *  - En la base se guarda el hash del codigo, nunca el codigo.
 *  - Un codigo invalido, usado, vencido o revocado da el mismo error: no se
 *    revela cual de las cuatro cosas paso.
 */
import crypto from "node:crypto";
import { HttpError, json, readBody, textField, uuid } from "./security.mjs";

// Crockford base32: sin I, L, O ni U, para que no se confundan al dictarlo.
const ALFABETO = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const LARGO = 10; // 50 bits
const VIGENCIA_DIAS = 14;
const CODIGO_INVALIDO = "El código no es válido, venció o ya se usó. Pídele uno nuevo al equipo de Prime Club.";

export function generarCodigo() {
  const bytes = crypto.randomBytes(LARGO);
  const c = [...bytes].map((b) => ALFABETO[b % 32]).join("");
  return `${c.slice(0, 5)}-${c.slice(5)}`;
}

/** Acepta minusculas, espacios y guiones, y las letras que se confunden con
 *  digitos. Devuelve null si no es un codigo posible. */
export function normalizarCodigo(entrada) {
  if (typeof entrada !== "string" || entrada.length > 40) return null;
  const c = entrada.toUpperCase().replace(/[\s-]/g, "").replace(/O/g, "0").replace(/[IL]/g, "1");
  return c.length === LARGO && [...c].every((x) => ALFABETO.includes(x)) ? c : null;
}

export const hashCodigo = (codigoNormalizado) => crypto.createHash("sha256").update(codigoNormalizado).digest("hex");

function config(env) {
  const c = {
    supabase: (env.SUPABASE_URL || "").replace(/\/+$/, ""), anon: env.SUPABASE_ANON_KEY, servicio: env.SUPABASE_SERVICE_KEY,
  };
  if (!c.supabase || !c.anon || !c.servicio) throw new HttpError(503, "El registro de alumnos todavía no está habilitado.");
  return c;
}

async function llamar(c, ruta, { metodo = "POST", cuerpo, jwt = null, servicio = false } = {}) {
  const r = await fetch(`${c.supabase}${ruta}`, {
    method: metodo,
    signal: AbortSignal.timeout(10000),
    headers: {
      apikey: servicio ? c.servicio : c.anon,
      authorization: `Bearer ${servicio ? c.servicio : jwt}`,
      "content-type": "application/json",
    },
    body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo),
  });
  const texto = await r.text();
  let datos = null;
  try { datos = texto ? JSON.parse(texto) : null; } catch { /* sin cuerpo */ }
  return { ok: r.ok, estado: r.status, datos, texto };
}

function falla(r, mensaje = "No se pudo completar la acción. Inténtalo de nuevo.") {
  if (r.texto.includes("sin_permiso") || r.estado === 401 || r.estado === 403) throw new HttpError(403, "No tienes permiso para esta acción.");
  if (r.texto.includes("PGRST202") || r.texto.includes("PGRST205") || r.texto.includes("42883")) {
    throw new HttpError(503, "Esta función necesita completar la configuración de la base de datos.");
  }
  throw new HttpError(502, mensaje);
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function registrarAlumno(req, res, env) {
  const c = config(env);
  const b = await readBody(req);
  const email = typeof b.email === "string" ? b.email.trim().toLowerCase() : "";
  if (!EMAIL.test(email) || email.length > 254) throw new HttpError(400, "Escribe un correo válido.");
  // 72 bytes es el tope de bcrypt: lo que pase de ahi se ignoraria en silencio.
  if (typeof b.clave !== "string" || b.clave.length < 10 || Buffer.byteLength(b.clave) > 72) {
    throw new HttpError(400, "La clave tiene que tener entre 10 y 72 caracteres.");
  }
  const codigo = normalizarCodigo(b.codigo);
  if (!codigo) throw new HttpError(400, CODIGO_INVALIDO);

  const reserva = await llamar(c, "/rest/v1/rpc/reservar_invitacion_alumno", { cuerpo: { p_hash: hashCodigo(codigo) }, servicio: true });
  if (!reserva.ok) falla(reserva);
  const invitacion = reserva.datos;
  if (!invitacion) throw new HttpError(400, CODIGO_INVALIDO);

  const alta = await llamar(c, "/auth/v1/admin/users", { cuerpo: { email, password: b.clave, email_confirm: true }, servicio: true });
  if (!alta.ok || !alta.datos?.id) {
    // La cuenta no existe: el codigo vuelve a servir.
    await llamar(c, "/rest/v1/rpc/liberar_invitacion_alumno", { cuerpo: { p_id: invitacion }, servicio: true }).catch(() => {});
    const codigoError = String(alta.datos?.error_code ?? alta.datos?.code ?? "");
    if (codigoError === "email_exists" || /already been registered/i.test(alta.texto)) {
      throw new HttpError(409, "Ya existe una cuenta con ese correo. Entra con tu clave.");
    }
    if (codigoError === "weak_password") throw new HttpError(400, "Esa clave es muy fácil de adivinar. Elige otra.");
    throw new HttpError(502, "No pudimos crear tu cuenta. Inténtalo de nuevo.");
  }

  // La cuenta ya existe: si confirmar falla no se libera el codigo, para que no
  // cree una segunda cuenta. La reserva caduca y el equipo lo ve como no usado.
  const confirmacion = await llamar(c, "/rest/v1/rpc/confirmar_invitacion_alumno", {
    cuerpo: { p_id: invitacion, p_usuario: alta.datos.id }, servicio: true,
  });
  if (!confirmacion.ok) console.error(JSON.stringify({ evento: "invitacion_sin_confirmar", invitacion }));
  return json(res, { ok: true }, 201);
}

export async function rutaInvitaciones(req, res, user, env) {
  if (user.rol !== "admin") throw new HttpError(403, "Solo administración puede invitar alumnos.");
  const c = config(env);
  if (req.method === "GET") {
    const r = await llamar(c, "/rest/v1/invitacion_alumno?select=id,nota,creado_en,expira_en,usado_en,revocado_en&order=creado_en.desc&limit=200",
      { metodo: "GET", jwt: user.jwt });
    if (!r.ok) falla(r);
    return json(res, { filas: r.datos ?? [] });
  }
  const b = await readBody(req);
  if (req.method === "POST") {
    const nota = textField(b.nota, "Nombre del alumno", 120);
    const codigo = generarCodigo();
    const r = await llamar(c, "/rest/v1/rpc/crear_invitacion_alumno", {
      cuerpo: { p_hash: hashCodigo(normalizarCodigo(codigo)), p_nota: nota, p_dias: VIGENCIA_DIAS }, jwt: user.jwt,
    });
    if (!r.ok) falla(r, "No se pudo crear el código. Inténtalo de nuevo.");
    const fila = Array.isArray(r.datos) ? r.datos[0] : r.datos;
    return json(res, { ok: true, codigo, id: fila?.id ?? null, expira_en: fila?.expira_en ?? null }, 201);
  }
  const r = await llamar(c, "/rest/v1/rpc/revocar_invitacion_alumno", { cuerpo: { p_id: uuid(b.id) }, jwt: user.jwt });
  if (!r.ok) falla(r);
  if (r.datos !== true) throw new HttpError(409, "Ese código ya se usó o ya estaba revocado.");
  return json(res, { ok: true });
}
