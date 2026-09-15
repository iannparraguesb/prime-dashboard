/**
 * NIVEL 1B — competencia, sin red.
 *
 * Prueba el modulo real que resume cuentas ajenas. Null significa no medido:
 * nunca participa como cero.
 */
import test, { before, describe } from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";

register("./_hook.mjs", import.meta.url);

let comp;
before(async () => {
  comp = await import("../src/lib/competencia.ts");
});

describe("N1 · competencia", () => {
  test("resumirCuenta calcula mediana, cadencia y mejor pieza sin contar null como cero", () => {
    const ahora = new Date("2026-09-14T12:00:00Z");
    const piezas = [
      { id: "a", fecha: "2026-09-13", interaccion_sobre_seguidores_pct: 0.4 },
      { id: "b", fecha: "2026-09-10", interaccion_sobre_seguidores_pct: null },
      { id: "c", fecha: "2026-09-07", interaccion_sobre_seguidores_pct: 0.2 },
    ];
    const r = comp.resumirCuenta(piezas, ahora, 30);
    assert.equal(r.mediana, 0.3);
    assert.equal(r.medidas, 2);
    assert.equal(r.publicadas, 3);
    assert.equal(r.porSemana, 0.7);
    assert.equal(r.mejor?.id, "a");
  });

  test("resumirCuenta excluye piezas fuera de la ventana y fechas invalidas", () => {
    const ahora = new Date("2026-09-14T12:00:00Z");
    const piezas = [
      { id: "actual", fecha: "2026-09-01", interaccion_sobre_seguidores_pct: 1 },
      { id: "vieja", fecha: "2026-01-01", interaccion_sobre_seguidores_pct: 9 },
      { id: "rota", fecha: "nunca", interaccion_sobre_seguidores_pct: 7 },
    ];
    const r = comp.resumirCuenta(piezas, ahora, 30);
    assert.equal(r.publicadas, 1);
    assert.equal(r.mediana, 1);
    assert.equal(r.mejor?.id, "actual");
  });

  test("brechaRelativa devuelve null sin referencia y porcentaje real con referencia", () => {
    assert.equal(comp.brechaRelativa(0.3, null), null);
    assert.equal(comp.brechaRelativa(null, 0.2), null);
    assert.equal(comp.brechaRelativa(0.3, 0), null);
    assert.equal(comp.brechaRelativa(0.3, 0.2), 50);
  });

  test("ordenarCuentas pone las no medidas al final", () => {
    const filas = [
      { username: "sin", resumen: { mediana: null } },
      { username: "baja", resumen: { mediana: 0.1 } },
      { username: "alta", resumen: { mediana: 0.9 } },
    ];
    assert.deepEqual(comp.ordenarCuentas(filas).map((x) => x.username), ["alta", "baja", "sin"]);
  });
});
