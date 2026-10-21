/**
 * NIVEL 1D — ritmo de metas mensuales, sin red.
 *
 * Prueba el modulo real. Sin dato no es cero: una fuente que no cubre el mes
 * deja la meta "sin dato", nunca "por detras del ritmo".
 */
import test, { before, describe } from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";

register("./_hook.mjs", import.meta.url);

let m;
before(async () => {
  m = await import("../src/lib/metas.ts");
});

describe("N1 · ritmo de metas", () => {
  test("a mitad de mes compara contra lo esperado a hoy, contando hoy", () => {
    // octubre tiene 31 dias; dia 15 -> esperado 15/31 de 31 = 15
    const r = m.ritmoMeta(16, 31, "2026-10-01", "2026-10-15");
    assert.equal(r.dias, 31);
    assert.equal(r.dia, 15);
    assert.equal(r.esperado, 15);
    assert.equal(r.estado, "adelante");
    assert.equal(r.faltan, 15);
    assert.equal(r.por_dia, 15 / 16);
    assert.equal(r.cerrado, false);
  });

  test("por detras del ritmo cuando lo logrado no alcanza lo esperado", () => {
    const r = m.ritmoMeta(3, 31, "2026-10-01", "2026-10-15");
    assert.equal(r.estado, "atras");
  });

  test("cumplida en cuanto se alcanza el objetivo, aunque el mes siga", () => {
    const r = m.ritmoMeta(12, 10, "2026-10-01", "2026-10-05");
    assert.equal(r.estado, "cumplida");
    assert.equal(r.faltan, 0);
    assert.equal(r.por_dia, null);
    assert.equal(r.logrado, 120);
  });

  test("un mes cerrado sin llegar queda como no cumplida", () => {
    const r = m.ritmoMeta(8, 10, "2026-09-01", "2026-10-19");
    assert.equal(r.cerrado, true);
    assert.equal(r.dia, 30);
    assert.equal(r.estado, "no_cumplida");
    assert.equal(r.por_dia, null);
  });

  test("sin dato no es cero: no se juzga el ritmo", () => {
    const r = m.ritmoMeta(null, 10, "2026-10-01", "2026-10-15");
    assert.equal(r.estado, "sin_dato");
    assert.equal(r.logrado, null);
    assert.equal(r.faltan, null);
  });

  test("el ultimo dia del mes lo que falta se pide completo", () => {
    const r = m.ritmoMeta(5, 10, "2026-10-01", "2026-10-31");
    assert.equal(r.cerrado, false);
    assert.equal(r.por_dia, 5);
  });

  test("febrero y años bisiestos usan su largo real", () => {
    assert.equal(m.ritmoMeta(1, 10, "2026-02-01", "2026-02-10").dias, 28);
    assert.equal(m.ritmoMeta(1, 10, "2028-02-01", "2028-02-10").dias, 29);
  });

  test("un mes futuro todavia no espera nada", () => {
    const r = m.ritmoMeta(0, 10, "2026-11-01", "2026-10-19");
    assert.equal(r.dia, 0);
    assert.equal(r.esperado, 0);
    assert.equal(r.estado, "adelante");
  });

  test("el catalogo de metricas coincide con el check de la migracion 0015", async () => {
    const { readFile } = await import("node:fs/promises");
    const sql = await readFile(new URL("../supabase/migrations/0015_metas_mensuales.sql", import.meta.url), "utf8");
    const enSql = [...sql.match(/metrica in \(([^)]+)\)/)[1].matchAll(/'([a-z_]+)'/g)].map((x) => x[1]).sort();
    assert.deepEqual(Object.keys(m.METRICAS_META).sort(), enSql);
  });
});
