#!/usr/bin/env python3
"""
Tablero financiero y de leads de Prime Club en Excel: Meta Ads + GoHighLevel + registro del setter.

Uso:
    python3 tools/finanzas_excel.py                     # desde 2026-09-01 hasta hoy
    python3 tools/finanzas_excel.py --desde 2026-09-01 --hasta 2026-10-31

Entradas:
    .env                               META_ACCESS_TOKEN, META_AD_ACCOUNT_ID, GHL_TOKEN, GHL_LOCATION_ID
    data/finanzas/llamadas-setter.csv  pestaña "Llamadas" del sheet de Rodolfo, exportada como CSV
    .tmp/audit-0925/ghl_opps.json      respaldo de GHL si el token falla (snapshot del 25-sep)

Salida:
    data/finanzas/finanzas-AAAA-MM-DD.xlsx  y  data/finanzas/fuentes-AAAA-MM-DD.json (crudo)

Reglas:
    - El gasto viene en CLP; se pasa a USD con el dólar observado mensual (mindicador.cl / Banco Central).
    - Un dato que no existe NO es cero: las semanas fuera de la cobertura de cada fuente muestran "s/d".
    - Todo indicador del Excel es fórmula sobre las pestañas de datos, para que recalcule si se corrige una fila.
"""
import argparse
import csv
import datetime as dt
import json
import pathlib
import statistics
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

from openpyxl import Workbook
from openpyxl.comments import Comment
from openpyxl.styles import Alignment, Font, PatternFill
from openpyxl.utils import get_column_letter

ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT = ROOT / "data" / "finanzas"
SETTER_CSV = OUT / "llamadas-setter.csv"
GHL_SNAPSHOT = ROOT / ".tmp" / "audit-0925" / "ghl_opps.json"
GHL_BASE = "https://services.leadconnectorhq.com"
SHEET_SETTER = "https://docs.google.com/spreadsheets/d/138NtITomg7kSMuA3Se7wskrN1-q5vTUgonawsL9h3ik"


def load_env():
    env = {}
    for line in (ROOT / ".env").read_text().splitlines():
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            k, v = line.split("=", 1)
            env[k.strip()] = v.strip()
    return env


ENV = load_env()


def http_json(url, headers=None, data=None):
    body = json.dumps(data).encode() if data is not None else None
    # Sin User-Agent propio, Cloudflare de GHL responde 403 (error 1010) a urllib.
    req = urllib.request.Request(url, data=body, headers={"User-Agent": "prime-club-finanzas/1.0", **(headers or {})},
                                 method="POST" if body else "GET")
    if body:
        req.add_header("Content-Type", "application/json")
    for intento in range(4):
        try:
            with urllib.request.urlopen(req, timeout=120) as r:
                return json.loads(r.read())
        except urllib.error.HTTPError as e:
            if e.code in (429, 500, 502, 503) and intento < 3:
                time.sleep(2 ** intento * 3)
                continue
            raise RuntimeError(f"HTTP {e.code}: {e.read().decode()[:300]}") from None
        except (urllib.error.URLError, TimeoutError, ConnectionError) as e:
            # Red cortada, SSL EOF o lectura vencida: tambien son pasajeros.
            if intento < 3:
                time.sleep(2 ** intento * 3)
                continue
            raise RuntimeError(f"Sin respuesta de {urllib.parse.urlsplit(url).netloc}: {e}") from None


# ---------- Meta ----------

def meta_diario(desde, hasta):
    ver = ENV.get("META_API_VERSION", "v21.0")
    acct = ENV["META_AD_ACCOUNT_ID"]
    acct = acct if acct.startswith("act_") else f"act_{acct}"
    params = {
        "level": "campaign",
        "fields": "campaign_name,campaign_id,spend,impressions,clicks,actions",
        "time_range": json.dumps({"since": desde, "until": hasta}),
        "time_increment": 1,
        "limit": 500,
        "access_token": ENV["META_ACCESS_TOKEN"],
    }
    url = f"https://graph.facebook.com/{ver}/{acct}/insights?{urllib.parse.urlencode(params)}"
    filas = []
    while url:
        d = http_json(url)
        filas += d.get("data", [])
        url = d.get("paging", {}).get("next")
    return filas


def accion(fila, tipo):
    for a in fila.get("actions", []):
        if a["action_type"] == tipo:
            return float(a["value"])
    return 0.0


def tipo_campana(nombre):
    n = nombre.upper()
    if "RMK" in n:
        return "Retargeting"
    if "VSL" in n:
        return "VSL"
    if "DM" in n:
        return "DM Ads"
    return "Otra"


def dolar_mensual(meses):
    """Promedio mensual del dólar observado (CLP por USD). Fuente: mindicador.cl, serie del Banco Central."""
    anios = sorted({m[:4] for m in meses})
    serie = []
    for a in anios:
        serie += http_json(f"https://mindicador.cl/api/dolar/{a}")["serie"]
    out = {}
    for m in meses:
        v = [x["valor"] for x in serie if x["fecha"][:7] == m]
        out[m] = (round(statistics.mean(v), 2), len(v)) if v else (None, 0)
    return out


# ---------- GoHighLevel ----------

def ghl_headers():
    return {"Authorization": f"Bearer {ENV['GHL_TOKEN']}", "Version": "2021-07-28", "Accept": "application/json"}


def ghl_etapas():
    d = http_json(f"{GHL_BASE}/opportunities/pipelines?locationId={ENV['GHL_LOCATION_ID']}", ghl_headers())
    return {s["id"]: (p["name"], s["name"]) for p in d.get("pipelines", []) for s in p.get("stages", [])}


def ghl_oportunidades(desde):
    """Oportunidades creadas desde `desde`. GHL las devuelve de la más nueva a la más vieja."""
    filas, params = [], {"location_id": ENV["GHL_LOCATION_ID"], "limit": 100}
    while True:
        d = http_json(f"{GHL_BASE}/opportunities/search?{urllib.parse.urlencode(params)}", ghl_headers())
        lote = d.get("opportunities", [])
        filas += [o for o in lote if o["createdAt"][:10] >= desde]
        meta = d.get("meta", {})
        if not lote or lote[-1]["createdAt"][:10] < desde or not meta.get("startAfterId"):
            return filas
        params.update(startAfter=meta["startAfter"], startAfterId=meta["startAfterId"])


def ghl_contactos(desde, hasta):
    """Todos los contactos creados en el rango: es el universo de leads, no solo los que agendaron."""
    filas, pagina = [], 1
    while True:
        d = http_json(
            f"{GHL_BASE}/contacts/search",
            ghl_headers(),
            {
                "locationId": ENV["GHL_LOCATION_ID"],
                "page": pagina,
                "pageLimit": 100,
                "filters": [{"field": "dateAdded", "operator": "range",
                             "value": {"gte": f"{desde}T00:00:00Z", "lte": f"{hasta}T23:59:59Z"}}],
                "sort": [{"field": "dateAdded", "direction": "desc"}],
            },
        )
        lote = d.get("contacts", [])
        filas += lote
        if len(lote) < 100:
            return filas
        pagina += 1


def origen(utm_source, utm_medium):
    s, m = (utm_source or "").lower(), (utm_medium or "").lower()
    if s in ("meta", "fb", "facebook") or m in ("paid", "cpc", "paid_social"):
        return "Meta Ads"
    if m == "dm":
        return "DM (setter)"
    if s == "ig" or m in ("social", "story"):
        return "Orgánico IG"
    if s or m:
        return "Otro"
    return "Sin UTM"


def fila_oportunidad(o, etapas):
    attrs = o.get("attributions") or []
    primera = next((a for a in attrs if a.get("isFirst")), attrs[0] if attrs else {})
    c = o.get("contact") or {}
    pipeline, etapa = etapas.get(o.get("pipelineStageId"), ("", o.get("pipelineStageId", "")))
    return {
        "creado": o["createdAt"][:10],
        "nombre": c.get("name") or o.get("name", "").split(" | ")[0],
        "email": c.get("email") or "",
        "telefono": c.get("phone") or "",
        "fuente_ghl": o.get("source") or "",
        "origen": origen(primera.get("utmSource"), primera.get("utmMedium")),
        "utm_source": primera.get("utmSource") or "",
        "utm_medium": primera.get("utmMedium") or "",
        "utm_campaign": primera.get("utmCampaign") or "",
        "utm_content": primera.get("utmContent") or "",
        "tags": ", ".join(c.get("tags") or []),
        "pipeline": pipeline,
        "etapa": etapa,
        "estado": o.get("status") or "",
        "valor": o.get("monetaryValue") or 0,
        "cambio_etapa": (o.get("lastStageChangeAt") or o["createdAt"])[:10],
    }


# ---------- Setter ----------

def leer_setter():
    filas = []
    with SETTER_CSV.open(encoding="utf-8") as f:
        for r in csv.DictReader(f):
            if not r["Fecha"].strip():
                continue
            monto = r["Monto ($)"].replace("$", "").replace(",", "").strip()
            filas.append({
                "fecha": dt.datetime.strptime(r["Fecha"].strip(), "%d-%m-%Y").date(),
                "prospecto": r["Prospecto"].strip(),
                "fuente": r["Fuente del lead"].strip(),
                "detalle": r["Detalle de la fuente (qué story, reel o anuncio)"].strip(),
                "asistio": r["¿Asistió?"].strip(),
                "nota": float(r["Del 1 al 10"]) if r["Del 1 al 10"].strip() else None,
                "resultado": r["Resultado"].strip(),
                "plan": r["Plan vendido"].strip(),
                "monto": float(monto) if monto else None,
                "objecion": r["Objeción principal"].strip(),
                "seguimiento": r["Próximo seguimiento"].strip(),
                "notas": r["Notas"].strip(),
            })
    return filas


# ---------- Excel ----------

FUENTE = "Arial"
AZUL = Font(name=FUENTE, color="0000FF")
NEGRO = Font(name=FUENTE)
VERDE = Font(name=FUENTE, color="008000")
TITULO = Font(name=FUENTE, bold=True, size=14)
CABECERA = Font(name=FUENTE, bold=True, color="FFFFFF")
FONDO_CAB = PatternFill("solid", fgColor="1F2A37")
AMARILLO = PatternFill("solid", fgColor="FFFF00")
GRIS = Font(name=FUENTE, italic=True, color="666666")

F_CLP = '#,##0;(#,##0);"-"'
F_USD = '$#,##0;($#,##0);"-"'
F_PCT = '0.0%;(0.0%);"-"'
F_X = '0.00"x"'
F_FECHA = "dd-mm-yyyy"


def cabecera(ws, fila, textos, anchos=None):
    for i, t in enumerate(textos, 1):
        c = ws.cell(fila, i, t)
        c.font, c.fill = CABECERA, FONDO_CAB
        c.alignment = Alignment(wrap_text=True, vertical="center")
        if anchos:
            ws.column_dimensions[get_column_letter(i)].width = anchos[i - 1]
    ws.freeze_panes = ws.cell(fila + 1, 1)


def construir(meta, tc, opps, contactos, setter, cobertura, desde, hasta, ruta):
    wb = Workbook()
    wb._named_styles["Normal"].font = Font(name=FUENTE, size=10)
    resumen = wb.active
    resumen.title = "Resumen"

    # --- Supuestos ---
    sup = wb.create_sheet("Supuestos")
    sup["A1"], sup["A1"].font = "Supuestos y fuentes", TITULO
    cabecera(sup, 3, ["Parámetro", "Valor", "Fuente / nota"], [38, 16, 90])
    fila = 4
    sup_ref = {}
    for mes, (valor, n) in sorted(tc.items()):
        sup.cell(fila, 1, f"Dólar observado {mes} (CLP por USD)").font = NEGRO
        c = sup.cell(fila, 2, valor)
        c.font, c.number_format = AZUL, "#,##0.00"
        sup.cell(fila, 3, f"Promedio de {n} días hábiles. mindicador.cl/api/dolar (serie del Banco Central de Chile), consultado {dt.date.today()}").font = GRIS
        sup.cell(fila, 4, dt.date(int(mes[:4]), int(mes[5:7]), 1)).number_format = "mmm-yyyy"
        sup_ref[mes] = f"Supuestos!$B${fila}"
        fila += 1
    tc_ini = 4
    tc_fin = fila - 1
    sup.cell(3, 4, "Mes (clave)").font = CABECERA
    sup.cell(3, 4).fill = FONDO_CAB

    filas_sup = [
        ("Meta mensual (USD)", 30000, "Prioridad #1 de la cuenta (CLAUDE.md)", "meta"),
        ("Ticket de referencia (USD)", 1000, "context/oferta.md. Los montos reales de cada venta vienen del registro del setter", "ticket"),
        ("Inicio del registro del setter", cobertura["setter_desde"], f"Primera fila del sheet de Rodolfo. Antes de esta fecha llamadas/ventas = s/d. {SHEET_SETTER}", "setter_desde"),
        ("Corte de datos GHL", cobertura["ghl_hasta"], cobertura["ghl_nota"], "ghl_hasta"),
        ("Corte de datos Meta", dt.date.fromisoformat(hasta), "Meta Marketing API, cuenta act_1059963115650620 (CLP, America/Santiago)", "meta_hasta"),
    ]
    fila += 1
    for texto, valor, nota, clave in filas_sup:
        sup.cell(fila, 1, texto).font = NEGRO
        c = sup.cell(fila, 2, valor)
        c.font, c.fill = AZUL, AMARILLO
        if isinstance(valor, dt.date):
            c.number_format = F_FECHA
        elif isinstance(valor, (int, float)):
            c.number_format = F_USD
        sup.cell(fila, 3, nota).font = GRIS
        sup_ref[clave] = f"Supuestos!$B${fila}"
        fila += 1
    fila += 1
    for linea in [
        "Convención de colores: azul = dato de entrada · negro = fórmula · verde = referencia a otra pestaña · amarillo = supuesto clave editable.",
        "s/d = sin dato para ese periodo. No es cero: la fuente no cubría esas fechas.",
        "ROAS total (MER) = ingresos de todas las fuentes / gasto Meta. ROAS atribuido = solo ventas con fuente 'Anuncio' en el registro del setter.",
        "Ingresos = monto cerrado según el setter (USD). No distingue contado de reserva: confirmar con Leo.",
    ]:
        sup.cell(fila, 1, linea).font = GRIS
        fila += 1

    # --- Meta diario ---
    md = wb.create_sheet("Meta diario")
    cab = ["Fecha", "Semana (lunes)", "Mes", "Campaña", "Tipo", "Gasto (CLP)", "Dólar (CLP/USD)", "Gasto (USD)",
           "Impresiones", "Clics", "Conversaciones DM", "Conv. reales (5+ msj)", "Registros VSL"]
    cabecera(md, 1, cab, [12, 14, 10, 42, 13, 14, 14, 13, 13, 9, 15, 15, 13])
    meta_orden = sorted(meta, key=lambda x: (x["date_start"], x["campaign_name"]))
    for i, x in enumerate(meta_orden, 2):
        md.cell(i, 1, dt.date.fromisoformat(x["date_start"])).number_format = F_FECHA
        md.cell(i, 2, f"=A{i}-WEEKDAY(A{i},2)+1").number_format = F_FECHA
        md.cell(i, 3, f"=DATE(YEAR(A{i}),MONTH(A{i}),1)").number_format = "mmm-yyyy"
        md.cell(i, 4, x["campaign_name"]).font = AZUL
        md.cell(i, 5, tipo_campana(x["campaign_name"])).font = AZUL
        c = md.cell(i, 6, float(x["spend"]))
        c.font, c.number_format = AZUL, F_CLP
        c = md.cell(i, 7, f"=INDEX(Supuestos!$B${tc_ini}:$B${tc_fin},MATCH(C{i},Supuestos!$D${tc_ini}:$D${tc_fin},0))")
        c.font, c.number_format = VERDE, "#,##0.00"
        md.cell(i, 8, f"=F{i}/G{i}").number_format = F_USD
        for col, val in [(9, int(x.get("impressions", 0))), (10, int(x.get("clicks", 0))),
                         (11, accion(x, "onsite_conversion.messaging_conversation_started_7d")),
                         (12, accion(x, "onsite_conversion.messaging_user_depth_5_message_send")),
                         (13, accion(x, "complete_registration"))]:
            c = md.cell(i, col, val)
            c.font, c.number_format = AZUL, "#,##0"
    n_md = len(meta_orden) + 1

    # --- Leads GHL (oportunidades = agendas) ---
    lg = wb.create_sheet("Agendas GHL")
    cab = ["Creado", "Semana (lunes)", "Mes", "Nombre", "Email", "Teléfono", "Fuente GHL", "Origen (UTM)",
           "utm_source", "utm_medium", "utm_campaign", "utm_content", "Tags", "Pipeline", "Etapa", "Estado", "Valor (USD)",
           "Cambio de etapa", "Semana del cambio", "Mes del cambio"]
    cabecera(lg, 1, cab, [12, 14, 10, 28, 30, 16, 24, 14, 11, 11, 18, 22, 40, 18, 22, 10, 11, 13, 14, 10])
    for i, o in enumerate(sorted(opps, key=lambda z: z["creado"]), 2):
        lg.cell(i, 1, dt.date.fromisoformat(o["creado"])).number_format = F_FECHA
        lg.cell(i, 2, f"=A{i}-WEEKDAY(A{i},2)+1").number_format = F_FECHA
        lg.cell(i, 3, f"=DATE(YEAR(A{i}),MONTH(A{i}),1)").number_format = "mmm-yyyy"
        for col, k in enumerate(["nombre", "email", "telefono", "fuente_ghl", "origen", "utm_source", "utm_medium",
                                 "utm_campaign", "utm_content", "tags", "pipeline", "etapa", "estado", "valor"], 4):
            lg.cell(i, col, o[k]).font = AZUL
        lg.cell(i, 17).number_format = F_USD
        if o["valor"] >= 100000:
            lg.cell(i, 17).comment = Comment("Valor sospechoso: parece cargado en CLP o con ceros de más. No se usa como ingreso.", "Iann")
            lg.cell(i, 17).fill = AMARILLO
        lg.cell(i, 18, dt.date.fromisoformat(o["cambio_etapa"])).number_format = F_FECHA
        lg.cell(i, 19, f"=R{i}-WEEKDAY(R{i},2)+1").number_format = F_FECHA
        lg.cell(i, 20, f"=DATE(YEAR(R{i}),MONTH(R{i}),1)").number_format = "mmm-yyyy"
    n_lg = max(len(opps) + 1, 2)
    lg.cell(n_lg + 2, 1, cobertura["ghl_nota"]).font = GRIS

    # --- Contactos GHL (universo de leads) ---
    if contactos is not None:
        cg = wb.create_sheet("Leads GHL")
        cabecera(cg, 1, ["Creado", "Semana (lunes)", "Nombre", "Email", "Teléfono", "Fuente", "Origen (UTM)", "Tags"],
                 [12, 14, 28, 30, 16, 24, 14, 50])
        for i, c in enumerate(sorted(contactos, key=lambda z: z.get("dateAdded", "")), 2):
            a = c.get("attributionSource") or {}
            cg.cell(i, 1, dt.date.fromisoformat(c["dateAdded"][:10])).number_format = F_FECHA
            cg.cell(i, 2, f"=A{i}-WEEKDAY(A{i},2)+1").number_format = F_FECHA
            nombre = " ".join(filter(None, [c.get("firstName"), c.get("lastName")])) or c.get("contactName") or ""
            for col, v in enumerate([nombre, c.get("email") or "", c.get("phone") or "", c.get("source") or "",
                                     origen(a.get("utmSource"), a.get("utmMedium")), ", ".join(c.get("tags") or [])], 3):
                cg.cell(i, col, v).font = AZUL

    # --- Conciliación ventas GHL vs setter ---
    cc = wb.create_sheet("Conciliación ventas")
    cabecera(cc, 1, ["Prospecto", "GHL: etapa", "GHL: fecha cambio", "GHL: valor", "Setter: resultado", "Setter: asistió",
                     "Setter: monto (USD)", "Estado"], [28, 16, 14, 13, 16, 13, 16, 46])
    norm = lambda t: " ".join(t.lower().split())  # noqa: E731
    ghl_c = {norm(o["nombre"]): o for o in opps if o["etapa"] == "Cerrada"}
    set_c = {norm(x["prospecto"]): x for x in setter}
    claves = sorted(set(ghl_c) | {k for k, x in set_c.items() if x["resultado"] == "Cerró"})
    for i, k in enumerate(claves, 2):
        g, st = ghl_c.get(k), set_c.get(k)
        if g and st and st["resultado"] == "Cerró":
            estado = "OK: venta en ambas fuentes"
            if g["valor"] and st["monto"] and abs(g["valor"] - st["monto"]) > 1:
                estado = "Monto distinto: corregir valor en GHL"
        elif g and st:
            estado = f"Conflicto: GHL dice Cerrada, setter dice '{st['resultado'] or 'sin resultado'}' / asistió '{st['asistio']}'"
        elif g:
            estado = "Solo en GHL: falta en el sheet del setter"
        else:
            estado = "Solo en el sheet: mover tarjeta a Cerrada en GHL"
        vals = [(g or {}).get("nombre") or st["prospecto"], g and g["etapa"],
                g and dt.date.fromisoformat(g["cambio_etapa"]), g and g["valor"],
                st and st["resultado"], st and st["asistio"], st and st["monto"], estado]
        for col, v in enumerate(vals, 1):
            c = cc.cell(i, col, v if v not in (None, "") else None)
            c.font = AZUL if col < 8 else NEGRO
        cc.cell(i, 3).number_format = F_FECHA
        cc.cell(i, 4).number_format = F_USD
        cc.cell(i, 7).number_format = F_USD
        if not estado.startswith("OK"):
            cc.cell(i, 8).fill = AMARILLO
    cc.cell(len(claves) + 3, 1, "Hasta resolver estas diferencias, el Resumen toma ingresos y ventas del sheet del setter (monto en USD). "
            "'Cerradas en GHL' se muestra al lado para que la brecha sea visible.").font = GRIS

    # --- Llamadas (setter) ---
    ll = wb.create_sheet("Llamadas setter")
    cab = ["Fecha", "Semana (lunes)", "Mes", "Prospecto", "Fuente del lead", "Detalle fuente", "¿Asistió?", "Nota 1-10",
           "Resultado", "Plan", "Monto (USD)", "Objeción", "Próximo seguimiento", "Notas", "Asistió (1/0)", "Venta (1/0)"]
    cabecera(ll, 1, cab, [12, 14, 10, 26, 22, 22, 9, 9, 13, 13, 12, 14, 14, 30, 11, 10])
    for i, r in enumerate(setter, 2):
        ll.cell(i, 1, r["fecha"]).number_format = F_FECHA
        ll.cell(i, 2, f"=A{i}-WEEKDAY(A{i},2)+1").number_format = F_FECHA
        ll.cell(i, 3, f"=DATE(YEAR(A{i}),MONTH(A{i}),1)").number_format = "mmm-yyyy"
        for col, k in enumerate(["prospecto", "fuente", "detalle", "asistio", "nota", "resultado", "plan", "monto",
                                 "objecion", "seguimiento", "notas"], 4):
            ll.cell(i, col, r[k]).font = AZUL
        ll.cell(i, 11).number_format = F_USD
        ll.cell(i, 15, f'=IF(G{i}="Sí",1,0)')
        ll.cell(i, 16, f'=IF(I{i}="Cerró",1,0)')
    n_ll = max(len(setter) + 1, 2)
    ll.cell(n_ll + 2, 1, f"Fuente: {SHEET_SETTER} (pestaña Llamadas), exportada {dt.date.today()}. Filas sin '¿Asistió?' = llamada aún sin resultado anotado.").font = GRIS

    # --- Resumen ---
    r = resumen
    r["A1"], r["A1"].font = "Prime Club · Finanzas y adquisición", TITULO
    r["A2"] = f"Periodo {desde} → {hasta} · generado {dt.date.today()} con tools/finanzas_excel.py"
    r["A2"].font = GRIS

    MD, LG, LL = "'Meta diario'", "'Agendas GHL'", "'Llamadas setter'"
    rng = lambda hoja, col, n: f"{hoja}!${col}$2:${col}${n}"  # noqa: E731
    cols = ["Periodo", "Gasto Meta (CLP)", "Gasto Meta (USD)", "Conversaciones DM", "Conv. reales (5+)", "Registros VSL",
            "Agendas GHL", "Llamadas (setter)", "Asistieron", "Ventas", "Ingresos (USD)",
            "Show rate", "Close rate", "Costo por conversación (USD)", "Costo por agenda (USD)", "CAC (USD)",
            "ROAS total (MER)", "ROAS atribuido (Anuncio)", "Cerradas en GHL"]
    anchos = [14, 15, 14, 14, 13, 12, 11, 12, 11, 9, 13, 10, 10, 15, 14, 11, 12, 14, 12]

    def bloque(fila_ini, periodos, clave_col, fin_expr, etiqueta_fmt):
        """Una fila por periodo. clave_col = columna de agrupación en las pestañas de datos (B=semana, C=mes)."""
        cabecera(r, fila_ini, cols, anchos)
        for j, p in enumerate(periodos, fila_ini + 1):
            a = f"$A{j}"
            fin = fin_expr(j)
            c = r.cell(j, 1, p)
            c.number_format, c.font = etiqueta_fmt, AZUL
            r.cell(j, 2, f"=SUMIFS({rng(MD,'F',n_md)},{rng(MD,clave_col,n_md)},{a})").number_format = F_CLP
            r.cell(j, 3, f"=SUMIFS({rng(MD,'H',n_md)},{rng(MD,clave_col,n_md)},{a})").number_format = F_USD
            r.cell(j, 4, f"=SUMIFS({rng(MD,'K',n_md)},{rng(MD,clave_col,n_md)},{a})").number_format = "#,##0"
            r.cell(j, 5, f"=SUMIFS({rng(MD,'L',n_md)},{rng(MD,clave_col,n_md)},{a})").number_format = "#,##0"
            r.cell(j, 6, f"=SUMIFS({rng(MD,'M',n_md)},{rng(MD,clave_col,n_md)},{a})").number_format = "#,##0"
            # GHL: s/d si el periodo empieza después del corte de datos
            r.cell(j, 7, f'=IF({a}>{sup_ref["ghl_hasta"]},"s/d",COUNTIFS({rng(LG,clave_col,n_lg)},{a}))').number_format = "#,##0"
            # Setter: s/d si el periodo termina antes de que exista el registro
            ok_setter = f"{fin}>={sup_ref['setter_desde']}"
            r.cell(j, 8, f'=IF({ok_setter},COUNTIFS({rng(LL,clave_col,n_ll)},{a}),"s/d")')
            r.cell(j, 9, f'=IF({ok_setter},SUMIFS({rng(LL,"O",n_ll)},{rng(LL,clave_col,n_ll)},{a}),"s/d")')
            r.cell(j, 10, f'=IF({ok_setter},SUMIFS({rng(LL,"P",n_ll)},{rng(LL,clave_col,n_ll)},{a}),"s/d")')
            r.cell(j, 11, f'=IF({ok_setter},SUMIFS({rng(LL,"K",n_ll)},{rng(LL,clave_col,n_ll)},{a}),"s/d")').number_format = F_USD
            r.cell(j, 12, f'=IF(AND(ISNUMBER(H{j}),H{j}>0),I{j}/H{j},"s/d")').number_format = F_PCT
            r.cell(j, 13, f'=IF(AND(ISNUMBER(I{j}),I{j}>0),J{j}/I{j},"s/d")').number_format = F_PCT
            r.cell(j, 14, f'=IF(D{j}>0,C{j}/D{j},"s/d")').number_format = '$#,##0.00'
            r.cell(j, 15, f'=IF(AND(ISNUMBER(G{j}),G{j}>0),C{j}/G{j},"s/d")').number_format = F_USD
            r.cell(j, 16, f'=IF(AND(ISNUMBER(J{j}),J{j}>0),C{j}/J{j},"s/d")').number_format = F_USD
            r.cell(j, 17, f'=IF(AND(ISNUMBER(K{j}),C{j}>0),K{j}/C{j},"s/d")').number_format = F_X
            r.cell(j, 18, f'=IF(AND(ISNUMBER(K{j}),C{j}>0),SUMIFS({rng(LL,"K",n_ll)},{rng(LL,clave_col,n_ll)},{a},{rng(LL,"E",n_ll)},"Anuncio")/C{j},"s/d")').number_format = F_X
            # Por fecha del cambio de etapa, no de creación: una agenda de septiembre puede cerrarse en octubre.
            r.cell(j, 19, f'=IF({a}>{sup_ref["ghl_hasta"]},"s/d",COUNTIFS({rng(LG,"S" if clave_col == "B" else "T",n_lg)},{a},{rng(LG,"O",n_lg)},"Cerrada"))')
        return fila_ini + len(periodos)

    d0, d1 = dt.date.fromisoformat(desde), dt.date.fromisoformat(hasta)
    meses = []
    m = d0.replace(day=1)
    while m <= d1:
        meses.append(m)
        m = (m + dt.timedelta(days=32)).replace(day=1)
    semanas = []
    s = d0 - dt.timedelta(days=d0.weekday())
    while s <= d1:
        semanas.append(s)
        s += dt.timedelta(days=7)

    r["A4"], r["A4"].font = "Por mes", Font(name=FUENTE, bold=True, size=12)
    fin_mes = lambda j: f"EOMONTH($A{j},0)"  # noqa: E731
    ult = bloque(5, meses, "C", fin_mes, "mmm-yyyy")

    # Meta $30K
    k = ult + 2
    r.cell(k, 1, "Avance a la meta").font = Font(name=FUENTE, bold=True, size=12)
    r.cell(k + 1, 1, "Mes en curso")
    r.cell(k + 1, 2, f"=A{ult}").number_format = "mmm-yyyy"
    r.cell(k + 2, 1, "Ingresos del mes (USD)")
    r.cell(k + 2, 2, f"=K{ult}").number_format = F_USD
    r.cell(k + 3, 1, "Meta (USD)")
    r.cell(k + 3, 2, f"={sup_ref['meta']}").font = VERDE
    r.cell(k + 3, 2).number_format = F_USD
    r.cell(k + 4, 1, "% de la meta")
    r.cell(k + 4, 2, f'=IF(ISNUMBER(B{k+2}),B{k+2}/B{k+3},"s/d")').number_format = F_PCT
    r.cell(k + 5, 1, "Ticket promedio real (USD)")
    r.cell(k + 5, 2, f'=IF(AND(ISNUMBER(J{ult}),J{ult}>0),K{ult}/J{ult},"s/d")').number_format = F_USD
    r.cell(k + 6, 1, "Ventas necesarias al ticket real")
    r.cell(k + 6, 2, f'=IF(ISNUMBER(B{k+5}),B{k+3}/B{k+5},"s/d")').number_format = "0.0"
    r.cell(k + 7, 1, "Llamadas realizadas necesarias al close rate real")
    r.cell(k + 7, 2, f'=IF(AND(ISNUMBER(B{k+6}),ISNUMBER(M{ult}),M{ult}>0),B{k+6}/M{ult},"s/d")').number_format = "0"
    r.cell(k + 7, 3, "Ojo: el close rate del mes en curso se calcula sobre pocas llamadas; no es una tasa estable.").font = GRIS

    w = k + 10
    r.cell(w - 1, 1, "Por semana (lunes a domingo)").font = Font(name=FUENTE, bold=True, size=12)
    fin_sem = lambda j: f"($A{j}+6)"  # noqa: E731
    bloque(w, semanas, "B", fin_sem, F_FECHA)
    r.column_dimensions["A"].width = 30

    r["G5"].comment = Comment("Oportunidades creadas en GHL = agendas (calendario 'Llamada de admisión'). Fuera de cobertura = s/d.", "Iann")
    wb.save(ruta)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--desde", default="2026-09-01")
    ap.add_argument("--hasta", default=str(dt.date.today() - dt.timedelta(days=1)))
    a = ap.parse_args()
    OUT.mkdir(parents=True, exist_ok=True)

    print("Meta Ads…")
    meta = meta_diario(a.desde, a.hasta)
    print(f"  {len(meta)} filas campaña×día · gasto {sum(float(x['spend']) for x in meta):,.0f} CLP")

    meses = sorted({x["date_start"][:7] for x in meta} | {a.desde[:7], a.hasta[:7]})
    tc = dolar_mensual(meses)
    print("  dólar observado:", {k: v[0] for k, v in tc.items()})

    print("GoHighLevel…")
    contactos = None
    try:
        etapas = ghl_etapas()
        opps = [fila_oportunidad(o, etapas) for o in ghl_oportunidades(a.desde)]
        contactos = ghl_contactos(a.desde, a.hasta)
        cobertura_ghl = dt.date.fromisoformat(a.hasta)
        nota_ghl = f"GHL API v2 en vivo, consultada {dt.date.today()}"
        print(f"  {len(opps)} oportunidades · {len(contactos)} contactos")
    except (RuntimeError, KeyError) as e:
        print(f"  ! GHL no respondió ({e}). Uso el snapshot {GHL_SNAPSHOT.relative_to(ROOT)}", file=sys.stderr)
        crudo = json.loads(GHL_SNAPSHOT.read_text())
        opps = [fila_oportunidad(o, {}) for o in crudo if o["createdAt"][:10] >= a.desde]
        cobertura_ghl = dt.date.fromisoformat(max(o["createdAt"] for o in crudo)[:10])
        nota_ghl = (f"⚠ Token de GHL inválido. Datos del snapshot del {cobertura_ghl} (auditoría Meta). "
                    "Después de esa fecha = s/d. Regenerar GHL_TOKEN en .env y volver a correr.")
        print(f"  {len(opps)} oportunidades del snapshot (hasta {cobertura_ghl})")

    setter = leer_setter()
    print(f"Setter: {len(setter)} llamadas · {sum(1 for s in setter if s['resultado'] == 'Cerró')} ventas")

    cobertura = {
        "ghl_hasta": cobertura_ghl,
        "ghl_nota": nota_ghl,
        "setter_desde": min(s["fecha"] for s in setter) if setter else dt.date.fromisoformat(a.hasta),
    }
    hoy = dt.date.today().isoformat()
    (OUT / f"fuentes-{hoy}.json").write_text(json.dumps(
        {"meta": meta, "dolar": tc, "agendas_ghl": opps, "contactos_ghl": contactos,
         "setter": [{**s, "fecha": s["fecha"].isoformat()} for s in setter], "cobertura_ghl": nota_ghl},
        ensure_ascii=False, indent=1, default=str))
    ruta = OUT / f"finanzas-{hoy}.xlsx"
    construir(meta, tc, opps, contactos, setter, cobertura, a.desde, a.hasta, ruta)
    print(f"-> {ruta.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
