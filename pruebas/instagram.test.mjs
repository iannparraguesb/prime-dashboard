import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { configuracion, hashEstado, urlAutorizacion, intercambiar, rutaInstagram, dispararWorkflow } from "../backend/instagram.mjs";

const ENV = {
  IG_APP_ID: "123", IG_APP_SECRET: "secreto-app", IG_REDIRECT_URI: "https://app.primeclubacademy.io/conectar/instagram",
  SUPABASE_URL: "https://x.supabase.co", SUPABASE_ANON_KEY: "anon", SUPABASE_SERVICE_KEY: "servicio",
};
const c = configuracion(ENV);
const original = globalThis.fetch;
afterEach(() => { globalThis.fetch = original; });

/** fetch simulado: responde segun la ruta y registra cada llamada. */
function simular(respuestas) {
  const llamadas = [];
  globalThis.fetch = async (url, op = {}) => {
    llamadas.push({ url: String(url), op });
    const clave = Object.keys(respuestas).find((k) => String(url).includes(k));
    const [estado, cuerpo] = respuestas[clave] ?? [404, {}];
    return new Response(estado === 204 ? null : JSON.stringify(cuerpo), { status: estado });
  };
  return llamadas;
}

test("sin configuracion completa la conexion queda deshabilitada", () => {
  assert.throws(() => configuracion({ ...ENV, IG_APP_SECRET: "" }), /todavía no está habilitada/);
});

test("la URL de autorizacion pide solo los permisos minimos y lleva el state", () => {
  const u = new URL(urlAutorizacion(c, "abc"));
  assert.equal(u.origin + u.pathname, "https://www.instagram.com/oauth/authorize");
  assert.equal(u.searchParams.get("scope"), "instagram_business_basic,instagram_business_manage_insights");
  assert.equal(u.searchParams.get("state"), "abc");
  assert.equal(u.searchParams.get("redirect_uri"), ENV.IG_REDIRECT_URI);
  assert.equal(hashEstado("abc").length, 64);
});

const FELIZ = {
  "api.instagram.com/oauth/access_token": [200, { data: [{ access_token: "corto", user_id: "1", permissions: "instagram_business_basic,instagram_business_manage_insights" }] }],
  "graph.instagram.com/access_token": [200, { access_token: "largo", expires_in: 5183944 }],
  "/me?": [200, { user_id: "17841400000000001", username: "coach_ana", account_type: "BUSINESS" }],
};

test("intercambio: token de 60 dias, perfil profesional y el token del perfil va en cabecera", async () => {
  const llamadas = simular(FELIZ);
  const r = await intercambiar(c, "code", ENV.IG_REDIRECT_URI);
  assert.equal(r.igUserId, "17841400000000001");
  assert.equal(r.token, "largo");
  assert.ok(Date.parse(r.expira) > Date.now() + 59 * 86_400_000);
  const perfil = llamadas.find((l) => l.url.includes("/me?"));
  assert.ok(!perfil.url.includes("largo"), "el token no viaja en la URL");
  assert.equal(perfil.op.headers.authorization, "Bearer largo");
});

test("una cuenta personal se rechaza con un mensaje claro", async () => {
  simular({ ...FELIZ, "/me?": [200, { user_id: "9", username: "personal", account_type: "PERSONAL" }] });
  await assert.rejects(intercambiar(c, "code", ENV.IG_REDIRECT_URI), /tiene que ser profesional/);
});

test("si faltan permisos no se guarda nada", async () => {
  simular({ ...FELIZ, "api.instagram.com/oauth/access_token": [200, { access_token: "corto", user_id: "1", permissions: "instagram_business_basic" }] });
  await assert.rejects(intercambiar(c, "code", ENV.IG_REDIRECT_URI), /aceptes todos los permisos/);
});

test("un error de Meta no filtra su respuesta al usuario", async () => {
  simular({ "api.instagram.com/oauth/access_token": [400, { error_type: "OAuthException", error_message: "detalle interno con secreto-app" }] });
  await assert.rejects(intercambiar(c, "code", ENV.IG_REDIRECT_URI), (e) => !e.message.includes("secreto-app") && /no aceptó la conexión/.test(e.message));
});

const res = () => ({ cuerpo: null, codigo: null, headersSent: false, writeHead(c) { this.codigo = c; }, setHeader() {}, end(t) { this.cuerpo = t; } });
const req = (cuerpo) => {
  const texto = JSON.stringify(cuerpo);
  return { headers: { "content-type": "application/json", "content-length": String(texto.length) }, body: cuerpo,
    async *[Symbol.asyncIterator]() { yield Buffer.from(texto); } };
};

test("el equipo no puede usar la conexion de alumnos", async () => {
  await assert.rejects(rutaInstagram(req({}), res(), { tipo: "equipo", id: "u", jwt: "j" }, "/api/instagram/iniciar", ENV), /equipo no conectan/);
});

test("un state malformado o un state consumido no avanzan", async () => {
  const alumno = { tipo: "alumno", id: "00000000-0000-4000-8000-00000000000a", jwt: "j" };
  await assert.rejects(rutaInstagram(req({ code: "x", state: "corto" }), res(), alumno, "/api/instagram/callback", ENV), /no es válido/);
  simular({ "/rpc/consumir_estado_oauth": [200, []] });
  await assert.rejects(rutaInstagram(req({ code: "x", state: "A".repeat(43) }), res(), alumno, "/api/instagram/callback", ENV), /venció o ya se usó/);
});

// Callback completo: state valido, Meta responde, la conexion se guarda.
const CONECTA = {
  "/rpc/consumir_estado_oauth": [200, [{ workspace_id: "w", redirect_uri: ENV.IG_REDIRECT_URI }]],
  ...FELIZ,
  "/rpc/guardar_conexion_instagram": [200, null],
};
const ALUMNO = { tipo: "alumno", id: "00000000-0000-4000-8000-00000000000a", jwt: "j" };
const CON_GH = { ...ENV, GH_WORKFLOW_TOKEN: "gh-token", GH_REPO: "iannparraguesb/prime-dashboard" };
const DISPATCH = "api.github.com/repos/iannparraguesb/prime-dashboard/actions/workflows/sync-instagram.yml/dispatches";

test("conectar pide la sincronizacion a GitHub sin esperar el cron", async () => {
  const llamadas = simular({ ...CONECTA, [DISPATCH]: [204, null] });
  const r = res();
  await rutaInstagram(req({ code: "x", state: "A".repeat(43) }), r, ALUMNO, "/api/instagram/callback", CON_GH);
  assert.deepEqual(JSON.parse(r.cuerpo), { ok: true, username: "coach_ana" });
  const gh = llamadas.find((l) => l.url.includes(DISPATCH));
  assert.ok(gh, "se llamo al workflow");
  assert.equal(gh.op.headers.authorization, "Bearer gh-token");
  assert.deepEqual(JSON.parse(gh.op.body), { ref: "main" });
});

test("sin token de GitHub la conexion se guarda igual y no se llama a GitHub", async () => {
  const llamadas = simular(CONECTA);
  const r = res();
  await rutaInstagram(req({ code: "x", state: "A".repeat(43) }), r, ALUMNO, "/api/instagram/callback", ENV);
  assert.equal(JSON.parse(r.cuerpo).ok, true);
  assert.ok(!llamadas.some((l) => l.url.includes("api.github.com")));
});

test("si GitHub rechaza el disparo, el alumno igual queda conectado", async () => {
  simular({ ...CONECTA, [DISPATCH]: [401, { message: "Bad credentials" }] });
  const r = res();
  await rutaInstagram(req({ code: "x", state: "A".repeat(43) }), r, ALUMNO, "/api/instagram/callback", CON_GH);
  assert.equal(JSON.parse(r.cuerpo).ok, true);
});

test("iniciar guarda solo el hash del state", async () => {
  const llamadas = simular({ "/rpc/crear_estado_oauth": [200, null] });
  const r = res();
  await rutaInstagram(req({}), r, { tipo: "alumno", id: "u", jwt: "jwt-alumno" }, "/api/instagram/iniciar", ENV);
  const estado = new URL(JSON.parse(r.cuerpo).url).searchParams.get("state");
  const enviado = JSON.parse(llamadas[0].op.body);
  assert.equal(enviado.p_hash, hashEstado(estado));
  assert.ok(!llamadas[0].op.body.includes(estado), "el state en claro no llega a la base");
  assert.equal(llamadas[0].op.headers.authorization, "Bearer jwt-alumno", "se crea con la sesion del alumno, no con service_role");
});

test("agregar un competidor dispara solo el workflow de competencia", async () => {
  const destino = "api.github.com/repos/iannparraguesb/prime-dashboard/actions/workflows/competencia.yml/dispatches";
  const llamadas = simular({ [destino]: [204, null] });
  const ok = await dispararWorkflow({ token: "gh-token", repo: "iannparraguesb/prime-dashboard" }, "competencia.yml");
  assert.equal(ok, true);
  assert.equal(llamadas.length, 1);
  assert.ok(llamadas[0].url.includes(destino));
  assert.deepEqual(JSON.parse(llamadas[0].op.body), { ref: "main" });
});

test("sin token el competidor queda en cola para el cron, sin llamar a GitHub", async () => {
  const llamadas = simular({});
  assert.equal(await dispararWorkflow({ token: "", repo: "" }, "competencia.yml"), false);
  assert.equal(llamadas.length, 0);
});
