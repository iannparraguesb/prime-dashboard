#!/usr/bin/env python3
"""Captura historias activas y persiste sus métricas en Supabase.

El cron conserva su ruta histórica. Una respuesta vacía válida es éxito;
un error de autenticación, permisos o escritura nunca se convierte en éxito.
"""
import contextlib
import datetime
import io
import json
import sys
import urllib.request

import ig_dump as ig


def filas_supabase(cuenta, historias, fecha):
    identidad, metricas = [], []
    campos = {
        "reach": "alcance", "replies": "respuestas", "navigation": "navegacion",
        "profile_visits": "visitas_perfil", "follows": "seguidores_ganados",
        "total_interactions": "interacciones",
    }
    for h in historias:
        identidad.append({"historia_id": h["id"], "cuenta_id": cuenta,
                          "permalink": h.get("permalink"), "publicado_en": h.get("timestamp"),
                          "formato": h.get("media_type")})
        m = {"historia_id": h["id"], "fecha_snapshot": fecha}
        for origen, destino in campos.items():
            valor = h.get("insights", {}).get(origen)
            m[destino] = valor if isinstance(valor, (int, float)) and not isinstance(valor, bool) else None
        metricas.append(m)
    return identidad, metricas


def guardar(recurso, filas):
    if not filas:
        return
    clave = ig.ENV["SUPABASE_SERVICE_KEY"]
    req = urllib.request.Request(
        ig.ENV["SUPABASE_URL"].rstrip("/") + "/rest/v1/" + recurso,
        data=json.dumps(filas).encode(), method="POST",
        headers={"apikey": clave, "Authorization": "Bearer " + clave,
                 "Content-Type": "application/json", "Prefer": "resolution=merge-duplicates,return=minimal"})
    with urllib.request.urlopen(req, timeout=45):
        pass


def main():
    cuenta = ig.ENV.get("IG_BUSINESS_ID")
    if not cuenta or not ig.TOKEN or not ig.ENV.get("SUPABASE_SERVICE_KEY") or not ig.ENV.get("SUPABASE_URL"):
        raise RuntimeError("Configuración incompleta")
    # No registrar cuerpos crudos del proveedor, que pueden contener secretos.
    activas = ig.paginado(f"{cuenta}/stories", fields="id,media_type,permalink,timestamp")
    historias = []
    for historia in activas:
        met, faltantes = ig.insights(historia["id"], ig.METRICAS_HISTORIA)
        historias.append({**historia, "insights": met, "metricas_faltantes": faltantes})
    fecha = datetime.datetime.now(datetime.timezone.utc).date().isoformat()
    identidad, metricas = filas_supabase(cuenta, historias, fecha)
    guardar("historia", identidad)
    guardar("historia_metrica", metricas)
    print(json.dumps({"evento": "historias_capturadas", "fecha": fecha, "historias": len(historias)}))


if __name__ == "__main__":
    try:
        with contextlib.redirect_stderr(io.StringIO()):
            main()
    except Exception as error:
        print(json.dumps({"evento": "historias_error", "tipo": type(error).__name__}), file=sys.stderr)
        sys.exit(1)
