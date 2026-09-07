# Contrato de la API — dashboard de contenido

**Fuente de verdad para todos los agentes de esta fase.** Nadie inventa formas de datos.

> Anclas actualizados el 2026-08-30 tras cargar el Sheet en vivo: pasó de 111 a **170 piezas**.
> Si Windsor vuelve a refrescar, estos números cambian y las pruebas van a fallar.
> **Eso es correcto**: la suite detectando un movimiento real de datos. Se actualizan a mano,
> nunca se afloja la tolerancia para que pasen.

## Base

- Supabase REST: `https://vqeaicwojsmcelgcuuuh.supabase.co/rest/v1/`
- Auth de lectura: header `apikey` + `Authorization: Bearer` con `SUPABASE_ANON_KEY`
- **Verificado:** `anon` lee las 4 vistas con HTTP 200. RLS `using (true)` + `security_invoker = on`
- Tipos generados: `src/lib/supabase-tipos.ts`

## Vistas disponibles

| Vista | Filas hoy | Columnas clave |
|---|---|---|
| `v_pieza_ranking` | 302 | `post_id, permalink, fecha_publicacion, formato, primera_linea, pide_palabra_clave, alcance, vistas, guardados, compartidos, comentarios, likes, visitas_perfil, seguidores_ganados, metricas_faltantes, tasa_guardado, tasa_compartido, tasa_comentario, tasa_like, tasa_visita_perfil, apto_ranking, base_formato, multiplicador` |
| `v_base_formato` | 3 | `cuenta_id, formato, n, mediana_guardado, mediana_compartido, mediana_alcance` |
| `v_pilar_rendimiento` | 6 | `pilar, n, mediana_guardado, mediana_compartido, mediana_alcance` |
| `v_efecto_palabra_clave` | 2 | `pide_palabra_clave, n, mediana_guardado, mediana_alcance` |

Tablas: `pieza`, `pieza_metrica`, `pieza_pilar`, `pilar`, `cuenta`, `config`, `audiencia_snapshot`, `historia`, `historia_metrica`.

## Diferencia crítica con el JSON viejo

**Las vistas devuelven TASAS EN FRACCIÓN (0.0034), el panel espera PORCENTAJES (0.34).**
La conversión `×100` es responsabilidad de la capa de API. Si se olvida, todos los
números del panel salen 100 veces más chicos y nadie lo nota hasta que Leo pregunte.

## Endpoints

### `GET /api/analisis`

Devuelve el objeto `Analisis` que ya define `src/tipos.ts`. **No cambiar esa forma**:
el panel entero la consume y las vistas ya están escritas contra ella.

Mapeo:

| Campo de `Analisis` | Origen |
|---|---|
| `cuenta` | tabla `cuenta` + `cuenta_metrica` más reciente |
| `snapshot` | `max(fecha_snapshot)` de `pieza_metrica` |
| `piso_alcance` | `config` donde `clave='piso_alcance'` |
| `n_total` | `count(*)` de `pieza` |
| `n_con_alcance` | `v_pieza_ranking` con `alcance not null` |
| `n_solidos` | `v_pieza_ranking` con `apto_ranking = true` |
| `base_por_formato` | `v_base_formato` → `{[formato]: {n, guardado_pct_mediana}}` |
| `rankings.todas` | `v_pieza_ranking` donde `apto_ranking`, ordenado por `tasa_guardado desc` |
| `por_pilar` | `v_pilar_rendimiento` |
| `audiencia` / `historias` / `competencia` | vacíos con su `nota` de límite (los llena la Fase 5) |
| `mesa` | derivada de `multiplicador` y los umbrales de `config` |

`tipo`: `REEL` → `"REELS"`, el resto → `"FEED"`.
`pilares` de cada pieza: join con `pieza_pilar`.

### `GET /api/salud`
`{ ok: boolean, fuente: "supabase", snapshot: string|null, n_piezas: number }`

## Reglas que no se negocian

1. **200 con campo `error`, nunca 404**, cuando la base está vacía. Con `comando` diciendo qué correr.
2. **`null` se propaga como `null`.** Jamás convertir a `0` en la traducción. Es la regla central del proyecto.
3. **La `SERVICE_KEY` nunca sale al navegador.** Solo `ANON_KEY`, y solo en el servidor.
4. **No romper el contrato de `src/tipos.ts`.** Si algo no calza, se adapta en la API, no en el tipo.

## Números ancla — cualquier cambio los tiene que preservar

| Chequeo | Valor |
|---|---|
| Piezas | 302 |
| Aptas para ranking | 290 |
| `base_por_formato.CARRUSEL` | n=54, mediana 0,3417% |
| `base_por_formato.REEL` | n=234, mediana 0,2367% |
| `base_por_formato.IMAGEN` | n=2, mediana 0,2278% |
| Vínculos de pilar | 129 |
| `pieza_metrica.impresiones` | 170 nulos, **0 ceros** |
| `pieza_metrica.guardados` | 0 nulos, **13 ceros** |
