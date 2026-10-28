/**
 * NIVEL 1 — alta y baja de competidores en Espia, sin red.
 *
 * fetch se simula por completo: Supabase, el contador de cuota y GitHub. Lo que
 * se prueba es la regla: maximo 5 activos, reactivar en vez de duplicar y
 * pedir el analisis inmediato a GitHub Actions.
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

/** `vigiladas` es lo que devuelve cuenta_vigilada; el resto responde lo minimo. */
function simular(vigiladas) {
  const llamadas = [];
  globalThis.fetch = async (url, op = {}) => {
    const u = String(url);
    llamadas.push({ url: u, metodo: op.method ?? "GET", cuerpo: op.body ? JSON.parse(op.body) : null });
    const r = (cuerpo, status = 200) => new Response(status === 204 ? null : JSON.stringify(cuerpo), { status });
    if (u.startsWith("https://kv.test")) return r({ result: 1 });
    if (u.includes("/auth/v1/user")) return r({ id: ID(9), email: "leo@test" });
    if (u.includes("/rest/v1/usuario")) return r([{ id: ID(9), rol: "editor" }]);
    if (u.includes("/rest/v1/cuenta?")) return r([{ id: "17841401760942939" }]);
    if (u.includes("/rest/v1/cuenta_vigilada") && (op.method ?? "GET") === "GET") return r(vigiladas);
    if (u.includes("/rest/v1/cuenta_vigilada")) return r([{ ...(JSON.parse(op.body)[0] ?? JSON.parse(op.body)), id: ID(8) }], 201);
    if (u.includes("api.github.com")) return r(null, 204);
    return r({}, 404);
  };
  return llamadas;
}

async function pedir(metodo, body) {
  const res = {
    headersSent: false, estado: 0, cuerpo: "",
    writeHead(s) { this.estado = s; this.headersSent = true; },
    end(b) { this.cuerpo = b ?? ""; },
  };
  await handler({
    method: metodo, url: "/api/competidores", body,
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
