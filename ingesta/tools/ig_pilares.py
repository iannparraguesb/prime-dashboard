#!/usr/bin/env python3
"""
Clasificador lexico de pilares de contenido para @leo_opazo.

Por que lexico y no semantico: es auditable. Cuando se equivoca se ve por que
se equivoco, y se arregla editando una lista en vez de reentrenando algo.

Como funciona:
  - Cada pilar tiene FRASES FUERTES (peso 3) y PALABRAS DEBILES (peso 1).
  - Se cuentan senales DISTINTAS, no repeticiones. Repetir "sistema" ocho veces
    no hace al post mas sobre el sistema.
  - Umbral 3: una frase fuerte sola basta; tres palabras debiles tambien.

Verificacion obligatoria antes de confiar en el:
    python3 tools/ig_pilares.py --verificar data/instagram/engagement-AAAA-MM-DD.json
Si el promedio de pilares por texto pasa de ~1,5 el lexico esta demasiado suelto
y no esta clasificando nada. Un 25-30% de "sin clasificar" es sano.

Fuente del lexico: context/avatares.md, context/oferta.md, context/anuncios.md
y .claude/rules/copy-y-creativos.md. Si cambia el posicionamiento, cambia esto.
"""
import json
import pathlib
import re
import sys
import unicodedata

UMBRAL = 3
PESO_FUERTE = 3
PESO_DEBIL = 1

# Orden = orden de presentacion en el panel.
PILARES = {
    "Salir del gimnasio": {
        "fuertes": [
            "dejar el gimnasio", "salir del gimnasio", "atrapado en el gimnasio",
            "entrenador presencial", "cambiar tiempo por dinero", "vender tu tiempo",
            "horas en el gimnasio", "horas en el gym", "vives en el gym",
            "empleado del gimnasio", "trabajar para el gimnasio", "de presencial a online",
            "tope de horas", "no escalas", "depender del gimnasio", "dejar de depender",
            "sin depender", "libertad geografica", "pagan por las horas", "lugar fijo",
            "vivir de las sesiones online", "dejes de depender",
        ],
        "debiles": [
            "gimnasio", "presencial", "turnos", "agotado", "cansado", "horario", "esclavo",
            "sacrificio", "libertad", "depender", "gimansio", "sesiones", "horas",
        ],
    },
    "Cobrar caro": {
        "fuertes": [
            "alto valor", "high ticket", "cobrar mas", "cobrar caro", "subir tus precios",
            "subir el precio", "cobras poco", "cobrando poco", "cuanto cobras",
            "precio de tu asesoria", "asesorias de alto valor", "programas de alto valor",
            "lo que vales", "valor de tu servicio", "vender tus asesorias",
            "vender tus programas", "vender tus sesiones", "vender sus sesiones",
            "aprender a vender", "no sabes vender", "que te valoren", "alta valor",
            "rutina por excel", "excel y pdf", "30usd", "40 usd", "cobrando 30",
            "programa de alto valor",
        ],
        "debiles": [
            "precio", "cobrar", "tarifa", "mensualidad", "plata", "facturar", "ingresos",
            "ticket", "usd", "vender", "venta", "ventas", "dolares", "asesorias", "programas",
            "oferta",
        ],
    },
    "Sistema CODIGO PRIME": {
        "fuertes": [
            "te ayudo a", "ayudo a entrenadores",
            "codigo prime", "metodo prime", "entrenadores prime", "el sistema",
            "sistema completo", "sistema de ventas", "negocio predecible", "paso a paso",
            "crear lanzar y escalar", "estructura de venta", "proceso de venta",
            "sistema de adquisicion", "negocio online real", "negocio como coach online",
            "negocio como entrenador online", "tu negocio como", "comenta prime", "come prime",
            "comienza tu negocio", "comenzar tu negocio", "comiences con tu negocio",
            "comiences tu negocio", "inicies tu negocio", "iniciar tu negocio",
            "empezar con tu negocio", "empieces con tu negocio", "modelo del negocio",
            "modelo de negocio", "entrenamiento gratuito", "clase gratuita", "recurso gratis",
            "cliente ideal", "elegir tu nicho", "escoger tu cliente", "con estructura",
            "los mismos pasos", "anuncios simples", "atraer clientes",
            "construyendo su negocio", "negocio real",
        ],
        "debiles": [
            "sistema", "metodo", "proceso", "estructura", "embudo", "escalar", "predecible",
            "automatizar", "negocio", "nicho", "clientes", "estrategia", "anuncios",
            "te envio", "coach online", "entrenador online", "escalando", "crecer",
        ],
    },
    "Mitos del online": {
        "fuertes": [
            "no necesitas seguidores", "sin miles de seguidores", "no necesitas pagina web",
            "sin pagina web", "no necesitas ser influencer", "el algoritmo no",
            "contenido diario", "subir contenido todos los dias", "mito", "creencia falsa",
            "no es cierto que", "esto no funciona asi", "mas titulos", "otro curso",
            "no necesitas", "el miedo", "perfeccionismo", "hablar a la camara", "muy viejo",
            "ser un buen entrenador", "buen entrenador", "conocimiento tecnico",
            "saber entrenar", "gimnasio tradicional", "paralizado",
            "nadie entiende lo que haces", "con tu celular", "no alcanza con",
            "nuevas habilidades", "te da miedo", "no te gusta como te ves",
        ],
        "debiles": [
            "seguidores", "algoritmo", "influencer", "pagina web", "viral", "creencia",
            "titulo", "certificacion", "miedo", "camara", "celular", "logo", "alcance",
            "habilidades", "listo", "video",
        ],
    },
    "Prueba social": {
        "fuertes": [
            "mis alumnos", "uno de mis alumnos", "una de mis alumnas", "caso de exito",
            "logro facturar", "consiguio su primer cliente", "cerro su primer cliente",
            "paso de cobrar", "resultado de", "testimonio", "ya estan vendiendo", "lo logro",
            "los mismos pasos que uso", "que uso vicente", "como vicente", "primer cliente",
            "ya estan construyendo", "estan haciendo",
        ],
        "debiles": [
            "alumno", "alumnos", "alumna", "alumnas", "resultado", "caso", "facturo", "cerro",
            "logro", "vicente", "ricardo", "natalia", "maia", "esteban", "julio",
            "coaches lo lograron",
        ],
    },
    "Oficio de entrenar": {
        "fuertes": [
            "21 anos", "pedagogia en educacion fisica", "seguimiento diario",
            "adherencia del cliente", "planificacion del entrenamiento",
            "entrenamiento personalizado", "como entrenador", "la industria del fitness",
            "el rubro",
        ],
        "debiles": [
            "entrenamiento", "ejercicio", "rutina", "tecnica", "adherencia", "hipertrofia",
            "fuerza", "nutricion", "progresion", "podcast", "episodio", "capitulo",
        ],
    },
}


def normalizar(texto):
    """Minusculas, sin acentos, sin puntuacion, espacios colapsados."""
    if not texto:
        return ""
    t = unicodedata.normalize("NFD", texto.lower())
    t = "".join(c for c in t if unicodedata.category(c) != "Mn")
    t = re.sub(r"[^a-z0-9\s]", " ", t)
    return re.sub(r"\s+", " ", t).strip()


def _contiene_palabra(texto, palabra):
    """Palabra suelta con limites; frase multi-palabra por substring."""
    if " " in palabra:
        return palabra in texto
    return re.search(r"\b" + re.escape(palabra) + r"\b", texto) is not None


def clasificar(caption):
    """Devuelve la lista de pilares que superan el umbral."""
    t = normalizar(caption)
    if not t:
        return []
    salida = []
    for pilar, lex in PILARES.items():
        puntaje = 0
        for frase in lex["fuertes"]:
            if _contiene_palabra(t, frase):
                puntaje += PESO_FUERTE
        for palabra in lex["debiles"]:
            if _contiene_palabra(t, palabra):
                puntaje += PESO_DEBIL
        if puntaje >= UMBRAL:
            salida.append(pilar)
    return salida


def verificar(ruta):
    """Mide si el lexico esta demasiado suelto. Reporta el numero, no una opinion."""
    datos = json.loads(pathlib.Path(ruta).read_text())
    piezas = datos.get("piezas", datos if isinstance(datos, list) else [])
    if not piezas:
        print("Sin piezas en el snapshot.")
        return 1

    total = 0
    sin_clasificar = 0
    por_pilar = {p: 0 for p in PILARES}
    for p in piezas:
        pil = clasificar(p.get("caption", ""))
        total += len(pil)
        if not pil:
            sin_clasificar += 1
        for x in pil:
            por_pilar[x] += 1

    n = len(piezas)
    promedio = total / n
    print(f"Textos analizados:        {n}")
    print(f"Pilares por texto (prom): {promedio:.2f}   <- si pasa de 1,50 el lexico esta suelto")
    print(f"Sin clasificar:           {sin_clasificar} ({sin_clasificar / n * 100:.1f}%)   <- 25-30% es sano")
    print()
    for pilar, c in sorted(por_pilar.items(), key=lambda kv: -kv[1]):
        print(f"  {c:4d}  ({c / n * 100:5.1f}%)  {pilar}")
    print()
    if promedio > 1.5:
        print("VEREDICTO: lexico demasiado suelto. Saca palabras debiles que aparecen en todas partes.")
        return 1
    if sin_clasificar / n > 0.5:
        print("VEREDICTO: lexico demasiado estrecho. Mas de la mitad queda sin clasificar.")
        return 1
    print("VEREDICTO: dentro de rango.")
    return 0


if __name__ == "__main__":
    if len(sys.argv) >= 3 and sys.argv[1] == "--verificar":
        sys.exit(verificar(sys.argv[2]))
    print(__doc__)
    print("Pilares definidos:", ", ".join(PILARES))
