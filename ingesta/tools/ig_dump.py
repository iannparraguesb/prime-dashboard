#!/usr/bin/env python3
"""
Extractor de Instagram Insights -> snapshot fechado en data/instagram/.

Uso:
    python3 tools/ig_dump.py                 # corrida completa
    python3 tools/ig_dump.py --reanudar      # retoma desde el checkpoint
    python3 tools/ig_dump.py --limite 50     # solo las 50 piezas mas recientes
    python3 tools/ig_dump.py --solo historias

Credenciales en .env:
    IG_ACCESS_TOKEN     token con instagram_basic, instagram_manage_insights,
                        pages_show_list, pages_read_engagement
                        (si falta, cae a META_ACCESS_TOKEN)
    IG_BUSINESS_ID      opcional. Si no esta, se descubre via /me/accounts
    IG_API_VERSION      opcional, default v23.0
    IG_COMPETENCIA      opcional, usernames separados por coma

--- Decisiones de diseno, para el que venga despues ---

1. graph.facebook.com, NO graph.instagram.com. El segundo es otro producto y no
   entrega estadisticas.

2. Degradacion POR METRICA, no por post. Cada tipo de contenido acepta metricas
   distintas: pedirle `saved` a una historia hace que Meta rechace la llamada
   ENTERA con 400. Cuando eso pasa, este script bisecta la lista de metricas y
   reintenta, quedandose con las que si responden. Mejor un post con 6 de 9 que
   un post perdido. Las que faltaron quedan registradas en `metricas_faltantes`.
   Esto tambien absorbe las deprecaciones de Meta sin tocar codigo.

3. Un dato que la API no devolvio NO es cero. Aca no se rellena con 0 nunca: si
   no vino, la clave no existe, y el analizador la propaga como null.

4. Snapshot fechado que no se pisa. Una publicacion sigue sumando alcance hoy;
   no existe "el" engagement de un post, existe el que tenia el dia que se midio.

5. En el crudo NO va ninguna tasa calculada. Solo lo que respondio la API. Asi se
   pueden recalcular criterios nuevos sobre snapshots viejos.

6. Todo, incluidas las paginas 2, 3 y 4 de una paginacion, pasa por la misma
   funcion con reintentos. Un limite de Meta a mitad de la paginacion no puede
   tirar la corrida entera.
"""
import argparse
import datetime
import json
import os
import pathlib
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT = ROOT / "data" / "instagram"

METRICAS_PIEZA = [
    "reach", "saved", "shares", "likes", "comments", "views", "total_interactions",
]
METRICAS_HISTORIA = [
    "reach", "replies", "navigation", "total_interactions", "follows", "profile_visits",
]
CAMPOS_MEDIA = (
    "id,caption,media_type,media_product_type,permalink,thumbnail_url,"
    "media_url,timestamp,like_count,comments_count"
)


# --------------------------------------------------------------------------
# entorno
# --------------------------------------------------------------------------
def load_env():
    env = dict(os.environ)
    ruta = ROOT / ".env"
    if ruta.exists():
        for line in ruta.read_text().splitlines():
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, v = line.split("=", 1)
                env.setdefault(k.strip(), v.strip())
    return env


ENV = load_env()
TOKEN = ENV.get("IG_ACCESS_TOKEN") or ENV.get("META_ACCESS_TOKEN")
VER = ENV.get("IG_API_VERSION", "v23.0")
BASE = f"https://graph.facebook.com/{VER}"


class ApiError(Exception):
    def __init__(self, code, subcode, mensaje, http):
        super().__init__(mensaje)
        self.code = code
        self.subcode = subcode
        self.mensaje = mensaje
        self.http = http

    @property
    def metrica_no_soportada(self):
        """400 + code 100 = pedimos una metrica que este objeto no acepta."""
        return self.http == 400 and self.code in (100, 3001)

    @property
    def token_muerto(self):
        return self.code == 190


# --------------------------------------------------------------------------
# capa HTTP: TODO pasa por aca, incluida la paginacion
# --------------------------------------------------------------------------
def _pedir(url, intentos=4):
    ultimo = None
    for intento in range(intentos):
        try:
            with urllib.request.urlopen(url, timeout=120) as r:
                return json.loads(r.read())
        except urllib.error.HTTPError as e:
            cuerpo = e.read().decode("utf-8", "replace")
            try:
                err = json.loads(cuerpo).get("error", {})
            except ValueError:
                err = {}
            fallo = ApiError(
                err.get("code"), err.get("error_subcode"),
                err.get("message", cuerpo[:300]), e.code,
            )
            if fallo.token_muerto:
                raise fallo
            # 429/500/503 y el rate limit de Meta (code 4/17/32/613) se reintentan
            if (e.code in (429, 500, 502, 503) or fallo.code in (4, 17, 32, 613)) and intento < intentos - 1:
                time.sleep(2 ** intento * 5)
                ultimo = fallo
                continue
            raise fallo
        except Exception as e:  # noqa: BLE001  red caida, timeout, DNS
            ultimo = e
            if intento < intentos - 1:
                time.sleep(2 ** intento * 3)
                continue
            raise
    raise ultimo


def api(path, **params):
    params["access_token"] = TOKEN
    return _pedir(f"{BASE}/{path}?{urllib.parse.urlencode(params)}")


def paginado(path, maximo=None, **params):
    """Recorre `data` siguiendo paging.next. Cada pagina usa la misma capa HTTP."""
    params["access_token"] = TOKEN
    params.setdefault("limit", 100)
    url = f"{BASE}/{path}?{urllib.parse.urlencode(params)}"
    filas = []
    while url:
        payload = _pedir(url)
        filas.extend(payload.get("data", []))
        if maximo and len(filas) >= maximo:
            return filas[:maximo]
        url = payload.get("paging", {}).get("next")
    return filas


# --------------------------------------------------------------------------
# insights con degradacion por metrica
# --------------------------------------------------------------------------
def _valor(fila):
    if "total_value" in fila:
        return fila["total_value"].get("value")
    vals = fila.get("values") or []
    return vals[0].get("value") if vals else None


def insights(objeto_id, metricas, **extra):
    """Devuelve (dict_metricas, lista_faltantes). Bisecta cuando Meta rechaza."""
    metricas = list(metricas)
    if not metricas:
        return {}, []
    try:
        payload = api(f"{objeto_id}/insights", metric=",".join(metricas), **extra)
    except ApiError as e:
        if not e.metrica_no_soportada:
            raise
        if len(metricas) == 1:
            return {}, metricas
        corte = len(metricas) // 2
        izq, f_izq = insights(objeto_id, metricas[:corte], **extra)
        der, f_der = insights(objeto_id, metricas[corte:], **extra)
        izq.update(der)
        return izq, f_izq + f_der

    salida = {}
    for fila in payload.get("data", []):
        v = _valor(fila)
        if v is not None:
            salida[fila["name"]] = v
    faltan = [m for m in metricas if m not in salida]
    return salida, faltan


# --------------------------------------------------------------------------
# descubrimiento de la cuenta
# --------------------------------------------------------------------------
def _ig_id_desde_scopes():
    """Un token generado desde el Graph API Explorer pidiendo solo los permisos
    de Instagram no trae pages_show_list, asi que /me/accounts viene vacio. Pero
    debug_token expone `granular_scopes`, y ahi Meta lista el ID de la cuenta de
    Instagram a la que quedo amarrado cada permiso. Con eso alcanza: no hace
    falta pasar por la Pagina de Facebook."""
    try:
        d = api("debug_token", input_token=TOKEN).get("data", {})
    except ApiError:
        return None
    for s in d.get("granular_scopes", []):
        if s.get("scope") in ("instagram_basic", "instagram_manage_insights"):
            objetivos = s.get("target_ids") or []
            if objetivos:
                return objetivos[0]
    return None


def descubrir_ig_id():
    if ENV.get("IG_BUSINESS_ID"):
        return ENV["IG_BUSINESS_ID"]
    porScope = _ig_id_desde_scopes()
    if porScope:
        return porScope
    paginas = paginado("me/accounts", fields="id,name,instagram_business_account{id,username}")
    candidatos = [p for p in paginas if p.get("instagram_business_account")]
    if not candidatos:
        raise SystemExit(
            "No se pudo determinar la cuenta de Instagram.\n"
            "Se intentaron dos caminos: granular_scopes del token y /me/accounts.\n"
            "Revisa que el token tenga instagram_basic, o define IG_BUSINESS_ID en .env."
        )
    if len(candidatos) > 1:
        print("  ! Varias cuentas vinculadas; uso la primera. Fija IG_BUSINESS_ID para elegir:",
              file=sys.stderr)
        for c in candidatos:
            ig = c["instagram_business_account"]
            print(f"      {ig['id']}  @{ig.get('username')}  (via {c.get('name')})", file=sys.stderr)
    return candidatos[0]["instagram_business_account"]["id"]


# --------------------------------------------------------------------------
# bloques de extraccion
# --------------------------------------------------------------------------
def traer_cuenta(ig):
    return api(ig, fields=(
        "id,username,name,biography,followers_count,follows_count,"
        "media_count,profile_picture_url,website"
    ))


def traer_piezas(ig, limite, checkpoint, ruta_ckpt):
    medias = paginado(f"{ig}/media", fields=CAMPOS_MEDIA, maximo=limite)
    print(f"  {len(medias)} piezas en el catalogo")
    salida = []
    nuevas = 0
    for i, m in enumerate(medias, 1):
        mid = m["id"]
        if mid in checkpoint:
            salida.append(checkpoint[mid])
            continue
        try:
            met, faltan = insights(mid, METRICAS_PIEZA)
        except ApiError as e:
            if e.token_muerto:
                raise
            print(f"  ! {mid}: {e.mensaje[:120]}", file=sys.stderr)
            met, faltan = {}, list(METRICAS_PIEZA)
        registro = dict(m)
        registro["insights"] = met
        registro["metricas_faltantes"] = faltan
        checkpoint[mid] = registro
        salida.append(registro)
        nuevas += 1
        if nuevas % 10 == 0:
            _guardar_checkpoint(ruta_ckpt, checkpoint)
            print(f"    {i}/{len(medias)}")
    _guardar_checkpoint(ruta_ckpt, checkpoint)
    return salida


def traer_historias(ig):
    """La API NO tiene archivo de historias: solo devuelve las activas (24h).
    Sin una corrida diaria, esta seccion solo puede mostrar las de hoy."""
    try:
        activas = paginado(f"{ig}/stories",
                           fields="id,media_type,permalink,thumbnail_url,media_url,timestamp")
    except ApiError as e:
        print(f"  ! historias: {e.mensaje[:120]}", file=sys.stderr)
        return {"error": e.mensaje, "filas": []}
    filas = []
    for h in activas:
        try:
            met, faltan = insights(h["id"], METRICAS_HISTORIA)
        except ApiError as e:
            met, faltan = {}, list(METRICAS_HISTORIA)
            print(f"  ! historia {h['id']}: {e.mensaje[:100]}", file=sys.stderr)
        fila = dict(h)
        fila["insights"] = met
        fila["metricas_faltantes"] = faltan
        filas.append(fila)
    return {"filas": filas}


def traer_audiencia(ig, **extra):
    """follower_demographics necesita 100+ seguidores y metric_type=total_value.
    `extra` va tal cual a la consulta: con Instagram Login (graph.instagram.com)
    hay que pasar timeframe, o responde vacio y sin error."""
    salida = {}
    for corte in ("city", "country", "age", "gender"):
        try:
            payload = api(f"{ig}/insights", metric="follower_demographics",
                          period="lifetime", metric_type="total_value", breakdown=corte, **extra)
            filas = payload.get("data", [])
            res = {}
            for f in filas:
                tv = f.get("total_value", {})
                for b in tv.get("breakdowns", []):
                    for r in b.get("results", []):
                        clave = "|".join(r.get("dimension_values", []))
                        res[clave] = r.get("value")
            salida[corte] = res
        except ApiError as e:
            salida[corte] = {}
            salida.setdefault("errores", {})[corte] = e.mensaje[:200]
    return salida


def traer_competencia(ig, usernames):
    """business_discovery solo entrega likes y comentarios de cuentas ajenas.
    Alcance y guardados no los da de nadie, ni siquiera con permisos."""
    salida = {}
    for u in usernames:
        u = u.strip().lstrip("@")
        if not u:
            continue
        campos = (
            f"business_discovery.username({u})"
            "{followers_count,media_count,username,"
            "media.limit(30){id,caption,media_type,permalink,timestamp,"
            "like_count,comments_count,thumbnail_url}}"
        )
        try:
            payload = api(ig, fields=campos)
            salida[u] = payload.get("business_discovery", {})
        except ApiError as e:
            salida[u] = {"error": e.mensaje[:300]}
            print(f"  ! competencia @{u}: {e.mensaje[:120]}", file=sys.stderr)
    return salida


# --------------------------------------------------------------------------
# checkpoint
# --------------------------------------------------------------------------
def _guardar_checkpoint(ruta, ckpt):
    ruta.parent.mkdir(parents=True, exist_ok=True)
    ruta.write_text(json.dumps(ckpt, ensure_ascii=False))


def _leer_checkpoint(ruta):
    if ruta.exists():
        try:
            return json.loads(ruta.read_text())
        except ValueError:
            return {}
    return {}


# --------------------------------------------------------------------------
def main():
    ap = argparse.ArgumentParser(description="Extractor de Instagram Insights")
    ap.add_argument("--reanudar", action="store_true",
                    help="retoma desde el checkpoint del dia en vez de empezar de cero")
    ap.add_argument("--limite", type=int, default=None,
                    help="solo las N piezas mas recientes")
    ap.add_argument("--fecha", default=None, help="fecha del snapshot (AAAA-MM-DD)")
    ap.add_argument("--solo", choices=["piezas", "historias", "audiencia", "competencia"],
                    default=None)
    args = ap.parse_args()

    if not TOKEN:
        raise SystemExit("Falta IG_ACCESS_TOKEN (o META_ACCESS_TOKEN) en .env")

    fecha = args.fecha or datetime.date.today().isoformat()
    destino = OUT / f"engagement-{fecha}.json"
    ruta_ckpt = OUT / f".checkpoint-{fecha}.json"

    if destino.exists() and not args.reanudar:
        raise SystemExit(
            f"Ya existe {destino.relative_to(ROOT)}.\n"
            "Los snapshots no se pisan: una pieza sigue sumando alcance y el historico\n"
            "es lo que permite comparar contra la corrida anterior.\n"
            "Usa --reanudar para completarlo, o --fecha para otro dia."
        )

    print(f"API {VER}")
    try:
        ig = descubrir_ig_id()
        cuenta = traer_cuenta(ig)
    except ApiError as e:
        if e.token_muerto:
            raise SystemExit(
                f"Token invalido: {e.mensaje}\n"
                "Genera uno nuevo en developers.facebook.com/tools/explorer con los permisos\n"
                "instagram_basic, instagram_manage_insights, pages_show_list, pages_read_engagement\n"
                "y guardalo como IG_ACCESS_TOKEN en .env."
            )
        raise SystemExit(f"Error de la API: {e.mensaje}")

    print(f"Cuenta: @{cuenta.get('username')}  {cuenta.get('followers_count')} seguidores  "
          f"{cuenta.get('media_count')} publicaciones")

    ckpt = _leer_checkpoint(ruta_ckpt) if args.reanudar else {}
    if ckpt:
        print(f"  checkpoint: {len(ckpt)} piezas ya medidas, se saltan")

    previo = {}
    if args.solo and destino.exists():
        previo = json.loads(destino.read_text())

    snapshot = previo or {}
    snapshot["fecha"] = fecha
    snapshot["api_version"] = VER
    snapshot["cuenta"] = cuenta

    hacer = [args.solo] if args.solo else ["piezas", "historias", "audiencia", "competencia"]

    if "piezas" in hacer:
        print("[1] piezas")
        snapshot["piezas"] = traer_piezas(ig, args.limite, ckpt, ruta_ckpt)
    if "historias" in hacer:
        print("[2] historias activas")
        snapshot["historias"] = traer_historias(ig)
    if "audiencia" in hacer:
        print("[3] audiencia")
        snapshot["audiencia"] = traer_audiencia(ig)
    if "competencia" in hacer:
        print("[4] competencia")
        usuarios = (ENV.get("IG_COMPETENCIA") or "academiaentrenadoresonline").split(",")
        snapshot["competencia"] = traer_competencia(ig, usuarios)

    OUT.mkdir(parents=True, exist_ok=True)
    destino.write_text(json.dumps(snapshot, indent=2, ensure_ascii=False))
    print(f"\n-> {destino.relative_to(ROOT)}")

    faltantes = sum(1 for p in snapshot.get("piezas", []) if p.get("metricas_faltantes"))
    if faltantes:
        print(f"   {faltantes} piezas con metricas incompletas (normal: cada tipo acepta "
              f"metricas distintas). Se guardan como faltantes, NO como cero.")
    if ruta_ckpt.exists():
        ruta_ckpt.unlink()

    print("\nSiguiente:")
    print(f"  python3 tools/ig_pilares.py --verificar {destino.relative_to(ROOT)}")
    print("  python3 tools/ig_analizar.py")


if __name__ == "__main__":
    main()
