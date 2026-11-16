#!/usr/bin/env python3
"""
Analiza los competidores que el equipo y los alumnos agregaron desde el panel.

Uso:
    python3 tools/ig_competencia.py            # solo los pendientes
    python3 tools/ig_competencia.py --todos    # reanaliza todos los activos

Lee `cuenta_vigilada` (lo que se escribe en Espia), consulta a Instagram con
business_discovery, y guarda las piezas en `pieza` / `pieza_metrica` con
fuente='api' bajo una cuenta `externa:<username>`.

Cada dueño tiene su lista (la del equipo, o la de un alumno: `workspace_id`),
pero los datos de una cuenta ajena se guardan UNA vez. Si Leo y tres alumnos
vigilan a la misma cuenta, se le pregunta a Instagram una sola vez y se marcan
las cuatro filas. Y una cuenta que ya se leyo hoy no se vuelve a pedir cuando
otro la agrega: queda lista al instante con los datos que ya estan. Todo sale
del mismo token (el de Leo), asi que cada llamada ahorrada cuenta.

--- El limite que hay que tener presente ---

De cuentas ajenas la Graph API entrega SOLO: username, followers_count,
media_count, y por publicacion caption, timestamp, permalink, media_type,
like_count y comments_count.

NO entrega alcance, guardados, compartidos ni retencion. De nadie. Ni con
permisos. Por eso una pieza de competencia nunca tiene `tasa_guardado` y jamas
entra a los rankings del contenido propio: se compara por interaccion sobre
seguidores, que es lo unico comparable de verdad.

Requisitos de la cuenta ajena: Business o Creator, y publica. Una cuenta
personal o privada devuelve error, y ese error se guarda en `ultimo_error` para
que el panel pueda decir POR QUE fallo en vez de mostrar un vacio mudo.
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


def env():
    e = {}
    for l in (ROOT / ".env").read_text().splitlines():
        if l.strip() and not l.startswith("#") and "=" in l:
            k, v = l.split("=", 1)
            e[k.strip()] = v.strip()
    return e


E = env()
TOKEN = E.get("IG_ACCESS_TOKEN") or E.get("META_ACCESS_TOKEN")
IG = E.get("IG_BUSINESS_ID")
VER = E.get("IG_API_VERSION", "v23.0")
SB = E["SUPABASE_URL"].rstrip("/")
KEY = E["SUPABASE_SERVICE_KEY"]
H = {"apikey": KEY, "Authorization": f"Bearer {KEY}", "Content-Type": "application/json"}
BUCKET = "miniaturas"
TIPOS_IMAGEN = {"image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp"}


def rest(recurso, cuerpo=None, metodo="GET", prefer=None):
    h = dict(H)
    if prefer:
        h["Prefer"] = prefer
    req = urllib.request.Request(
        f"{SB}/rest/v1/{recurso}",
        data=json.dumps(cuerpo).encode() if cuerpo is not None else None,
        headers=h, method=metodo)
    try:
        with urllib.request.urlopen(req, timeout=120) as r:
            b = r.read()
            return json.loads(b) if b.strip() else {}
    except urllib.error.HTTPError as e:
        raise SystemExit(f"Supabase {recurso} {e.code}: {e.read().decode()[:300]}")


def descubrir(username, n=50):
    """business_discovery. Devuelve (datos, error_legible)."""
    campos = (f"business_discovery.username({username})"
              "{username,name,followers_count,media_count,biography,profile_picture_url,"
              f"media.limit({n})"
              "{id,caption,media_type,media_product_type,permalink,timestamp,"
              "like_count,comments_count,thumbnail_url,media_url}}")
    url = (f"https://graph.facebook.com/{VER}/{IG}?"
           + urllib.parse.urlencode({"fields": campos, "access_token": TOKEN}))
    try:
        with urllib.request.urlopen(url, timeout=120) as r:
            return json.loads(r.read()).get("business_discovery"), None
    except urllib.error.HTTPError as e:
        cuerpo = e.read().decode("utf-8", "replace")
        try:
            msg = json.loads(cuerpo)["error"]["message"]
        except Exception:  # noqa: BLE001
            msg = cuerpo[:200]
        # Los errores frecuentes se traducen a algo accionable.
        if "does not exist" in msg or "cannot be found" in msg:
            legible = (f"@{username} no existe, o no es una cuenta Business/Creator publica. "
                       "business_discovery solo funciona con esas.")
        elif "Application does not have permission" in msg:
            legible = "El token no tiene permiso para business_discovery."
        else:
            legible = msg[:280]
        return None, legible


def guardar_miniatura(post_id, cuenta_id, media):
    """Copia la URL efimera de Instagram a Storage y devuelve campos persistentes.

    Es idempotente: cada post conserva una ruta estable y el upload usa upsert.
    Un fallo de imagen no invalida las metricas de la pieza.
    """
    origen = media.get("thumbnail_url") or media.get("media_url")
    if not origen:
        return {}
    try:
        req = urllib.request.Request(origen, headers={"User-Agent": "PrimeClub/1.0"})
        with urllib.request.urlopen(req, timeout=45) as r:
            cuerpo = r.read(5_242_881)
            tipo = (r.headers.get_content_type() or "").lower()
        if not cuerpo or len(cuerpo) > 5_242_880 or tipo not in TIPOS_IMAGEN:
            print(f"    ! miniatura {post_id}: tipo/tamano no permitido ({tipo}, {len(cuerpo)} bytes)")
            return {"thumb_origen": origen}
        usuario = cuenta_id.removeprefix("externa:")
        ruta = f"competencia/{usuario}/{post_id}{TIPOS_IMAGEN[tipo]}"
        subida = urllib.request.Request(
            f"{SB}/storage/v1/object/{BUCKET}/{urllib.parse.quote(ruta, safe='/')}",
            data=cuerpo,
            method="POST",
            headers={
                "apikey": KEY,
                "Authorization": f"Bearer {KEY}",
                "Content-Type": tipo,
                "x-upsert": "true",
                "Cache-Control": "31536000",
            },
        )
        with urllib.request.urlopen(subida, timeout=60):
            pass
        return {
            "thumb_path": ruta,
            "thumb_origen": origen,
            "thumb_bajada_en": datetime.datetime.now(datetime.timezone.utc).isoformat(),
        }
    except (urllib.error.URLError, TimeoutError, OSError) as exc:
        print(f"    ! miniatura {post_id}: {str(exc)[:120]}")
        return {"thumb_origen": origen}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--todos", action="store_true",
                    help="reanaliza todos los activos, no solo los pendientes")
    args = ap.parse_args()
    if not TOKEN or not IG:
        raise SystemExit("Falta IG_ACCESS_TOKEN o IG_BUSINESS_ID en .env")

    filtro = "&estado=eq.pendiente" if not args.todos else ""
    vigiladas = rest(f"cuenta_vigilada?select=*&activa=is.true{filtro}&order=agregada_en")
    if not vigiladas:
        print("Nada que analizar." if args.todos else
              "Sin competidores pendientes. Usa --todos para reanalizar los activos.")
        return 0

    # Una cuenta puede estar en varias listas: se analiza una vez por usuario.
    grupos = {}
    for v in vigiladas:
        grupos.setdefault(v["username"], []).append(v)

    hoy = datetime.date.today().isoformat()
    # Las que ya se leyeron hoy. `cuenta_metrica` se escribe al final de cada
    # analisis, asi que su fila de hoy significa "analisis completo".
    frescas = set()
    if not args.todos:
        en = ",".join(f'"externa:{u}"' for u in grupos)
        frescas = {f["cuenta_id"].removeprefix("externa:") for f in rest(
            "cuenta_metrica?select=cuenta_id&fuente=eq.api"
            f"&fecha_snapshot=eq.{hoy}&cuenta_id=in.({urllib.parse.quote(en)})")}

    def marcar(filas, cambios_por_fila):
        for v in filas:
            rest(f"cuenta_vigilada?id=eq.{v['id']}", cambios_por_fila(v), "PATCH", "return=minimal")

    def ahora():
        return datetime.datetime.now().isoformat(timespec="seconds")

    print(f"{len(grupos)} cuenta(s) por analizar, en {len(vigiladas)} lista(s)\n")
    ok = fallos = 0

    for u, filas in grupos.items():
        if u in frescas:
            nombre = (rest(f"cuenta?select=nombre&id=eq.{urllib.parse.quote(f'externa:{u}')}") or [{}])[0].get("nombre")
            marcar(filas, lambda v: {"estado": "listo", "ultimo_error": None,
                                     "nombre": v.get("nombre") or nombre, "analizada_en": ahora()})
            ok += 1
            print(f"  ✅ @{u}: ya se leyo hoy, se usan esos datos")
            continue

        marcar(filas, lambda v: {"estado": "analizando"})
        datos, err = descubrir(u)
        if err:
            fallos += 1
            marcar(filas, lambda v: {"estado": "error", "ultimo_error": err, "analizada_en": ahora()})
            print(f"  ✗ @{u}: {err[:110]}")
            continue

        cid = f"externa:{u}"
        rest("cuenta?on_conflict=id",
             [{"id": cid, "username": u, "nombre": datos.get("name"), "es_propia": False}],
             "POST", "resolution=merge-duplicates,return=minimal")

        medias = (datos.get("media") or {}).get("data", [])
        piezas, metricas = [], []
        for m in medias:
            ts = m.get("timestamp")
            pieza = {
                "post_id": m["id"], "cuenta_id": cid,
                "permalink": m.get("permalink"), "publicado_en": ts,
                "fecha_publicacion": (ts or "")[:10] or None,
                "formato": {"VIDEO": "REEL", "IMAGE": "IMAGEN",
                            "CAROUSEL_ALBUM": "CARRUSEL"}.get(m.get("media_type"), "OTRO"),
                "formato_crudo": m.get("media_type"),
                "caption": m.get("caption"),
                "primera_linea": next((l.strip() for l in (m.get("caption") or "").splitlines()
                                       if l.strip()), "")[:180] or None,
            }
            pieza.update(guardar_miniatura(m["id"], cid, m))
            piezas.append(pieza)
            # alcance, guardados y compartidos NO existen para cuentas ajenas.
            # Se dejan sin escribir: null, no cero.
            metricas.append({
                "post_id": m["id"], "fecha_snapshot": hoy, "fuente": "api",
                "likes": m.get("like_count"), "comentarios": m.get("comments_count"),
                "metricas_faltantes": ["reach", "saved", "shares", "views"],
            })
        if piezas:
            rest("pieza?on_conflict=post_id", piezas, "POST",
                 "resolution=merge-duplicates,return=minimal")
            rest("pieza_metrica?on_conflict=post_id,fecha_snapshot,fuente", metricas, "POST",
                 "resolution=merge-duplicates,return=minimal")
        # Al final a proposito: es la marca de "ya se leyo hoy" (ver `frescas`).
        rest("cuenta_metrica?on_conflict=cuenta_id,fecha_snapshot,fuente",
             [{"cuenta_id": cid, "fecha_snapshot": hoy, "fuente": "api",
               "seguidores": datos.get("followers_count"),
               "publicaciones": datos.get("media_count")}],
             "POST", "resolution=merge-duplicates,return=minimal")

        marcar(filas, lambda v: {"estado": "listo", "ultimo_error": None,
                                 "nombre": v.get("nombre") or datos.get("name"),
                                 "analizada_en": ahora()})
        ok += 1
        print(f"  ✅ @{u}: {datos.get('followers_count'):,} seguidores · "
              f"{len(piezas)} piezas guardadas")

    print(f"\n{ok} analizadas · {fallos} con error")
    if ok:
        print("  Recuerda: de estas cuentas NO hay alcance ni guardados. Solo likes y")
        print("  comentarios, por eso no entran a los rankings del contenido propio.")
    return 0 if fallos == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
