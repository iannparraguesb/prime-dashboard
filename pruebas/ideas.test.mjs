import { test } from "node:test";
import assert from "node:assert/strict";
import { sugerencias, tema } from "../backend/ideas.mjs";

const hoy = new Date().toISOString().slice(0, 10);
const piezas = [
  { id: "a1", formato: "REEL", fecha: "2026-09-14", multiplicador: 2.4, permalink: "https://www.instagram.com/p/a1/", thumb: null, primera_linea: "Comenta IDEAS y te envío un playbook para que nunca te quedes sin contenido." },
  { id: "a2", formato: "CARRUSEL", fecha: "2026-09-18", multiplicador: 1.1, primera_linea: "Bajo el umbral" },
];
const cuentas = {
  rival: { username: "rival", interaccion_mediana_pct: 1, piezas: [
    { id: "c1", formato: "CARRUSEL", fecha: hoy, permalink: "https://www.instagram.com/p/c1/", thumb: null, primera_linea: "5 errores al vender asesorías #coach", interaccion_sobre_seguidores_pct: 3 },
    { id: "c2", formato: "REEL", fecha: hoy, primera_linea: "Normal", interaccion_sobre_seguidores_pct: 1 },
  ] },
};

test("tema limpia el llamado a comentar, hashtags y emojis", () => {
  assert.equal(tema("Comenta IDEAS y te envío un playbook 🔥 #fit"), "Un playbook");
  assert.equal(tema("5 errores al vender asesorías #coach"), "5 errores al vender asesorías");
});

test("solo usa piezas propias sobre 1,2x y competencia sobre 1,5x su promedio", () => {
  const { filas } = sugerencias({ piezas, cuentas, usadas: new Set(), porPagina: 500 });
  assert.ok(filas.some((x) => x.clave === "propia:carrusel:a1"));
  assert.ok(filas.some((x) => x.clave === "propia:parte2:a1"));
  assert.ok(!filas.some((x) => x.clave.includes(":a2")));
  assert.ok(filas.some((x) => x.clave === "competencia:carrusel:c1" && x.referencia_cuenta === "rival"));
  assert.ok(!filas.some((x) => x.clave.includes(":c2")));
});

test("claves unicas, descartadas excluidas, filtro por formato y paginacion", () => {
  const todas = sugerencias({ piezas, cuentas, usadas: new Set(), porPagina: 500 }).filas;
  assert.equal(new Set(todas.map((x) => x.clave)).size, todas.length);
  const sin = sugerencias({ piezas, cuentas, usadas: new Set(["propia:carrusel:a1"]), porPagina: 500 }).filas;
  assert.ok(!sin.some((x) => x.clave === "propia:carrusel:a1"));
  const historias = sugerencias({ piezas, cuentas, usadas: new Set(), formato: "historia", porPagina: 500 }).filas;
  assert.ok(historias.length > 0 && historias.every((x) => x.formato === "historia"));
  const p0 = sugerencias({ piezas, cuentas, usadas: new Set(), desde: 0 });
  const p1 = sugerencias({ piezas, cuentas, usadas: new Set(), desde: 12 });
  assert.equal(p0.filas.length, 12);
  assert.ok(!p1.filas.some((x) => p0.filas.some((y) => y.clave === x.clave)));
  // Una tanda mezcla fuentes: no 12 ideas del mismo tipo seguidas.
  assert.ok(new Set(p0.filas.map((x) => x.origen)).size >= 3);
});
