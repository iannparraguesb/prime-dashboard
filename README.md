# Dashboard de inteligencia de contenido — @leo_opazo

**Estado:** construido y verificado con datos sintéticos. **Sin datos reales todavía: el token de Meta en `.env` está muerto.** Ver §"Qué necesita" antes de correrlo.

---

## Para qué sirve

No muestra los números que Instagram ya muestra. Responde una pregunta que Instagram no responde: **qué contenido funcionó de verdad, y qué conviene volver a hacer.**

Solo contenido orgánico. No cruza con pauta ni con ventas — eso es otro sistema.

## Por qué mide como mide

Seis decisiones que no son configurables. Un panel bonito con la métrica equivocada es peor que no tener panel, porque le da autoridad a una conclusión falsa.

| # | Decisión | Por qué |
|---|---|---|
| 1 | El ranking va por **tasa de guardado sobre alcance**, no por likes | El like es gratis y reflejo. El guardado cuesta una decisión ("esto lo quiero después") y el compartido cuesta reputación. Para contenido que enseña, el guardado es lo más cerca que hay de "esto le sirvió a alguien" |
| 2 | **Tasa, nunca absoluto** | Una pieza de hace dos años acumuló alcance por llevar dos años arriba. Rankear por guardados absolutos rankea antigüedad |
| 3 | **Mediana, nunca promedio** | Una pieza que explota en Explorar arrastra el promedio y hace ver mejor a todo el conjunto |
| 4 | El multiplicador se calcula contra la mediana del **mismo formato** | Un reel y un carrusel no juegan el mismo deporte |
| 5 | **Piso de 500 de alcance** para entrar al ranking | Sin piso, una pieza con 40 de alcance y 2 guardados marca 5% y encabeza la tabla siendo ruido |
| 6 | Un dato que la API no devolvió **NO es cero** | Se muestra un guion. Mostrar "0,0%" donde no hubo medición hace creer que la pieza fracasó cuando en realidad no se midió |

El panel tampoco afirma relaciones causales entre métricas. Las correlaciones que muestra están **medidas y publicadas con su rho, su p y su n**, salga lo que salga. Un rho cercano a cero es un resultado, no un fallo.

---

## Qué necesita

### 1. Un token de Instagram vivo

⚠️ **El `META_ACCESS_TOKEN` que está hoy en `.env` está muerto** (`OAuthException 190: the user logged out`), y además es un token de *Ads*: no sirve para Insights de Instagram.

Hay que generar uno nuevo en [developers.facebook.com/tools/explorer](https://developers.facebook.com/tools/explorer) con estos permisos:

```
instagram_basic
instagram_manage_insights
pages_show_list
pages_read_engagement
```

Y agregarlo a `.env` en la raíz del repo:

```bash
IG_ACCESS_TOKEN=EAAG...
IG_BUSINESS_ID=17841400000000000   # opcional; si falta se descubre solo
IG_API_VERSION=v23.0               # opcional
IG_COMPETENCIA=academiaentrenadoresonline
```

Requisitos de la cuenta: `@leo_opazo` tiene que ser **Business o Creator** y estar vinculada a una Página de Facebook. Si no lo está, la API no entrega absolutamente ninguna estadística.

### 2. Node y Python

Node 18+ y Python 3.9+. Sin dependencias de Python: los scripts usan solo la librería estándar.

---

## Cómo corre

```bash
# 1. Extraer (desde la raíz del repo)
python3 tools/ig_dump.py

# 2. Verificar el clasificador de pilares antes de confiar en él
python3 tools/ig_pilares.py --verificar data/instagram/engagement-$(date +%F).json

# 3. Analizar
python3 tools/ig_analizar.py

# 4. Levantar el panel
cd projects/dashboard-contenido
npm install          # solo la primera vez
npm run dev          # backend en :5175 + panel en http://localhost:5174
```

Banderas útiles del extractor:

| Bandera | Para qué |
|---|---|
| `--reanudar` | Retoma desde el checkpoint. Son cientos de llamadas; si se corta, no se empieza de cero |
| `--limite 50` | Solo las 50 piezas más recientes. Para probar rápido sin quemar cuota |
| `--solo historias` | Actualiza una sola sección sobre un snapshot ya existente |
| `--fecha AAAA-MM-DD` | Fecha del snapshot |

### Historias: correr a diario o no hay historia

La API **no tiene archivo de historias**: solo devuelve las activas de las últimas 24 horas. Sin una corrida diaria, esa sección solo puede mostrar las de hoy. Si quieres serie histórica:

```bash
# en crontab, 22:00 todos los días
0 22 * * * cd "/Users/iannprrgz/Desktop/Prime club" && /usr/bin/python3 tools/ig_dump.py --solo historias
```

---

## Qué tiene que salir

`tools/ig_dump.py` imprime la cuenta, el conteo de piezas y cuántas quedaron con métricas incompletas (normal: cada tipo de contenido acepta métricas distintas).

`tools/ig_analizar.py` imprime algo así:

```
Snapshot: engagement-2026-08-14.json
  380 piezas · 371 con alcance medido · 344 sobre el piso de 500
  base VIDEO: mediana guardado 1.06% (n=210)
  base CAROUSEL_ALBUM: mediana guardado 1.95% (n=134)
  like% vs guardado%: rho=-0.042 p=0.661 n=336
  9 propuestas en la mesa de trabajo
```

**Los tres números que hay que mirar en esa salida:**

- **Piezas sobre el piso.** Si son menos de ~30, las medianas por formato no son confiables todavía y el multiplicador miente.
- **`rho` de like% vs guardado%.** Si sale cerca de 0, confirma la decisión #1: los likes no predicen si el contenido sirvió. Sea cual sea el número, se publica.
- **Piezas con métricas incompletas.** Si son casi todas, el token perdió `instagram_manage_insights`.

Y del clasificador:

```
Pilares por texto (prom): 0.94   <- si pasa de 1,50 el léxico está suelto
Sin clasificar:           17.4%  <- 25-30% es sano
```

Un promedio arriba de 1,50 significa que el léxico está clasificando todo en todos lados, o sea que no está clasificando nada. Una señal que aparece en todas partes no es una señal. Se arregla sacando palabras débiles de `tools/ig_pilares.py`.

---

## Qué hacer cuando falla

| Síntoma | Causa probable | Solución |
|---|---|---|
| `OAuthException 190` / "the user logged out" | Token caducado o sesión de Facebook cerrada | Regenerar el token en el Graph API Explorer y actualizar `IG_ACCESS_TOKEN` en `.env` |
| "No hay ninguna Página con cuenta de Instagram Business vinculada" | Falta `pages_show_list`, o la cuenta no es Business/Creator | Revisar permisos del token; si la cuenta es personal, convertirla en Configuración → Tipo de cuenta |
| Muchas piezas con `metricas_faltantes` | Normal en parte: cada tipo acepta métricas distintas. Si son casi todas, falta `instagram_manage_insights` | Verificar el permiso. Las que falten quedan como guion, nunca como cero |
| La corrida se corta a la mitad | Rate limit de Meta o red | `python3 tools/ig_dump.py --reanudar` — el checkpoint conserva lo ya medido |
| `Ya existe engagement-AAAA-MM-DD.json` | Protección: los snapshots no se pisan | `--reanudar` para completarlo, o `--fecha` para otro día |
| El panel dice "Todavía no se extrajeron datos" | No hay `analisis-latest.json` | Correr el comando exacto que muestra la propia pantalla |
| El panel dice "No hay conexión con el backend" | `server.mjs` no está corriendo | `npm run dev` (levanta backend y Vite juntos) |
| "La API respondió algo que no es JSON" | El proxy de Vite devolvió HTML porque el backend está caído | Igual que el anterior |
| Sección de Audiencia vacía | La demografía necesita 100+ seguidores y el permiso vigente | La pantalla lo explica ahí mismo. No es un cero: es un dato no entregado |
| Competencia con error | `business_discovery` solo funciona con cuentas Business/Creator públicas y el username exacto | Revisar `IG_COMPETENCIA` en `.env` |
| Miniaturas rotas en la grilla | Las URLs de la API son firmadas y caducan | Volver a extraer. La tarjeta ya lo muestra como "Miniatura caducada", no como imagen rota |
| Todo marca "sin clasificar" | El léxico no coincide con cómo escribe Leo de verdad | Ajustar `PILARES` en `tools/ig_pilares.py` con captions reales y volver a verificar |

---

## Cómo está armado

```
tools/
├── ig_dump.py        # extracción: checkpoint, reintentos, degradación por métrica
├── ig_pilares.py     # léxico de pilares + verificador del clasificador
└── ig_analizar.py    # produce el contrato de datos

data/instagram/
├── engagement-AAAA-MM-DD.json   # snapshot crudo, NUNCA se pisa, sin tasas calculadas
├── analisis-AAAA-MM-DD.json     # análisis fechado
└── analisis-latest.json         # lo que lee el panel

projects/dashboard-contenido/
├── server.mjs        # backend: 200 con campo `error` cuando el dato no existe, nunca 404
└── src/
    ├── theme.css     # tokens de color — un solo lugar
    ├── hooks/useApi.ts        # el contrato: cargando / error / vacío / datos
    └── components/states.tsx  # el árbol de decisión de estados
```

**Por qué el crudo no lleva tasas calculadas:** para poder recalcular criterios nuevos sobre snapshots viejos. Si mañana el piso sube a 1.000 o el multiplicador cambia de base, se recorre el histórico completo sin volver a llamar a la API.

**Por qué el backend responde 200 con `error` y no 404:** un 404 deja la vista en blanco; un 200 con error deja que la pantalla muestre la instrucción exacta de qué comando correr. Buena parte de los datos se llenan corriendo un script a mano, así que "todavía no hay datos" es un estado **normal**, no una excepción.

---

## Verificación hecha

- [x] `tsc --noEmit` limpio · `vite build` limpio
- [x] Analizador validado con snapshot sintético: se sembró una señal conocida (piezas del pilar del sistema con 3x la tasa de guardado) y el análisis la recuperó (4,68% vs 1,11% de mediana)
- [x] Se sembró también una métrica de **puro ruido** (likes independientes del guardado) y el análisis **no inventó correlación**: rho −0,042, p 0,661
- [x] Piso de alcance verificado: una pieza sembrada con 40 de alcance y 5% de guardado quedó fuera del ranking
- [x] Nulos verificados: 8 piezas sin `saved` salieron con `guardado_pct: null`, ninguna como 0
- [x] Multiplicador verificado contra la mediana del propio formato (carrusel 1,95% vs video 1,06%, como se sembró)
- [x] `rankings.todas` trae REELS y FEED, así que el filtro "Feed" no marca cero
- [x] Rutas de estado probadas por HTTP: con datos (200), snapshot sin analizar (200 + comando `ig_analizar.py`), sin nada (200 + comando `ig_dump.py`), backend caído (conexión rechazada → el hook lo traduce a mensaje con salida)
- [x] Datos sintéticos borrados
- [ ] **Pendiente:** revisión visual en navegador. La extensión de Chrome no está conectada a esta cuenta, así que las cuatro rutas se verificaron por HTTP y no a nivel de píxeles
- [ ] **Pendiente:** promedio de pilares por texto medido sobre captions **reales**. El 0,94 de la verificación salió de textos sintéticos y no dice nada del léxico de verdad
