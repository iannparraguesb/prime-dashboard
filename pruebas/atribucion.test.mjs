import { test } from "node:test";
import assert from "node:assert/strict";
import { atribuirVentas, claveInstagram } from "../backend/atribucion.mjs";

const piezas = [
  { id: "p1", permalink: "https://www.instagram.com/reel/DAbc_12-x/", fecha: "2026-10-01", formato: "REEL", titulo: "Ponte a pensar", thumb: null },
  { id: "p2", permalink: "https://www.instagram.com/p/Cxyz987/", fecha: "2026-09-20", formato: "CARRUSEL", titulo: "7 cosas", thumb: null },
];
const historias = [{ id: "h1", permalink: "https://www.instagram.com/stories/leo_opazo/3456789012345678901/", fecha: "2026-10-03T21:00:00Z" }];
const venta = (detalle, monto = 997, extra = {}) => ({
  fecha: "2026-10-05", prospecto: "X", fuente: "Contenido (reel o post)", detalle, resultado: "Cerró", monto_usd: monto, ...extra,
});

test("claveInstagram reconoce reel, post, tv, la variante con usuario e historias", () => {
  assert.equal(claveInstagram("https://www.instagram.com/reel/DAbc_12-x/?igsh=abc"), "publicacion:DAbc_12-x");
  assert.equal(claveInstagram("instagram.com/reels/DAbc_12-x"), "publicacion:DAbc_12-x");
  assert.equal(claveInstagram("https://instagram.com/leo_opazo/reel/DAbc_12-x/"), "publicacion:DAbc_12-x");
  assert.equal(claveInstagram("mira https://www.instagram.com/p/Cxyz987/ ese"), "publicacion:Cxyz987");
  assert.equal(claveInstagram("https://www.instagram.com/tv/Q1/"), "publicacion:Q1");
  assert.equal(claveInstagram("https://www.instagram.com/stories/leo_opazo/3456789012345678901?utm_source=ig_story_item_share"), "historia:3456789012345678901");
});

test("claveInstagram no inventa una clave sin link", () => {
  for (const t of ["", null, undefined, "el reel de los 12 horas", "https://www.instagram.com/leo_opazo/", "https://primeclub.info/vsl"]) {
    assert.equal(claveInstagram(t), null, String(t));
  }
});

test("el shortcode distingue mayusculas", () => {
  const r = atribuirVentas([venta("https://www.instagram.com/reel/dabc_12-x/")], piezas, historias);
  assert.equal(r.cobertura.con_pieza, 0);
  assert.equal(r.cobertura.link_sin_pieza, 1);
});

test("cruza ventas con publicaciones e historias y suma por pieza", () => {
  const r = atribuirVentas([
    venta("https://www.instagram.com/reel/DAbc_12-x/", 997),
    venta("https://www.instagram.com/reel/DAbc_12-x/?igsh=1", 1497),
    venta("https://www.instagram.com/stories/leo_opazo/3456789012345678901", 997),
  ], piezas, historias);
  assert.equal(r.cobertura.con_pieza, 3);
  assert.deepEqual(r.por_pieza.map((x) => [x.pieza.id, x.ventas, x.ingresos_usd]), [["p1", 2, 2494], ["h1", 1, 997]]);
  assert.equal(r.por_pieza[1].pieza.tipo, "historia");
});

test("clasifica lo que no se pudo atribuir sin adivinar", () => {
  const r = atribuirVentas([
    venta("https://www.instagram.com/reel/NOEXISTE/"),
    venta("el reel de las 12 horas"),
    venta(""),
    venta(null),
  ], piezas, historias);
  assert.deepEqual(r.cobertura, { ventas: 4, con_pieza: 0, link_sin_pieza: 1, sin_link: 1, sin_detalle: 2 });
  assert.equal(r.por_pieza.length, 0);
});

test("solo cuenta ventas cerradas", () => {
  const r = atribuirVentas([
    venta("https://www.instagram.com/p/Cxyz987/", 997, { resultado: "No cerró" }),
    venta("https://www.instagram.com/p/Cxyz987/", 997, { resultado: null }),
  ], piezas, historias);
  assert.equal(r.cobertura.ventas, 0);
  assert.equal(r.ventas.length, 0);
});

test("un monto ausente no suma como cero: se cuenta aparte", () => {
  const r = atribuirVentas([
    venta("https://www.instagram.com/p/Cxyz987/", null),
    venta("https://www.instagram.com/p/Cxyz987/", 997),
  ], piezas, historias);
  assert.deepEqual([r.por_pieza[0].ingresos_usd, r.por_pieza[0].sin_monto, r.por_pieza[0].ventas], [997, 1, 2]);
});

test("agrupa ingresos por fuente del setter y deja 'Sin anotar' visible", () => {
  const r = atribuirVentas([
    venta("", 997, { fuente: "Anuncio" }),
    venta("", 1497, { fuente: null }),
    venta("", 997, { fuente: "Anuncio" }),
  ], piezas, historias);
  assert.deepEqual(r.por_fuente.map((f) => [f.fuente, f.ventas, f.ingresos_usd]), [["Anuncio", 2, 1994], ["Sin anotar", 1, 1497]]);
});
