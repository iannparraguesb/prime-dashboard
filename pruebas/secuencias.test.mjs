/**
 * NIVEL 1C — secuencias de historias, sin red.
 *
 * Prueba el modulo real que arma la curva de abandono. Null significa no
 * medido: nunca participa como cero ni rompe la suma en silencio.
 */
import test, { before, describe } from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";

register("./_hook.mjs", import.meta.url);

let sec;
before(async () => {
  sec = await import("../src/lib/secuencias.ts");
});

const h = (id, hora, alcance, extra = {}) => ({
  id, hora, alcance, permalink: null, formato: "IMAGE", thumb: null,
  respuestas: 1, navegacion: null, visitas_perfil: 2, seguidores_ganados: null,
  interacciones: null, visita_perfil_pct: null, metricas_faltantes: [], ...extra,
});

const AHORA = new Date("2026-10-19T12:00:00Z");

describe("N1 · secuencias de historias", () => {
  test("separa tandas por el corte de minutos y ordena de la mas reciente a la mas antigua", () => {
    const filas = [
      h("c", "2026-10-15T20:00:00Z", 300),
      h("a", "2026-10-15T10:00:00Z", 1000),
      h("b", "2026-10-15T10:30:00Z", 800),
    ];
    const r = sec.armarSecuencias(filas, AHORA);
    assert.deepEqual(r.map((s) => s.slides.map((x) => x.historia.id)), [["c"], ["a", "b"]]);
  });

  test("retencion contra el primer slide y caida contra el anterior", () => {
    const filas = [
      h("a", "2026-10-15T10:00:00Z", 1000),
      h("b", "2026-10-15T10:05:00Z", 600),
      h("c", "2026-10-15T10:10:00Z", 450),
    ];
    const [s] = sec.armarSecuencias(filas, AHORA);
    assert.deepEqual(s.slides.map((x) => x.retencion), [100, 60, 45]);
    assert.deepEqual(s.slides.map((x) => x.caida), [null, 40, 25]);
    assert.equal(s.retencion_final, 45);
    assert.deepEqual(s.mayor_caida, { posicion: 2, pct: 40 });
  });

  test("un alcance null deja guion en ese slide y en sus vecinos, no un cero", () => {
    const filas = [
      h("a", "2026-10-15T10:00:00Z", 1000),
      h("b", "2026-10-15T10:05:00Z", null),
      h("c", "2026-10-15T10:10:00Z", 500),
    ];
    const [s] = sec.armarSecuencias(filas, AHORA);
    assert.deepEqual(s.slides.map((x) => x.retencion), [100, null, 50]);
    assert.deepEqual(s.slides.map((x) => x.caida), [null, null, null]);
    assert.equal(s.mayor_caida, null);
  });

  test("las sumas quedan en null si algun slide no fue medido", () => {
    const filas = [
      h("a", "2026-10-15T10:00:00Z", 1000, { respuestas: 3 }),
      h("b", "2026-10-15T10:05:00Z", 900, { respuestas: null, visitas_perfil: 4 }),
    ];
    const [s] = sec.armarSecuencias(filas, AHORA);
    assert.equal(s.respuestas, null);
    assert.equal(s.visitas_perfil, 6);
  });

  test("una secuencia con slides de menos de 24 h queda en curso", () => {
    const filas = [h("a", "2026-10-19T09:00:00Z", 100), h("b", "2026-10-15T09:00:00Z", 100)];
    const r = sec.armarSecuencias(filas, AHORA);
    assert.deepEqual(r.map((s) => s.en_curso), [true, false]);
  });

  test("las historias sin hora no entran en ninguna secuencia", () => {
    const r = sec.armarSecuencias([h("a", null, 100), h("b", "nunca", 100)], AHORA);
    assert.equal(r.length, 0);
  });

  test("el resumen solo mide secuencias cerradas de dos o mas slides", () => {
    const filas = [
      // cerrada: 100 -> 50 (caida 50) -> retencion 50
      h("a", "2026-10-14T10:00:00Z", 1000), h("b", "2026-10-14T10:05:00Z", 500),
      // cerrada: 100 -> 80 (caida 20) -> 60, retencion 60
      h("c", "2026-10-15T10:00:00Z", 1000), h("d", "2026-10-15T10:05:00Z", 800), h("e", "2026-10-15T10:10:00Z", 600),
      // un solo slide: no cuenta
      h("f", "2026-10-16T10:00:00Z", 999),
      // en curso: no cuenta
      h("g", "2026-10-19T10:00:00Z", 1000), h("i", "2026-10-19T10:05:00Z", 10),
    ];
    const r = sec.resumirSecuencias(sec.armarSecuencias(filas, AHORA));
    assert.equal(r.cerradas, 2);
    assert.equal(r.retencion_mediana, 55);
    assert.equal(r.caida_primera_mediana, 35);
  });

  test("sin secuencias medibles el resumen devuelve null, no cero", () => {
    const r = sec.resumirSecuencias([]);
    assert.deepEqual(r, { cerradas: 0, retencion_mediana: null, caida_primera_mediana: null });
  });
});
