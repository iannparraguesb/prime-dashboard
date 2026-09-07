/**
 * Utilidades compartidas por las tres capas de prueba.
 * Sin dependencias externas: todo sale de node: y de lo que ya hay en node_modules.
 */
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createServer } from "node:net";
import { spawn } from "node:child_process";

/* --------------------------------------------------------------- rutas ---- */

export const RAIZ_PROYECTO = fileURLToPath(new URL("../", import.meta.url));
export const RAIZ_REPO = fileURLToPath(new URL("../../../", import.meta.url));
export const ARCHIVO_ENV = fileURLToPath(new URL("../../../.env", import.meta.url));

/* ----------------------------------------------------------------- env ---- */

let env_cargado = false;

/** Carga `.env` de la raiz del repo una sola vez. Node 24 trae loadEnvFile. */
export function cargarEnv() {
  if (env_cargado) return;
  if (existsSync(ARCHIVO_ENV)) process.loadEnvFile(ARCHIVO_ENV);
  const local = fileURLToPath(new URL("../.env", import.meta.url));
  if (existsSync(local)) process.loadEnvFile(local);
  env_cargado = true;
}

export function credenciales() {
  cargarEnv();
  const url = process.env.SUPABASE_URL;
  const anon = process.env.SUPABASE_ANON_KEY;
  if (!url || !anon) {
    throw new Error(
      `Faltan SUPABASE_URL o SUPABASE_ANON_KEY en ${ARCHIVO_ENV}. ` +
        "Las pruebas de nivel 2 leen la base real; sin credenciales no hay nada que verificar."
    );
  }
  return { url: url.replace(/\/+$/, ""), anon };
}

/* ------------------------------------------------------------ supabase ---- */

/** GET contra la REST de Supabase con el JWT del usuario de pruebas.
 *
 *  Antes usaba la anon key. Desde que existe autenticacion con lista blanca, la
 *  anon key devuelve 0 filas en todo: el RLS exige `es_autorizado()`. Las
 *  pruebas necesitan identidad real, y usan una de rol `lectura` a proposito. */
export async function leerRest(ruta, { conteo = false, sinAuth = false } = {}) {
  const { url, anon } = credenciales();
  const jwt = sinAuth ? anon : await obtenerJwt();
  const cabeceras = { apikey: anon, Authorization: `Bearer ${jwt}` };
  if (conteo) {
    cabeceras.Prefer = "count=exact";
    cabeceras.Range = "0-0";
  }
  const r = await fetch(`${url}/rest/v1/${ruta}`, { headers: cabeceras });
  const texto = await r.text();
  let cuerpo = null;
  try {
    cuerpo = JSON.parse(texto);
  } catch {
    /* deja cuerpo en null y que la prueba mire `texto` */
  }
  return { estado: r.status, rango: r.headers.get("content-range"), cuerpo, texto };
}

/** Cuenta filas exactas usando content-range (`0-0/111` -> 111, `*​/0` -> 0). */
export async function contarFilas(ruta) {
  const { estado, rango, texto } = await leerRest(ruta, { conteo: true });
  if (estado !== 200 && estado !== 206) {
    throw new Error(`Supabase respondio ${estado} en ${ruta}: ${texto.slice(0, 300)}`);
  }
  const m = /\/(\d+)$/.exec(rango ?? "");
  if (!m) throw new Error(`Sin content-range utilizable en ${ruta}: ${rango}`);
  return Number(m[1]);
}

/* --------------------------------------------------------------- server --- */

export function puertoLibre() {
  return new Promise((res, rej) => {
    const s = createServer();
    s.on("error", rej);
    s.listen(0, "127.0.0.1", () => {
      const { port } = s.address();
      s.close(() => res(port));
    });
  });
}

/** Levanta `node server.mjs` en un puerto propio y espera a que conteste. */
export async function levantarApi({ timeout_ms = 20_000 } = {}) {
  const puerto = await puertoLibre();
  const salida = [];
  const proc = spawn(process.execPath, ["server.mjs"], {
    cwd: RAIZ_PROYECTO,
    env: { ...process.env, PUERTO_API: String(puerto), PORT: String(puerto) },
    stdio: ["ignore", "pipe", "pipe"],
  });
  proc.stdout.on("data", (b) => salida.push(String(b)));
  proc.stderr.on("data", (b) => salida.push(String(b)));

  let muerto = null;
  proc.on("exit", (code) => {
    muerto = `server.mjs murio con codigo ${code}`;
  });

  const base = `http://127.0.0.1:${puerto}`;
  const limite = Date.now() + timeout_ms;
  while (Date.now() < limite) {
    if (muerto) throw new Error(`${muerto}\n${salida.join("")}`);
    try {
      const r = await fetch(`${base}/api/health`, { signal: AbortSignal.timeout(2000) });
      if (r.status > 0) return { base, puerto, proc, salida };
    } catch {
      /* todavia no escucha */
    }
    await new Promise((r) => setTimeout(r, 150));
  }
  proc.kill("SIGKILL");
  throw new Error(`server.mjs no respondio en ${timeout_ms} ms\n${salida.join("")}`);
}

/** Baja el servidor pase lo que pase. Se llama desde `after()`. */
export async function bajarApi(api) {
  if (!api?.proc || api.proc.exitCode !== null) return;
  const fin = new Promise((res) => api.proc.once("exit", res));
  api.proc.kill("SIGTERM");
  const tarde = setTimeout(() => api.proc.kill("SIGKILL"), 3000);
  await fin;
  clearTimeout(tarde);
}

/* ------------------------------------------------------------- cercania --- */

/** assert.ok con mensaje util: |a-b| <= tol. */
export function cerca(a, b, tol) {
  return typeof a === "number" && Number.isFinite(a) && Math.abs(a - b) <= tol;
}


/** JWT de un usuario de pruebas con rol `lectura`.
 *
 *  Desde que existe autenticacion, la anon key NO lee nada: el RLS exige estar
 *  en la lista blanca (tabla `usuario`). Las pruebas necesitan una identidad
 *  real, y se usa una de solo lectura a proposito: si la suite pudiera escribir,
 *  un test mal escrito podria borrar datos de produccion. */
let _jwt = null;
export async function obtenerJwt() {
  if (_jwt) return _jwt;
  const { url, anon } = credenciales();
  const e = {
    SUPABASE_URL: url,
    SUPABASE_ANON_KEY: anon,
    TEST_EMAIL: process.env.TEST_EMAIL,
    TEST_PASSWORD: process.env.TEST_PASSWORD,
  };
  if (!e.TEST_EMAIL || !e.TEST_PASSWORD) {
    throw new Error(
      "Faltan TEST_EMAIL y TEST_PASSWORD en el .env de la raiz. " +
      "Son de un usuario con rol `lectura` creado para la suite."
    );
  }
  const r = await fetch(`${e.SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: e.SUPABASE_ANON_KEY, "content-type": "application/json" },
    body: JSON.stringify({ email: e.TEST_EMAIL, password: e.TEST_PASSWORD }),
  });
  if (!r.ok) throw new Error(`No se pudo autenticar el usuario de pruebas: ${r.status} ${await r.text()}`);
  _jwt = (await r.json()).access_token;
  return _jwt;
}
