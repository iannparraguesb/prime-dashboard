import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { generarCodigo, normalizarCodigo, hashCodigo, registrarAlumno, rutaInvitaciones } from "../backend/registro.mjs";

const ENV = { SUPABASE_URL: "https://x.supabase.co", SUPABASE_ANON_KEY: "anon", SUPABASE_SERVICE_KEY: "servicio" };
const original = globalThis.fetch;
afterEach(() => { globalThis.fetch = original; });

/** fetch simulado: responde segun la ruta y registra cada llamada. */
function simular(respuestas) {
  const llamadas = [];
  globalThis.fetch = async (url, op = {}) => {
    llamadas.push({ url: String(url), op, cuerpo: op.body ? JSON.parse(op.body) : null });
    const clave = Object.keys(respuestas).find((k) => String(url).includes(k));
    const [estado, cuerpo] = respuestas[clave] ?? [404, {}];
    return new Response(cuerpo === undefined ? "" : JSON.stringify(cuerpo), { status: estado });
  };
  return llamadas;
}
const res = () => ({ cuerpo: null, codigo: null, headersSent: false, writeHead(c) { this.codigo = c; }, setHeader() {}, end(t) { this.cuerpo = t; } });
const req = (cuerpo) => {
  const texto = JSON.stringify(cuerpo);
  return { headers: { "content-type": "application/json", "content-length": String(texto.length) }, body: cuerpo,
    async *[Symbol.asyncIterator]() { yield Buffer.from(texto); } };
};
const ID = "11111111-1111-4111-8111-111111111111";
const USUARIO = "22222222-2222-4222-8222-222222222222";
const BIEN = { email: "Alumna@Correo.com ", clave: "una-clave-larga", codigo: "abcde-fghjk" };

test("el codigo generado tiene 10 caracteres sin letras ambiguas y se normaliza igual", () => {
  for (let i = 0; i < 200; i++) {
    const c = generarCodigo();
    assert.match(c, /^[0-9A-HJKMNP-TV-Z]{5}-[0-9A-HJKMNP-TV-Z]{5}$/);
    assert.equal(normalizarCodigo(c), c.replace("-", ""));
  }
});

test("normalizar tolera minusculas, espacios, guiones y O/I/L dictadas por error", () => {
  assert.equal(normalizarCodigo(" abcde fghjk "), "ABCDEFGHJK");
  assert.equal(normalizarCodigo("ABCDE-FGHJK"), "ABCDEFGHJK");
  assert.equal(normalizarCodigo("o1il0-22222"), "01110" + "22222");
  for (const malo of ["", "ABCD", "ABCDEFGHJKM", "UUUUU-UUUUU", null, 123, "A".repeat(50)]) assert.equal(normalizarCodigo(malo), null, String(malo));
});

test("registro feliz: reserva por hash, crea la cuenta confirmada y marca el codigo", async () => {
  const llamadas = simular({
    "rpc/reservar_invitacion_alumno": [200, ID],
    "auth/v1/admin/users": [200, { id: USUARIO }],
    "rpc/confirmar_invitacion_alumno": [200, true],
  });
  const r = res();
  await registrarAlumno(req(BIEN), r, ENV);
  assert.equal(r.codigo, 201);
  assert.deepEqual(llamadas.map((l) => new URL(l.url).pathname), [
    "/rest/v1/rpc/reservar_invitacion_alumno", "/auth/v1/admin/users", "/rest/v1/rpc/confirmar_invitacion_alumno",
  ]);
  assert.equal(llamadas[0].cuerpo.p_hash, hashCodigo("ABCDEFGHJK"));
  assert.ok(!JSON.stringify(llamadas[0].cuerpo).includes("ABCDE"), "el codigo no viaja en claro a la base");
  assert.deepEqual(llamadas[1].cuerpo, { email: "alumna@correo.com", password: "una-clave-larga", email_confirm: true });
  assert.deepEqual(llamadas[2].cuerpo, { p_id: ID, p_usuario: USUARIO });
  for (const l of llamadas) assert.equal(l.op.headers.authorization, "Bearer servicio");
  assert.ok(!r.cuerpo.includes("una-clave-larga"));
});

test("un codigo que no sirve da el mismo error y no crea ninguna cuenta", async () => {
  const llamadas = simular({ "rpc/reservar_invitacion_alumno": [200, null] });
  await assert.rejects(registrarAlumno(req(BIEN), res(), ENV), (e) => e.status === 400 && /venció o ya se usó/.test(e.message));
  assert.ok(!llamadas.some((l) => l.url.includes("admin/users")));
});

test("datos invalidos se rechazan antes de tocar la base", async () => {
  const llamadas = simular({});
  for (const [cuerpo, patron] of [
    [{ ...BIEN, email: "sin-arroba" }, /correo válido/],
    [{ ...BIEN, clave: "corta" }, /entre 10 y 72/],
    [{ ...BIEN, clave: "ñ".repeat(40) }, /entre 10 y 72/],
    [{ ...BIEN, codigo: "123" }, /venció o ya se usó/],
  ]) {
    await assert.rejects(registrarAlumno(req(cuerpo), res(), ENV), patron);
  }
  assert.equal(llamadas.length, 0);
});

test("si la cuenta ya existe se libera el codigo y se avisa que entre", async () => {
  const llamadas = simular({
    "rpc/reservar_invitacion_alumno": [200, ID],
    "auth/v1/admin/users": [422, { error_code: "email_exists", msg: "A user with this email address has already been registered" }],
    "rpc/liberar_invitacion_alumno": [200, undefined],
  });
  await assert.rejects(registrarAlumno(req(BIEN), res(), ENV), (e) => e.status === 409 && /Entra con tu clave/.test(e.message));
  assert.ok(llamadas.some((l) => l.url.includes("liberar_invitacion_alumno") && l.cuerpo.p_id === ID));
});

test("si falla crear la cuenta por otra razon tambien se libera, sin filtrar el detalle", async () => {
  const llamadas = simular({
    "rpc/reservar_invitacion_alumno": [200, ID],
    "auth/v1/admin/users": [500, { msg: "detalle interno servicio" }],
    "rpc/liberar_invitacion_alumno": [200, undefined],
  });
  await assert.rejects(registrarAlumno(req(BIEN), res(), ENV), (e) => e.status === 502 && !e.message.includes("interno"));
  assert.ok(llamadas.some((l) => l.url.includes("liberar_invitacion_alumno")));
});

test("sin service key el registro queda deshabilitado", async () => {
  await assert.rejects(registrarAlumno(req(BIEN), res(), { ...ENV, SUPABASE_SERVICE_KEY: "" }), (e) => e.status === 503);
});

const admin = { rol: "admin", jwt: "jwt-admin" };

test("invitaciones: solo admin, y con su JWT, nunca con la service key", async () => {
  await assert.rejects(rutaInvitaciones({ method: "GET" }, res(), { rol: "lectura", jwt: "j" }, ENV), (e) => e.status === 403);
  const llamadas = simular({ "invitacion_alumno?select": [200, [{ id: ID, nota: "Ana" }]] });
  const r = res();
  await rutaInvitaciones({ method: "GET" }, r, admin, ENV);
  assert.equal(JSON.parse(r.cuerpo).filas[0].nota, "Ana");
  assert.equal(llamadas[0].op.headers.authorization, "Bearer jwt-admin");
  assert.ok(!llamadas[0].url.includes("codigo_hash"));
});

test("crear invitacion devuelve el codigo una vez y a la base solo le llega su hash", async () => {
  const llamadas = simular({ "rpc/crear_invitacion_alumno": [200, [{ id: ID, expira_en: "2026-11-02T00:00:00Z" }]] });
  const r = res();
  await rutaInvitaciones({ method: "POST", ...req({ nota: " Ana Pérez " }) }, r, admin, ENV);
  const d = JSON.parse(r.cuerpo);
  assert.equal(r.codigo, 201);
  assert.match(d.codigo, /^[0-9A-Z]{5}-[0-9A-Z]{5}$/);
  assert.deepEqual(llamadas[0].cuerpo, { p_hash: hashCodigo(normalizarCodigo(d.codigo)), p_nota: "Ana Pérez", p_dias: 14 });
  assert.equal(llamadas[0].op.headers.authorization, "Bearer jwt-admin");
});

test("revocar uno ya usado avisa en vez de fingir que funciono", async () => {
  simular({ "rpc/revocar_invitacion_alumno": [200, false] });
  await assert.rejects(rutaInvitaciones({ method: "DELETE", ...req({ id: ID }) }, res(), admin, ENV), (e) => e.status === 409);
  await assert.rejects(rutaInvitaciones({ method: "DELETE", ...req({ id: "x&id=neq.x" }) }, res(), admin, ENV), (e) => e.status === 400);
});
