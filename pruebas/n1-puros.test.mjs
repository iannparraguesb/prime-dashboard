/**
 * NIVEL 1 — unidad, sin red.
 *
 * CAMINO ELEGIDO: se prueba el .tsx REAL, no una copia.
 * `_hook.mjs` registra un loader de node:module que transpila .ts/.tsx con el
 * esbuild que ya trae node_modules (dependencia de vite, no se instalo nada).
 * Se descarto replicar las funciones en `puros.mjs` porque una copia se
 * desincroniza en silencio: la prueba seguiria verde con el codigo real roto.
 */
import test, { before, describe } from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";

register("./_hook.mjs", import.meta.url);

let ui;
let fb;

before(async () => {
  ui = await import("../src/components/ui.tsx");
  fb = await import("../src/components/FilterBar.tsx");
});

/* ========================================================================== */
/* La regla central: ausente NO es cero.                                      */
/* ========================================================================== */

describe("N1 · ausente no es cero", () => {
  test("num/pct/compacto/mult devuelven guion con null, no '0'", () => {
    for (const nombre of ["num", "pct", "compacto", "mult"]) {
      const f = ui[nombre];
      assert.equal(f(null), ui.NADA, `${nombre}(null) deberia ser el guion`);
      assert.notEqual(f(null), "0", `${nombre}(null) NUNCA puede ser "0"`);
      assert.equal(f(null).includes("0"), false, `${nombre}(null) no debe contener ningun 0`);
    }
  });

  test("undefined y NaN se tratan igual que null", () => {
    for (const nombre of ["num", "pct", "compacto", "mult"]) {
      assert.equal(ui[nombre](undefined), ui.NADA, `${nombre}(undefined)`);
      assert.equal(ui[nombre](NaN), ui.NADA, `${nombre}(NaN)`);
    }
  });

  test("pct(0) devuelve '0,0%' — un cero real SI se muestra", () => {
    assert.equal(ui.pct(0), "0,0%");
  });

  test("un cero medido se imprime como cero en todos los formateadores", () => {
    assert.equal(ui.num(0), "0");
    assert.equal(ui.compacto(0), "0");
    assert.equal(ui.mult(0), "x0,0");
  });

  test("f(0) y f(null) NUNCA producen la misma cadena", () => {
    for (const nombre of ["num", "pct", "compacto", "mult"]) {
      assert.notEqual(
        ui[nombre](0),
        ui[nombre](null),
        `${nombre}: no medido y cero medido se ven iguales — se pierde la distincion`
      );
    }
  });

  test("el guion es el caracter em-dash, no un cero disfrazado", () => {
    assert.equal(ui.NADA, "—");
  });
});

/* ========================================================================== */
/* Formato de numeros (es-CL: punto de miles, coma decimal)                   */
/* ========================================================================== */

describe("N1 · formateadores", () => {
  test("num agrupa miles a la chilena", () => {
    assert.equal(ui.num(1234), "1.234");
    assert.equal(ui.num(1234567), "1.234.567");
    assert.equal(ui.num(7), "7");
  });

  test("compacto usa K y M sobre los umbrales, y solo sobre ellos", () => {
    assert.equal(ui.compacto(999), "999");
    assert.equal(ui.compacto(1000), "1K");
    assert.equal(ui.compacto(1500), "1,5K");
    assert.equal(ui.compacto(999_999), "1.000K");
    assert.equal(ui.compacto(1_000_000), "1M");
    assert.equal(ui.compacto(2_400_000), "2,4M");
  });

  test("compacto respeta el signo en negativos", () => {
    assert.equal(ui.compacto(-1500), "-1,5K");
    assert.equal(ui.compacto(-2_000_000), "-2M");
  });

  test("pct fija los decimales pedidos", () => {
    assert.equal(ui.pct(0.2403, 2), "0,24%");
    assert.equal(ui.pct(0.2403), "0,2%");
    assert.equal(ui.pct(1), "1,0%");
    assert.equal(ui.pct(12.5, 0), "13%");
  });

  test("mult siempre lleva prefijo x y un decimal", () => {
    assert.equal(ui.mult(1), "x1,0");
    assert.equal(ui.mult(3.25), "x3,3");
  });

  test("fechaCorta y horaCorta devuelven guion sin dato", () => {
    for (const vacio of [null, undefined, ""]) {
      assert.equal(ui.fechaCorta(vacio), ui.NADA);
      assert.equal(ui.horaCorta(vacio), ui.NADA);
    }
  });

  test("fechaCorta con basura degrada a los primeros 10 caracteres, no revienta", () => {
    assert.equal(ui.fechaCorta("no-es-fecha-igual"), "no-es-fech");
    assert.equal(ui.horaCorta("no-es-fecha"), ui.NADA);
  });

  test("fechaCorta con ISO real produce algo legible", () => {
    const s = ui.fechaCorta("2026-08-29T12:00:00Z");
    assert.match(s, /\d{2}/);
    assert.notEqual(s, ui.NADA);
  });
});

/* ========================================================================== */
/* filtrar(): orden y filtros                                                 */
/* ========================================================================== */

let n = 0;
function pieza(over = {}) {
  n += 1;
  return {
    id: `p${n}`,
    permalink: null,
    fecha: "2026-08-01T00:00:00Z",
    tipo: "REELS",
    formato: "VIDEO",
    thumb: null,
    primera_linea: `pieza ${n}`,
    pilares: [],
    alcance: 1000,
    vistas: 1000,
    guardados: 10,
    compartidos: 5,
    likes: 50,
    comentarios: 3,
    interacciones: 68,
    seguidores: 1,
    guardado_pct: 1,
    compartido_pct: 0.5,
    like_pct: 5,
    comentario_pct: 0.3,
    metricas_faltantes: [],
    multiplicador: 1,
    ...over,
  };
}

const F = (over) => ({ ...({ tipo: "todas", formato: "todos", pilar: "todos", periodo: "todo", orden: "guardado_pct" }), ...over });

describe("N1 · filtrar: los null van al final", () => {
  test("orden por guardado_pct: null al final, nunca primero", () => {
    const piezas = [
      pieza({ id: "nula", guardado_pct: null }),
      pieza({ id: "baja", guardado_pct: 0.1 }),
      pieza({ id: "alta", guardado_pct: 9 }),
    ];
    const r = fb.filtrar(piezas, F({ orden: "guardado_pct" }));
    assert.deepEqual(r.map((p) => p.id), ["alta", "baja", "nula"]);
  });

  test("un cero medido gana el puesto a un null: cero compite, null no", () => {
    const piezas = [pieza({ id: "nula", guardado_pct: null }), pieza({ id: "cero", guardado_pct: 0 })];
    const r = fb.filtrar(piezas, F({ orden: "guardado_pct" }));
    assert.deepEqual(r.map((p) => p.id), ["cero", "nula"]);
  });

  test("los null quedan al final en TODOS los criterios de orden", () => {
    const criterios = {
      guardado_pct: "guardado_pct",
      compartido_pct: "compartido_pct",
      multiplicador: "multiplicador",
      alcance: "alcance",
      comentarios: "comentarios",
    };
    for (const [orden, campo] of Object.entries(criterios)) {
      const piezas = [
        pieza({ id: "n1", [campo]: null }),
        pieza({ id: "v", [campo]: 5 }),
        pieza({ id: "n2", [campo]: null }),
        pieza({ id: "v2", [campo]: 50 }),
      ];
      const r = fb.filtrar(piezas, F({ orden }));
      assert.deepEqual(r.slice(0, 2).map((p) => p.id), ["v2", "v"], `orden=${orden}: los medidos van arriba`);
      assert.deepEqual(r.slice(2).map((p) => p.id).sort(), ["n1", "n2"], `orden=${orden}: los null van al final`);
    }
  });

  test("con TODO null el orden no revienta ni pierde piezas", () => {
    const piezas = [pieza({ guardado_pct: null }), pieza({ guardado_pct: null }), pieza({ guardado_pct: null })];
    const r = fb.filtrar(piezas, F({ orden: "guardado_pct" }));
    assert.equal(r.length, 3);
  });

  test("orden por fecha: la mas reciente primero, fecha invalida al final", () => {
    const piezas = [
      pieza({ id: "vieja", fecha: "2024-01-01T00:00:00Z" }),
      pieza({ id: "rota", fecha: "no-es-fecha" }),
      pieza({ id: "nueva", fecha: "2026-08-20T00:00:00Z" }),
    ];
    const r = fb.filtrar(piezas, F({ orden: "fecha" }));
    assert.deepEqual(r.map((p) => p.id), ["nueva", "vieja", "rota"]);
  });

  test("filtrar no muta el arreglo de entrada", () => {
    const piezas = [pieza({ id: "a", guardado_pct: 1 }), pieza({ id: "b", guardado_pct: 9 })];
    const copia = piezas.map((p) => p.id);
    fb.filtrar(piezas, F({ orden: "guardado_pct" }));
    assert.deepEqual(piezas.map((p) => p.id), copia);
  });
});

describe("N1 · filtrar: filtros", () => {
  test("tipo separa REELS de FEED y 'todas' no filtra", () => {
    const piezas = [pieza({ id: "r", tipo: "REELS" }), pieza({ id: "f", tipo: "FEED" })];
    assert.deepEqual(fb.filtrar(piezas, F({ tipo: "REELS" })).map((p) => p.id), ["r"]);
    assert.deepEqual(fb.filtrar(piezas, F({ tipo: "FEED" })).map((p) => p.id), ["f"]);
    assert.equal(fb.filtrar(piezas, F({ tipo: "todas" })).length, 2);
  });

  test("formato filtra por el valor crudo de la API", () => {
    const piezas = [pieza({ id: "v", formato: "VIDEO" }), pieza({ id: "c", formato: "CAROUSEL_ALBUM" })];
    assert.deepEqual(fb.filtrar(piezas, F({ formato: "CAROUSEL_ALBUM" })).map((p) => p.id), ["c"]);
  });

  test("pilar filtra por pertenencia y __sin__ trae las sin clasificar", () => {
    const piezas = [
      pieza({ id: "sis", pilares: ["sistema"] }),
      pieza({ id: "mix", pilares: ["sistema", "mentalidad"] }),
      pieza({ id: "nada", pilares: [] }),
    ];
    assert.deepEqual(fb.filtrar(piezas, F({ pilar: "sistema" })).map((p) => p.id).sort(), ["mix", "sis"]);
    assert.deepEqual(fb.filtrar(piezas, F({ pilar: "__sin__" })).map((p) => p.id), ["nada"]);
    assert.equal(fb.filtrar(piezas, F({ pilar: "todos" })).length, 3);
  });

  test("periodo recorta por ventana de dias y descarta fechas invalidas", () => {
    const hoy = new Date();
    const hace = (d) => new Date(hoy.getTime() - d * 86_400_000).toISOString();
    const piezas = [
      pieza({ id: "reciente", fecha: hace(5) }),
      pieza({ id: "media", fecha: hace(60) }),
      pieza({ id: "antigua", fecha: hace(400) }),
      pieza({ id: "rota", fecha: "nunca" }),
    ];
    assert.deepEqual(fb.filtrar(piezas, F({ periodo: "30" })).map((p) => p.id), ["reciente"]);
    assert.deepEqual(fb.filtrar(piezas, F({ periodo: "90" })).map((p) => p.id).sort(), ["media", "reciente"]);
    assert.equal(fb.filtrar(piezas, F({ periodo: "365" })).length, 2);
    assert.equal(fb.filtrar(piezas, F({ periodo: "todo" })).length, 4);
  });

  test("FILTROS_INICIALES no esconde nada y ordena por tasa de guardado", () => {
    assert.deepEqual(fb.FILTROS_INICIALES, {
      tipo: "todas",
      formato: "todos",
      pilar: "todos",
      periodo: "todo",
      orden: "guardado_pct",
    });
  });

  test("filtros combinados se aplican en conjunto (AND)", () => {
    const piezas = [
      pieza({ id: "ok", tipo: "REELS", formato: "VIDEO", pilares: ["sistema"] }),
      pieza({ id: "otroTipo", tipo: "FEED", formato: "VIDEO", pilares: ["sistema"] }),
      pieza({ id: "otroPilar", tipo: "REELS", formato: "VIDEO", pilares: ["oferta"] }),
    ];
    const r = fb.filtrar(piezas, F({ tipo: "REELS", formato: "VIDEO", pilar: "sistema" }));
    assert.deepEqual(r.map((p) => p.id), ["ok"]);
  });
});
