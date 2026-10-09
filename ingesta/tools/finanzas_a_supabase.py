#!/usr/bin/env python3
"""
Carga el tablero de negocio a Supabase: lo que lee la pestaña "Negocio" de prime-dashboard.

Uso:
    python3 tools/finanzas_a_supabase.py                    # desde 2026-09-01 hasta ayer
    python3 tools/finanzas_a_supabase.py --desde 2026-10-01

Antes de correrlo:
    1. Exportar la pestaña "Llamadas" del sheet del setter a data/finanzas/llamadas-setter.csv
       (Archivo → Descargar → CSV). El script no tiene acceso a Google.
    2. La migración supabase/migrations/0011_negocio.sql de prime-dashboard tiene que estar aplicada.

Extrae con las mismas funciones que tools/finanzas_excel.py: el Excel y el panel leen idénticos números.
Escribe con SUPABASE_SERVICE_KEY (la única que puede escribir esas tablas). No guarda email ni teléfono.

Si GHL falla, NO sube nada de GHL y deja su cobertura como estaba: el panel mostrará
"sin dato" para lo nuevo en vez de ceros.
"""
import argparse
import datetime as dt
import hashlib
import json
import sys
import urllib.error
import urllib.request

import finanzas_excel as fx

URL = fx.ENV["SUPABASE_URL"].rstrip("/") + "/rest/v1"
KEY = fx.ENV["SUPABASE_SERVICE_KEY"]


def rest(metodo, recurso, cuerpo=None, prefer=None):
    req = urllib.request.Request(
        f"{URL}/{recurso}",
        data=json.dumps(cuerpo, default=str).encode() if cuerpo is not None else None,
        method=metodo,
        headers={"apikey": KEY, "Authorization": f"Bearer {KEY}", "Content-Type": "application/json",
                 **({"Prefer": prefer} if prefer else {})},
    )
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            return r.status
    except urllib.error.HTTPError as e:
        cuerpo_err = e.read().decode()[:400]
        if "PGRST205" in cuerpo_err or "42P01" in cuerpo_err:
            sys.exit(f"Falta la tabla {recurso.split('?')[0]}: aplica prime-dashboard/supabase/migrations/0011_negocio.sql")
        raise RuntimeError(f"{metodo} {recurso}: HTTP {e.code} {cuerpo_err}") from None


def upsert(tabla, filas):
    for i in range(0, len(filas), 500):
        rest("POST", tabla, filas[i:i + 500], "resolution=merge-duplicates,return=minimal")
    print(f"  {tabla}: {len(filas)} filas")


def reemplazar(tabla, filtro, filas):
    """Borra el tramo que se vuelve a cargar y lo inserta completo: así una fila borrada en la fuente desaparece."""
    rest("DELETE", f"{tabla}?{filtro}", prefer="return=minimal")
    if filas:
        upsert(tabla, filas)
    else:
        print(f"  {tabla}: 0 filas")


def cobertura(fuente, desde, hasta, nota):
    upsert("negocio_carga", [{"fuente": fuente, "cubre_desde": str(desde), "cubre_hasta": str(hasta),
                              "cargado_en": dt.datetime.now(dt.timezone.utc).isoformat(), "nota": nota}])


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--desde", default="2026-09-01")
    ap.add_argument("--hasta", default=str(dt.date.today() - dt.timedelta(days=1)))
    a = ap.parse_args()

    print("Meta Ads…")
    meta = fx.meta_diario(a.desde, a.hasta)
    upsert("negocio_gasto_diario", [{
        "fecha": x["date_start"], "campana_id": x["campaign_id"], "campana": x["campaign_name"],
        "tipo": fx.tipo_campana(x["campaign_name"]), "moneda": "CLP", "gasto": float(x["spend"]),
        "impresiones": int(x.get("impressions", 0)), "clics": int(x.get("clicks", 0)),
        "conversaciones": int(fx.accion(x, "onsite_conversion.messaging_conversation_started_7d")),
        "conv_reales": int(fx.accion(x, "onsite_conversion.messaging_user_depth_5_message_send")),
        "registros": int(fx.accion(x, "complete_registration")),
    } for x in meta])
    cobertura("meta", a.desde, a.hasta, "Meta Marketing API, cuenta act_1059963115650620 (CLP, America/Santiago)")

    meses = sorted({x["date_start"][:7] for x in meta} | {a.desde[:7], a.hasta[:7]})
    tc = fx.dolar_mensual(meses)
    upsert("negocio_dolar", [{"mes": f"{m}-01", "clp_por_usd": v, "dias": n,
                              "fuente": f"Promedio dólar observado, mindicador.cl (Banco Central), consultado {dt.date.today()}"}
                             for m, (v, n) in tc.items() if v])
    cobertura("dolar", f"{meses[0]}-01", a.hasta, "mindicador.cl/api/dolar")

    print("GoHighLevel…")
    try:
        etapas = fx.ghl_etapas()
        crudo = fx.ghl_oportunidades(a.desde)
        contactos = fx.ghl_contactos(a.desde, a.hasta)
    except (RuntimeError, KeyError) as e:
        print(f"  ! GHL no respondió ({e}). No se carga nada de GHL; el panel conserva la cobertura anterior.", file=sys.stderr)
    else:
        agendas = []
        for o in crudo:
            f = fx.fila_oportunidad(o, etapas)
            agendas.append({"id": o["id"], "creado": f["creado"], "cambio_etapa": f["cambio_etapa"], "nombre": f["nombre"],
                            "fuente_ghl": f["fuente_ghl"], "origen": f["origen"], "utm_source": f["utm_source"],
                            "utm_medium": f["utm_medium"], "utm_campaign": f["utm_campaign"], "utm_content": f["utm_content"],
                            "pipeline": f["pipeline"], "etapa": f["etapa"], "estado": f["estado"], "valor": f["valor"]})
        reemplazar("negocio_agenda", f"creado=gte.{a.desde}", agendas)
        leads = []
        for c in contactos:
            at = c.get("attributionSource") or {}
            leads.append({"id": c["id"], "creado": c["dateAdded"][:10], "fuente": c.get("source"),
                          "origen": fx.origen(at.get("utmSource"), at.get("utmMedium"))})
        reemplazar("negocio_lead", f"creado=gte.{a.desde}&creado=lte.{a.hasta}", leads)
        cobertura("ghl", a.desde, dt.date.today(), f"GHL API v2, consultada {dt.date.today()}")

    print("Setter…")
    if not fx.SETTER_CSV.exists():
        # En la nube no hay acceso a Google: el registro del setter se carga a mano
        # y se conserva lo ultimo que se subio.
        print(f"  sin {fx.SETTER_CSV.name}: se conserva el registro ya cargado")
        print("Listo.")
        return
    setter = fx.leer_setter()
    filas = [{
        "id": hashlib.sha1(f"{s['fecha']}|{' '.join(s['prospecto'].lower().split())}".encode()).hexdigest()[:16],
        "fecha": s["fecha"], "prospecto": s["prospecto"], "fuente": s["fuente"] or None,
        "detalle": s["detalle"] or None, "asistio": s["asistio"] or None, "nota": s["nota"],
        "resultado": s["resultado"] or None, "plan": s["plan"] or None, "monto_usd": s["monto"],
        "objecion": s["objecion"] or None, "seguimiento": s["seguimiento"] or None,
    } for s in setter]
    # El CSV es el sheet completo: se reemplaza entero.
    reemplazar("negocio_llamada", "id=not.is.null", filas)
    if setter:
        cobertura("setter", min(s["fecha"] for s in setter), dt.date.today(),
                  f"Sheet del setter ({fx.SHEET_SETTER}), CSV exportado. Antes del inicio = sin dato.")
    print("Listo.")


if __name__ == "__main__":
    main()
