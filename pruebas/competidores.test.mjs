/**
 * NIVEL 1 — alta y baja de competidores en Espia, sin red.
 *
 * fetch se simula por completo: Supabase, el contador de cuota y GitHub. Lo que
 * se prueba es la regla: maximo 5 activos, reactivar en vez de duplicar y
 * pedir el analisis inmediato a GitHub Actions. Y que un alumno use la misma
 * ruta sobre SU lista: el aislamiento real lo prueba espia-alumnos-db.test.mjs
 * contra Postgres; aca se prueba lo que decide el servidor.
 */
import { test, afterEach } from "node:test";
import assert from "node:assert/strict";

Object.assign(process.env, {
  SUPABASE_URL: "https://sb.test", SUPABASE_ANON_KEY: "anon",
  UPSTASH_REDIS_REST_URL: "https://kv.test", UPSTASH_REDIS_REST_TOKEN: "kv",
  GH_WORKFLOW_TOKEN: "gh-token", GH_REPO: "iannparraguesb/prime-dashboard",
});
const { default: handler } = await import("../server.mjs");

const fetchReal = globalThis.fetch;
afterEach(() => { globalThis.fetch = fetchReal; });

const ID = (n) => `00000000-0000-4000-8000-00000000000${n}`;
const fila = (n, username, extra = {}) => ({ id: ID(n), username, activa: true, estado: "listo", agregada_en: "2026-09-01", ...extra });

const WS = "10000000-0000-4000-8000-00000000000a";

/** `vigiladas` es lo que devuelve cuenta_vigilada; el resto responde lo minimo.
 *  `alumno`: quien pide no esta en `usuario`. `workspace` es lo que responde
 *  mi_workspace_alumno(): un uuid, null (sin Instagram vigente) o 404 (0018 sin aplicar). */
function simular(vigiladas, { alumno = false, workspace = WS, conexion = "activa" } = {}) {
  const llamadas = [];
  globalThis.fetch = async (url, op = {}) => {
    const u = String(url);
    llamadas.push({ url: u, metodo: op.method ?? "GET", cuerpo: op.body ? JSON.parse(op.body) : null });
    const r = (cuerpo, status = 200) => new Response(status === 204 ? null : JSON.stringify(cuerpo), { status });
    if (u.startsWith("https://kv.test")) return r({ result: 1 });
    if (u.includes("/auth/v1/user")) return r({ id: ID(9), email: "leo@test" });
    if (u.includes("/rest/v1/usuario")) return r(alumno ? [] : [{ id: ID(9), rol: "editor" }]);
    if (u.includes("/rest/v1/instagram_conexion")) return r(conexion ? [{ id: ID(7), instagram_user_id: "ig-alumna", username: "alumna", estado: conexion }] : []);
    if (u.includes("/rest/v1/rpc/mi_workspace_alumno")) return workspace === 404 ? r({ code: "PGRST202" }, 404) : r(workspace);
    if (u.includes("/rest/v1/cuenta?")) return r([{ id: "17841401760942939" }]);
    if (u.includes("/rest/v1/cuenta_vigilada") && (op.method ?? "GET") === "GET") return r(vigiladas);
    if (u.includes("/rest/v1/cuenta_vigilada")) return r([{ ...(JSON.parse(op.body)[0] ?? JSON.parse(op.body)), id: ID(8) }], 201);
    if (u.includes("api.github.com")) return r(null, 204);
    return r({}, 404);
  };
  return llamadas;
}

async function pedir(metodo, body, ruta = "/api/competidores") {
  const res = {
    headersSent: false, estado: 0, cuerpo: "",
    writeHead(s) { this.estado = s; this.headersSent = true; },
    end(b) { this.cuerpo = b ?? ""; },
  };
  await handler({
    method: metodo, url: ruta, body,
    headers: { authorization: "Bearer jwt-leo", "content-type": "application/json" }, socket: {},
  }, res);
  return { estado: res.estado, datos: res.cuerpo ? JSON.parse(res.cuerpo) : null };
}

const escrituras = (ll) => ll.filter((l) => l.url.includes("cuenta_vigilada") && l.metodo !== "GET");
const disparos = (ll) => ll.filter((l) => l.url.includes("api.github.com"));

test("agregar una cuenta nueva la inserta y pide el analisis inmediato", async () => {
  const ll = simular([fila(1, "therealbrianmark")]);
  const r = await pedir("POST", { username: "https://www.instagram.com/Nuevo.Coach/" });
  assert.equal(r.estado, 201);
  assert.equal(r.datos.inmediato, true);
  const [w] = escrituras(ll);
  assert.equal(w.metodo, "POST");
  assert.equal(w.cuerpo[0].username, "nuevo.coach");
  assert.ok(disparos(ll)[0].url.endsWith("/actions/workflows/competencia.yml/dispatches"));
});

test("con 5 activos no se agrega una sexta ni se llama a GitHub", async () => {
  const ll = simular([1, 2, 3, 4, 5].map((n) => fila(n, `cuenta${n}`)));
  const r = await pedir("POST", { username: "sexta" });
  assert.equal(r.estado, 409);
  assert.match(r.datos.error, /Quita uno/);
  assert.equal(escrituras(ll).length, 0);
  assert.equal(disparos(ll).length, 0);
});

test("una cuenta quitada antes se reactiva en vez de duplicarse", async () => {
  const ll = simular([fila(1, "matias_strengthcoach", { activa: false })]);
  const r = await pedir("POST", { username: "@matias_strengthcoach" });
  assert.equal(r.estado, 201);
  const [w] = escrituras(ll);
  assert.equal(w.metodo, "PATCH");
  assert.ok(w.url.includes(`id=eq.${ID(1)}`));
  assert.deepEqual(w.cuerpo, { activa: true, estado: "pendiente", ultimo_error: null });
});

test("una cuenta activa sin error no se agrega dos veces; con error se reintenta", async () => {
  let ll = simular([fila(1, "therealbrianmark")]);
  assert.equal((await pedir("POST", { username: "therealbrianmark" })).estado, 409);
  assert.equal(escrituras(ll).length, 0);

  ll = simular([fila(1, "cuenta_privada", { estado: "error", ultimo_error: "no es Business" })]);
  assert.equal((await pedir("POST", { username: "cuenta_privada" })).estado, 201);
  assert.equal(escrituras(ll)[0].cuerpo.estado, "pendiente");
  assert.equal(disparos(ll).length, 1);
});

test("quitar desactiva la cuenta, no la borra", async () => {
  const ll = simular([fila(1, "therealbrianmark")]);
  const r = await pedir("DELETE", { id: ID(1) });
  assert.equal(r.estado, 200);
  const [w] = escrituras(ll);
  assert.equal(w.metodo, "PATCH");
  assert.deepEqual(w.cuerpo, { activa: false });
});

/* ---------------------------------------------------------------------------
   Alumnos
   --------------------------------------------------------------------------- */

const delAlumno = (n, username, extra = {}) => fila(n, username, { workspace_id: WS, ...extra });

test("un alumno agrega y quita competidores en su lista, con analisis inmediato", async () => {
  let ll = simular([delAlumno(1, "coach_uno")], { alumno: true });
  const alta = await pedir("POST", { username: "@Otro.Coach" });
  assert.equal(alta.estado, 201);
  assert.equal(alta.datos.inmediato, true);
  const [w] = escrituras(ll);
  assert.equal(w.cuerpo[0].username, "otro.coach");
  // El dueño de la fila lo pone la base (trigger de 0018), no el servidor.
  assert.equal("workspace_id" in w.cuerpo[0], false);
  assert.equal(disparos(ll).length, 1);

  ll = simular([delAlumno(1, "coach_uno")], { alumno: true });
  assert.equal((await pedir("DELETE", { id: ID(1) })).estado, 200);
  assert.deepEqual(escrituras(ll)[0].cuerpo, { activa: false });
});

test("la lista del alumno es solo la suya, aunque la base devolviera filas de otro dueño", async () => {
  const otro = "10000000-0000-4000-8000-00000000000b";
  simular([delAlumno(1, "mia"), fila(2, "de_leo"), fila(3, "de_otro_alumno", { workspace_id: otro })], { alumno: true });
  const r = await pedir("GET");
  assert.equal(r.estado, 200);
  assert.deepEqual(r.datos.filas.map((f) => f.username), ["mia"]);
  assert.equal(r.datos.quedan, 4);

  // Y al reves: el equipo no ve las de los alumnos.
  simular([delAlumno(1, "de_alumna"), fila(2, "de_leo")]);
  assert.deepEqual((await pedir("GET")).datos.filas.map((f) => f.username), ["de_leo"]);
});

test("el cupo del alumno es propio: la lista llena de Leo no le quita lugar", async () => {
  const deLeo = [1, 2, 3, 4, 5].map((n) => fila(n, `leo${n}`));
  let ll = simular([...deLeo, delAlumno(6, "mia")], { alumno: true });
  assert.equal((await pedir("POST", { username: "leo1" })).estado, 201, "puede vigilar una que tambien vigila Leo");
  assert.equal(escrituras(ll)[0].metodo, "POST");

  ll = simular([1, 2, 3, 4, 5].map((n) => delAlumno(n, `mia${n}`)), { alumno: true });
  const r = await pedir("POST", { username: "sexta" });
  assert.equal(r.estado, 409);
  assert.equal(escrituras(ll).length, 0);
});

test("sin la migracion 0018 el alumno no escribe: Espia avisa que se esta activando", async () => {
  const ll = simular([fila(1, "de_leo")], { alumno: true, workspace: 404 });
  for (const [metodo, cuerpo] of [["GET"], ["POST", { username: "coach" }], ["DELETE", { id: ID(1) }]]) {
    const r = await pedir(metodo, cuerpo);
    assert.equal(r.estado, 503, metodo);
    assert.match(r.datos.error, /activando Espía/);
  }
  assert.equal(ll.filter((l) => l.url.includes("cuenta_vigilada")).length, 0, "ni siquiera lee la tabla");
  assert.equal(disparos(ll).length, 0);
});

test("un alumno sin Instagram vigente no usa Espia", async () => {
  let ll = simular([], { alumno: true, conexion: null });
  let r = await pedir("POST", { username: "coach" });
  assert.match(r.datos.error, /Conecta tu Instagram/);
  assert.equal(escrituras(ll).length, 0);

  // Conexion a la vista del servidor, pero la base ya no la da por vigente.
  ll = simular([], { alumno: true, workspace: null });
  r = await pedir("POST", { username: "coach" });
  assert.equal(r.estado, 403);
  assert.equal(escrituras(ll).length + disparos(ll).length, 0);
});

test("el alumno llega a Espia pero no al resto de lo que es del equipo", async () => {
  simular([], { alumno: true });
  for (const ruta of ["/api/ideas", "/api/ideas/sugerencias", "/api/plan", "/api/invitaciones",
    "/api/analisis?seccion=mesa", "/api/analisis?seccion=anuncios", "/api/analisis?seccion=negocio", "/api/analisis?seccion=completo", "/api/analisis"]) {
    const r = await pedir("GET", undefined, ruta);
    assert.equal(r.estado, 403, ruta);
    assert.match(r.datos.error, /equipo de Prime Club/, ruta);
  }
  assert.notEqual((await pedir("GET", undefined, "/api/analisis?seccion=competencia")).estado, 403);
});
