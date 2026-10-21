#!/usr/bin/env python3
"""
Carga un snapshot crudo de ig_dump.py en Supabase con fuente='api'.

Uso:
    python3 tools/ig_a_supabase.py                      # ultimo snapshot de data/instagram/
    python3 tools/ig_a_supabase.py --snapshot data/instagram/engagement-2026-09-22.json
    python3 tools/ig_a_supabase.py --miniaturas         # ademas baja miniaturas que falten
    python3 tools/ig_a_supabase.py --dry-run            # muestra conteos, no escribe nada

Que escribe (todo por upsert, asi correrlo dos veces no duplica nada):
    cuenta, cuenta_metrica       la cuenta propia y sus seguidores/publicaciones del dia
    pieza                        catalogo: permalink, formato, caption, primera linea
    pieza_metrica                metricas del dia por pieza (post_id, fecha_snapshot, fuente)
    pilar, pieza_pilar           clasificacion lexica de tools/ig_pilares.py
    audiencia_snapshot           cortes city/country/age/gender

Que NO escribe, a proposito:
    thumb_path, palabra_clave, pide_palabra_clave, duracion_seg  -> se conservan los
        valores ya cargados; este script no manda esas columnas.
    historias                    las captura tools/ig_historias.py (cron cada 4 h)
    competencia                  la carga tools/ig_competencia.py desde cuenta_vigilada

Doctrina de medicion que este archivo hace cumplir:
    Un dato que la API no devolvio es NULL, nunca 0. Cada metrica ausente en
    `insights` viaja como null explicito (PostgREST exige claves uniformes por
    lote, PGRST102) y queda listada en `metricas_faltantes`. likes y comentarios
    vienen del endpoint de media (like_count/comments_count), asi que existen
    aunque `insights` venga vacio.

Pilares: por defecto SOLO anade asignaciones. Un lexico mas estrecho que el que
produjo las filas existentes no puede borrarlas en silencio; el reemplazo total
exige --reclasificar y un lexico con menos del 50 % sin clasificar.

Miniaturas: las URLs de Instagram caducan a los ~5 dias. Con --miniaturas se copian
al bucket `miniaturas` como `<post_id>.<ext>` (convencion de la cuenta propia) solo
para piezas dentro de la ventana de analisis que aun no tengan thumb_path.
"""
import argparse
import datetime
import json
import pathlib
import sys
import urllib.error
import urllib.parse
import urllib.request

ROOT = pathlib.Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "tools"))
import ig_pilares  # noqa: E402  (clasificar, PILARES)


def env():
    e = {}
    for l in (ROOT / ".env").read_text().splitlines():
        if l.strip() and not l.startswith("#") and "=" in l:
            k, v = l.split("=", 1)
            e[k.strip()] = v.strip()
    return e


E = env()
SB = E["SUPABASE_URL"].rstrip("/")
KEY = E["SUPABASE_SERVICE_KEY"]
H = {"apikey": KEY, "Authorization": f"Bearer {KEY}", "Content-Type": "application/json"}
BUCKET = "miniaturas"
TIPOS_IMAGEN = {"image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp"}
LOTE = 200  # filas por peticion a PostgREST

FORMATO = {"VIDEO": "REEL", "IMAGE": "IMAGEN", "CAROUSEL_ALBUM": "CARRUSEL"}
# insight de Instagram -> columna de pieza_metrica
MAPA_METRICA = {
    "reach": "alcance", "views": "vistas", "impressions": "impresiones",
    "saved": "guardados", "shares": "compartidos", "comments": "comentarios",
    "likes": "likes", "total_interactions": "interacciones_totales",
    "profile_visits": "visitas_perfil", "follows": "seguidores_ganados",
}

DRY = False


def rest(recurso, cuerpo=None, metodo="GET", prefer=None, extra=None):
    h = dict(H)
    if prefer:
        h["Prefer"] = prefer
    if extra:
        h.update(extra)
    if DRY and metodo != "GET":
        return {}
    req = urllib.request.Request(
        f"{SB}/rest/v1/{recurso}",
        data=json.dumps(cuerpo).encode() if cuerpo is not None else None,
        headers=h, method=metodo)
    try:
        with urllib.request.urlopen(req, timeout=120) as r:
            b = r.read()
            return json.loads(b) if b.strip() else {}
    except urllib.error.HTTPError as e:
        raise RuntimeError(f"Supabase {recurso} {e.code}: {e.read().decode()[:400]}") from e


def contar(recurso):
    """Cuenta filas con Prefer: count=exact sin bajar el cuerpo."""
    req = urllib.request.Request(f"{SB}/rest/v1/{recurso}",
                                 headers={**H, "Prefer": "count=exact", "Range": "0-0"})
    with urllib.request.urlopen(req, timeout=60) as r:
        cr = r.headers.get("Content-Range", "")
    return int(cr.rsplit("/", 1)[-1]) if "/" in cr else 0


def upsert(tabla, filas, conflicto):
    for i in range(0, len(filas), LOTE):
        rest(f"{tabla}?on_conflict={conflicto}", filas[i:i + LOTE], "POST",
             "resolution=merge-duplicates,return=minimal")


def ultimo_snapshot():
    c = sorted((ROOT / "data/instagram").glob("engagement-*.json"))
    if not c:
        raise FileNotFoundError("No hay snapshots en data/instagram/. Corre tools/ig_dump.py primero.")
    return c[-1]


def primera_linea(caption):
    return next((l.strip() for l in (caption or "").splitlines() if l.strip()), "")[:180] or None


def guardar_miniatura(post_id, media):
    """Copia la miniatura efimera al bucket. Devuelve campos para PATCH o {}."""
    origen = media.get("thumbnail_url") or media.get("media_url")
    if not origen:
        return {}
    try:
        req = urllib.request.Request(origen, headers={"User-Agent": "PrimeClub/1.0"})
        with urllib.request.urlopen(req, timeout=45) as r:
            cuerpo = r.read(5_242_881)
            tipo = (r.headers.get_content_type() or "").lower()
        if not cuerpo or len(cuerpo) > 5_242_880 or tipo not in TIPOS_IMAGEN:
            return {"thumb_origen": origen}
        ruta = f"{post_id}{TIPOS_IMAGEN[tipo]}"  # convencion de la cuenta propia: raiz del bucket
        if not DRY:
            subida = urllib.request.Request(
                f"{SB}/storage/v1/object/{BUCKET}/{urllib.parse.quote(ruta, safe='/')}",
                data=cuerpo, method="POST",
                headers={"apikey": KEY, "Authorization": f"Bearer {KEY}", "Content-Type": tipo,
                         "x-upsert": "true", "Cache-Control": "31536000"})
            with urllib.request.urlopen(subida, timeout=60):
                pass
        return {"thumb_path": ruta, "thumb_origen": origen,
                "thumb_bajada_en": datetime.datetime.now(datetime.timezone.utc).isoformat()}
    except (urllib.error.URLError, TimeoutError, OSError) as exc:
        print(f"    ! miniatura {post_id}: {str(exc)[:100]}")
        return {"thumb_origen": origen}


def main():
    global DRY
    ap = argparse.ArgumentParser()
    ap.add_argument("--snapshot", default=None)
    ap.add_argument("--miniaturas", action="store_true",
                    help="baja al bucket las miniaturas que falten (piezas en ventana)")
    ap.add_argument("--miniaturas-max", type=int, default=400)
    ap.add_argument("--reclasificar", action="store_true",
                    help="borra y reemplaza pieza_pilar (solo si el lexico pasa el verificador)")
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()
    DRY = args.dry_run

    ruta = pathlib.Path(args.snapshot) if args.snapshot else ultimo_snapshot()
    d = json.loads(ruta.read_text(encoding="utf-8"))
    fecha = d["fecha"]
    cta = d["cuenta"]
    cid = cta["id"]
    piezas = d.get("piezas") or []
    print(f"Snapshot {ruta.name} · @{cta.get('username')} · {len(piezas)} piezas · fecha {fecha}"
          + ("  [DRY RUN: no se escribe nada]" if DRY else ""))

    # 1. cuenta + metrica del dia -------------------------------------------
    upsert("cuenta", [{"id": cid, "username": cta.get("username"),
                       "nombre": cta.get("name"), "es_propia": True}], "id")
    upsert("cuenta_metrica", [{"cuenta_id": cid, "fecha_snapshot": fecha, "fuente": "api",
                               "seguidores": cta.get("followers_count"),
                               "publicaciones": cta.get("media_count")}],
           "cuenta_id,fecha_snapshot,fuente")
    print(f"  cuenta: {cta.get('followers_count'):,} seguidores · {cta.get('media_count')} publicaciones")

    # 2. piezas + metricas ---------------------------------------------------
    filas_pieza, filas_metrica, asignaciones = [], [], []
    sin_insights = 0
    for p in piezas:
        ts = p.get("timestamp")
        filas_pieza.append({
            "post_id": p["id"], "cuenta_id": cid, "permalink": p.get("permalink"),
            "publicado_en": ts, "fecha_publicacion": (ts or "")[:10] or None,
            "formato": FORMATO.get(p.get("media_type"), "OTRO"),
            "formato_crudo": p.get("media_type"), "caption": p.get("caption"),
            "primera_linea": primera_linea(p.get("caption")),
            "actualizado_en": datetime.datetime.now(datetime.timezone.utc).isoformat(),
        })
        ins = p.get("insights") or {}
        if not ins:
            sin_insights += 1
        # PostgREST exige que todas las filas del lote tengan las MISMAS claves
        # (PGRST102). Por eso cada metrica ausente viaja como null explicito:
        # mismo significado (no medido), forma uniforme.
        m = {"post_id": p["id"], "fecha_snapshot": fecha, "fuente": "api",
             "metricas_faltantes": p.get("metricas_faltantes") or [],
             "tiempo_medio_visto_seg": None}
        for col in MAPA_METRICA.values():
            m[col] = None
        for k, col in MAPA_METRICA.items():
            if ins.get(k) is not None:
                m[col] = ins[k]
        # likes/comentarios existen aunque insights venga vacio: vienen del media.
        if m["likes"] is None:
            m["likes"] = p.get("like_count")
        if m["comentarios"] is None:
            m["comentarios"] = p.get("comments_count")
        if ins.get("ig_reels_avg_watch_time") is not None:
            m["tiempo_medio_visto_seg"] = ins["ig_reels_avg_watch_time"] / 1000
        filas_metrica.append(m)
        for pil in ig_pilares.clasificar(p.get("caption")):
            asignaciones.append({"post_id": p["id"], "pilar": pil})

    upsert("pieza", filas_pieza, "post_id")
    upsert("pieza_metrica", filas_metrica, "post_id,fecha_snapshot,fuente")
    print(f"  piezas: {len(filas_pieza)} · metricas: {len(filas_metrica)} "
          f"({sin_insights} sin insights -> alcance/guardados en NULL, no 0)")

    # 3. pilares -------------------------------------------------------------
    # Por defecto SOLO se anaden asignaciones: un lexico mas estrecho que el que
    # produjo las filas existentes no debe poder borrarlas en silencio. El
    # reemplazo completo exige --reclasificar y un lexico que pase su verificador.
    upsert("pilar", [{"nombre": n, "orden": i} for i, n in enumerate(ig_pilares.PILARES)], "nombre")
    clasificadas = len({a["post_id"] for a in asignaciones})
    sin = len(piezas) - clasificadas
    if args.reclasificar:
        if sin / max(len(piezas), 1) > 0.5:
            raise RuntimeError(f"--reclasificar rechazado: el lexico deja {sin / len(piezas):.0%} sin pilar. "
                             "Recalibra tools/ig_pilares.py (--verificar) antes de reemplazar.")
        ids = [p["id"] for p in piezas]
        for i in range(0, len(ids), LOTE):
            rest(f"pieza_pilar?post_id=in.({','.join(ids[i:i + LOTE])})", None, "DELETE",
                 "return=minimal")
    upsert("pieza_pilar", asignaciones, "post_id,pilar")
    print(f"  pilares: {len(asignaciones)} asignaciones {'(reemplazo)' if args.reclasificar else '(solo se anaden)'} · "
          f"{clasificadas} piezas clasificadas · {sin} sin pilar ({sin / max(len(piezas), 1):.0%})")

    # 4. audiencia -----------------------------------------------------------
    aud = []
    for corte, valores in (d.get("audiencia") or {}).items():
        if corte in ("city", "country", "age", "gender") and isinstance(valores, dict):
            aud += [{"cuenta_id": cid, "fecha_snapshot": fecha, "corte": corte,
                     "clave": str(k)[:200], "valor": int(v)} for k, v in valores.items()]
    if aud:
        upsert("audiencia_snapshot", aud, "cuenta_id,fecha_snapshot,corte,clave")
    print(f"  audiencia: {len(aud)} filas en {len(d.get('audiencia') or {})} cortes")

    hist = (d.get("historias") or {}).get("filas") or []
    print(f"  historias: {len(hist)} en el snapshot -> las persiste tools/ig_historias.py, aqui no se tocan")

    # 5. miniaturas (opcional) ------------------------------------------------
    if args.miniaturas:
        meses = int(float((rest("config?clave=eq.ventana_meses&select=valor") or [{"valor": 12}])[0]["valor"]))
        desde = (datetime.date.fromisoformat(fecha) - datetime.timedelta(days=int(meses * 30.44))).isoformat()
        faltan = rest(f"pieza?select=post_id&cuenta_id=eq.{cid}&thumb_path=is.null"
                      f"&fecha_publicacion=gte.{desde}&order=fecha_publicacion.desc"
                      f"&limit={args.miniaturas_max}")
        por_id = {p["id"]: p for p in piezas}
        print(f"  miniaturas: {len(faltan)} piezas en ventana (desde {desde}) sin miniatura")
        ok = 0
        for n, f in enumerate(faltan, 1):
            media = por_id.get(f["post_id"])
            if not media:
                continue
            campos = guardar_miniatura(f["post_id"], media)
            if campos.get("thumb_path"):
                rest(f"pieza?post_id=eq.{f['post_id']}", campos, "PATCH", "return=minimal")
                ok += 1
            if n % 25 == 0:
                print(f"    {n}/{len(faltan)} · {ok} guardadas")
        print(f"  miniaturas guardadas: {ok}/{len(faltan)}")

    # 6. verificacion de vuelta ---------------------------------------------
    if not DRY:
        n_m = contar(f"pieza_metrica?select=post_id&fecha_snapshot=eq.{fecha}&fuente=eq.api")
        n_c = contar(f"cuenta_metrica?select=cuenta_id&cuenta_id=eq.{cid}&fecha_snapshot=eq.{fecha}")
        n_p = contar(f"pieza?select=post_id&cuenta_id=eq.{cid}")
        print(f"\nVerificado en Supabase: {n_m} metricas del {fecha} · cuenta_metrica del dia: {n_c} · "
              f"{n_p} piezas propias en catalogo")
        if n_m < len(filas_metrica):
            print(f"  ! faltan {len(filas_metrica) - n_m} metricas: revisa el log")
            return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
