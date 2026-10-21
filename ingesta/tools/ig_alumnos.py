#!/usr/bin/env python3
"""
Sincroniza el Instagram de cada alumno conectado (Instagram API with Instagram Login).

Uso:
    python3 tools/ig_alumnos.py                # todas las conexiones activas
    python3 tools/ig_alumnos.py --piezas 100   # cuantas publicaciones recientes medir

Por cada conexion:
  1. Renueva el token si vence en menos de 20 dias (Meta exige que tenga 24 h).
  2. Trae cuenta, publicaciones recientes con insights, historias activas y audiencia.
  3. Escribe en las mismas tablas que Leo, con cuenta_id = instagram_user_id del
     alumno. RLS (migracion 0013) hace que cada alumno vea solo sus filas.
  4. Registra el resultado en instagram_conexion (ultima_sincronizacion o error
     publico legible). Un alumno que falla no frena a los demas.

Reutiliza la capa HTTP de ig_dump (reintentos, metricas no soportadas como
faltantes, nunca 0) apuntandola a graph.instagram.com con el token de cada uno.
Los tokens salen de Vault via RPC con service_role y nunca se imprimen.
"""
import argparse
import datetime as dt
import json
import pathlib
import sys
import tempfile
import urllib.parse
import urllib.request

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
import ig_a_supabase as sb  # noqa: E402  (upsert, rest, guardar_miniatura, MAPA_METRICA, FORMATO)
import ig_dump as ig  # noqa: E402
import ig_historias  # noqa: E402  (filas_supabase)

VER = ig.ENV.get("IG_API_VERSION", "v23.0")
RENOVAR_SI_VENCE_EN = dt.timedelta(days=20)


def rpc(nombre, args=None):
    req = urllib.request.Request(
        f"{sb.SB}/rest/v1/rpc/{nombre}", data=json.dumps(args or {}).encode(), method="POST",
        headers={**sb.H, "Prefer": "return=representation"})
    with urllib.request.urlopen(req, timeout=60) as r:
        cuerpo = r.read()
        return json.loads(cuerpo) if cuerpo.strip() else None


def renovar(con):
    """Devuelve (token, expira_iso) nuevos o (None, None) si no toca."""
    ahora = dt.datetime.now(dt.timezone.utc)
    expira = dt.datetime.fromisoformat(con["token_expira_en"]) if con.get("token_expira_en") else ahora
    edad = ahora - dt.datetime.fromisoformat(con["token_actualizado_en"])
    if expira - ahora > RENOVAR_SI_VENCE_EN or edad < dt.timedelta(hours=24):
        return None, None
    q = urllib.parse.urlencode({"grant_type": "ig_refresh_token", "access_token": con["token"]})
    with urllib.request.urlopen(f"https://graph.instagram.com/refresh_access_token?{q}", timeout=60) as r:
        d = json.loads(r.read())
    return d["access_token"], (ahora + dt.timedelta(seconds=int(d.get("expires_in", 5_184_000)))).isoformat()


def filas_piezas(cid, piezas, fecha):
    ahora = dt.datetime.now(dt.timezone.utc).isoformat()
    pz, met = [], []
    for p in piezas:
        ts = p.get("timestamp")
        pz.append({
            "post_id": p["id"], "cuenta_id": cid, "permalink": p.get("permalink"),
            "publicado_en": ts, "fecha_publicacion": (ts or "")[:10] or None,
            "formato": sb.FORMATO.get(p.get("media_type"), "OTRO"), "formato_crudo": p.get("media_type"),
            "caption": p.get("caption"), "primera_linea": sb.primera_linea(p.get("caption")), "actualizado_en": ahora,
        })
        ins = p.get("insights") or {}
        m = {"post_id": p["id"], "fecha_snapshot": fecha, "fuente": "api",
             "metricas_faltantes": p.get("metricas_faltantes") or [], "tiempo_medio_visto_seg": None}
        for col in sb.MAPA_METRICA.values():
            m[col] = None
        for k, col in sb.MAPA_METRICA.items():
            if ins.get(k) is not None:
                m[col] = ins[k]
        if m["likes"] is None:
            m["likes"] = p.get("like_count")
        if m["comentarios"] is None:
            m["comentarios"] = p.get("comments_count")
        met.append(m)
    return pz, met


def sincronizar(con, limite, fecha):
    cid = con["instagram_user_id"]
    ig.BASE = f"https://graph.instagram.com/{VER}"
    ig.TOKEN = con["token"]
    nuevo_token, nueva_expira = renovar(con)
    if nuevo_token:
        ig.TOKEN = nuevo_token

    cuenta = ig.api(cid, fields="username,name,followers_count,media_count")
    with tempfile.TemporaryDirectory() as tmp:
        piezas = ig.traer_piezas(cid, limite, {}, pathlib.Path(tmp) / "ckpt.json")
    historias = (ig.traer_historias(cid) or {}).get("filas") or []
    audiencia = ig.traer_audiencia(cid)

    # cuenta: sin es_propia, para no tocar el false que fijo la conexion.
    sb.upsert("cuenta", [{"id": cid, "username": cuenta.get("username"), "nombre": cuenta.get("name")}], "id")
    sb.upsert("cuenta_metrica", [{"cuenta_id": cid, "fecha_snapshot": fecha, "fuente": "api",
                                  "seguidores": cuenta.get("followers_count"), "publicaciones": cuenta.get("media_count")}],
              "cuenta_id,fecha_snapshot,fuente")
    pz, met = filas_piezas(cid, piezas, fecha)
    sb.upsert("pieza", pz, "post_id")
    sb.upsert("pieza_metrica", met, "post_id,fecha_snapshot,fuente")

    identidad, mh = ig_historias.filas_supabase(cid, historias, fecha)
    sb.upsert("historia", identidad, "historia_id")
    sb.upsert("historia_metrica", mh, "historia_id,fecha_snapshot")

    aud = [{"cuenta_id": cid, "fecha_snapshot": fecha, "corte": corte, "clave": str(k)[:200], "valor": int(v)}
           for corte, valores in audiencia.items() if corte in ("city", "country", "age", "gender") and isinstance(valores, dict)
           for k, v in valores.items() if v is not None]
    if aud:
        sb.upsert("audiencia_snapshot", aud, "cuenta_id,fecha_snapshot,corte,clave")

    # Miniaturas: las URLs de Instagram caducan; se copian al bucket las que falten.
    por_id = {p["id"]: p for p in piezas}
    faltan = sb.rest(f"pieza?select=post_id&cuenta_id=eq.{urllib.parse.quote(cid)}&thumb_path=is.null&limit=60")
    guardadas = 0
    for f in faltan or []:
        media = por_id.get(f["post_id"])
        campos = sb.guardar_miniatura(f["post_id"], media) if media else {}
        if campos.get("thumb_path"):
            sb.rest(f"pieza?post_id=eq.{urllib.parse.quote(f['post_id'])}", campos, "PATCH", "return=minimal")
            guardadas += 1

    rpc("registrar_sincronizacion", {"p_conexion": con["conexion_id"], "p_ok": True,
                                     "p_token": nuevo_token, "p_expira": nueva_expira})
    print(f"  @{cuenta.get('username')}: {len(pz)} publicaciones · {len(identidad)} historias · "
          f"{len(aud)} filas de audiencia · {guardadas} miniaturas{' · token renovado' if nuevo_token else ''}")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--piezas", type=int, default=30)
    a = ap.parse_args()
    fecha = dt.date.today().isoformat()
    conexiones = rpc("conexiones_para_sincronizar") or []
    print(f"{len(conexiones)} alumnos conectados")
    fallos = 0
    for con in conexiones:
        try:
            # La primera vez trae mas historia para que el panel no arranque vacio.
            primera = sb.contar(f"pieza?cuenta_id=eq.{urllib.parse.quote(con['instagram_user_id'])}") == 0
            sincronizar(con, 100 if primera else a.piezas, fecha)
        except ig.ApiError as e:
            fallos += 1
            publico = ("Tu conexión venció. Vuelve a conectar Instagram." if e.token_muerto
                       else "No pudimos actualizar tus datos. Lo reintentamos en una hora.")
            print(f"  ! @{con.get('username')}: {publico} (code {e.code})", file=sys.stderr)
            try:
                rpc("registrar_sincronizacion", {"p_conexion": con["conexion_id"], "p_ok": False, "p_error": publico})
            except Exception:
                print(f"  ! @{con.get('username')}: no se pudo registrar el fallo en Supabase", file=sys.stderr)
        except Exception as e:  # noqa: BLE001  un alumno no frena a los demas
            fallos += 1
            print(f"  ! @{con.get('username')}: {type(e).__name__}: {e}", file=sys.stderr)
            try:
                rpc("registrar_sincronizacion", {"p_conexion": con["conexion_id"], "p_ok": False,
                                                 "p_error": "No pudimos actualizar tus datos. Lo reintentamos en una hora."})
            except Exception:
                print(f"  ! @{con.get('username')}: no se pudo registrar el fallo en Supabase", file=sys.stderr)
        finally:
            ig.TOKEN = None
    if fallos:
        sys.exit(f"{fallos} de {len(conexiones)} alumnos con error")


if __name__ == "__main__":
    main()
