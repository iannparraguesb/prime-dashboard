#!/usr/bin/env python3
"""
Carga los anuncios de Meta y sus metricas acumuladas a Supabase (pestaña Anuncios).

Uso:
    python3 tools/meta_a_supabase.py

Escribe:
    anuncio          identidad del anuncio: nombre, campaña, conjunto, estado, permalink
    anuncio_metrica  metricas de por vida del anuncio, una fila por dia de captura
                     (ad_id, fecha_snapshot). Correrlo dos veces el mismo dia actualiza, no duplica.

No toca `es_dark_post`: se calculo cruzando creativos con el feed organico y el upsert
conserva las columnas que no se envian.

Credenciales en .env: META_ACCESS_TOKEN, META_AD_ACCOUNT_ID, META_API_VERSION,
SUPABASE_URL, SUPABASE_SERVICE_KEY.
"""
import datetime as dt
import json
import pathlib
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

ROOT = pathlib.Path(__file__).resolve().parent.parent


def load_env():
    env = {}
    ruta = ROOT / ".env"
    if ruta.exists():
        for line in ruta.read_text().splitlines():
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, v = line.split("=", 1)
                env[k.strip()] = v.strip()
    return env


E = load_env()
TOKEN = E["META_ACCESS_TOKEN"]
ACCT = E["META_AD_ACCOUNT_ID"] if E["META_AD_ACCOUNT_ID"].startswith("act_") else "act_" + E["META_AD_ACCOUNT_ID"]
VER = E.get("META_API_VERSION", "v21.0")
SB = E["SUPABASE_URL"].rstrip("/") + "/rest/v1"
KEY = E["SUPABASE_SERVICE_KEY"]


def graph(path, **params):
    params.update(access_token=TOKEN, limit=params.get("limit", 200))
    url = f"https://graph.facebook.com/{VER}/{path}?{urllib.parse.urlencode(params)}"
    filas = []
    while url:
        for intento in range(4):
            try:
                with urllib.request.urlopen(url, timeout=120) as r:
                    d = json.loads(r.read())
                break
            except urllib.error.HTTPError as e:
                if e.code in (429, 500, 503) and intento < 3:
                    time.sleep(2 ** intento * 5)
                    continue
                # Sin cuerpo crudo: puede traer el token en la URL del error.
                sys.exit(f"Meta respondio HTTP {e.code} en {path.split('?')[0]}")
        filas += d.get("data", [])
        url = d.get("paging", {}).get("next")
    return filas


def upsert(tabla, filas, conflicto):
    for i in range(0, len(filas), 500):
        req = urllib.request.Request(
            f"{SB}/{tabla}?on_conflict={conflicto}", data=json.dumps(filas[i:i + 500]).encode(), method="POST",
            headers={"apikey": KEY, "Authorization": f"Bearer {KEY}", "Content-Type": "application/json",
                     "Prefer": "resolution=merge-duplicates,return=minimal"})
        try:
            with urllib.request.urlopen(req, timeout=60):
                pass
        except urllib.error.HTTPError as e:
            sys.exit(f"Supabase respondio HTTP {e.code} en {tabla}: {e.read().decode()[:300]}")
    print(f"  {tabla}: {len(filas)} filas")


def accion(fila, campo, tipo):
    for a in fila.get(campo) or []:
        if a.get("action_type") == tipo:
            return int(float(a["value"]))
    return None


def num(v, tipo=float):
    return None if v in (None, "") else tipo(float(v))


def main():
    hoy = dt.date.today().isoformat()
    ahora = dt.datetime.now(dt.timezone.utc).isoformat()

    anuncios = graph(f"{ACCT}/ads", fields="id,name,effective_status,created_time,campaign{id,name},adset{id,name},"
                                           "creative{id,instagram_permalink_url}")
    upsert("anuncio", [{
        "ad_id": a["id"], "cuenta_ads_id": ACCT, "nombre": a.get("name"),
        "campana_id": (a.get("campaign") or {}).get("id"), "campana": (a.get("campaign") or {}).get("name"),
        "conjunto_id": (a.get("adset") or {}).get("id"), "conjunto": (a.get("adset") or {}).get("name"),
        "estado": a.get("effective_status"), "creativo_id": (a.get("creative") or {}).get("id"),
        "permalink_ig": (a.get("creative") or {}).get("instagram_permalink_url"),
        "creado_en": a.get("created_time"), "visto_en": ahora,
    } for a in anuncios], "ad_id")

    insights = graph(f"{ACCT}/insights", level="ad", date_preset="maximum",
                     fields="ad_id,account_currency,spend,impressions,reach,clicks,inline_link_clicks,ctr,cpm,frequency,"
                            "actions,video_p25_watched_actions,video_p50_watched_actions,video_p75_watched_actions,"
                            "video_p100_watched_actions")
    ids = {a["id"] for a in anuncios}
    upsert("anuncio_metrica", [{
        "ad_id": x["ad_id"], "fecha_snapshot": hoy, "moneda": x.get("account_currency"),
        "gasto": num(x.get("spend")), "impresiones": num(x.get("impressions"), int), "alcance": num(x.get("reach"), int),
        "clicks": num(x.get("clicks"), int), "clicks_enlace": num(x.get("inline_link_clicks"), int),
        "ctr": num(x.get("ctr")), "cpm": num(x.get("cpm")), "frecuencia": num(x.get("frequency")),
        "conversaciones": accion(x, "actions", "onsite_conversion.messaging_conversation_started_7d"),
        "primera_respuesta": accion(x, "actions", "onsite_conversion.messaging_first_reply"),
        "video_p25": accion(x, "video_p25_watched_actions", "video_view"),
        "video_p50": accion(x, "video_p50_watched_actions", "video_view"),
        "video_p75": accion(x, "video_p75_watched_actions", "video_view"),
        "video_p100": accion(x, "video_p100_watched_actions", "video_view"),
        "cargado_en": ahora,
    } for x in insights if x["ad_id"] in ids], "ad_id,fecha_snapshot")


if __name__ == "__main__":
    main()
