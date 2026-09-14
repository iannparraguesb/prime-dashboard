# Graph Report - prime-dashboard  (2026-09-10)

## Corpus Check
- Corpus is ~31,798 words - fits in a single context window. You may not need a graph.

## Summary
- 383 nodes · 782 edges · 22 communities (16 shown, 2 thin omitted)
- Extraction: 94% EXTRACTED · 6% INFERRED · 0% AMBIGUOUS · INFERRED: 48 edges (avg confidence: 0.84)
- Token cost: 120,207 input · 0 output

## Community Hubs (Navigation)
- Vistas y componentes del panel
- Backend seguro y rate limit
- Aislamiento por alumno (S02, S05, S09)
- Dependencias del panel
- Esquema base de Supabase
- Base reproducible y contrato de datos
- Vista de palabra clave
- Configuracion de TypeScript
- Utilidades de pruebas
- Conexion Instagram e ingesta (S03, S04, S06, S07)
- Filtros y pruebas puras
- Autenticacion Supabase
- Despliegue en Vercel
- Tipos de la base
- Plan semanal interno
- Arranque de desarrollo
- Verificacion estadistica
- Doctrina de medicion

## God Nodes (most connected - your core abstractions)
1. `pct()` - 20 edges
2. `num()` - 18 edges
3. `atender()` - 17 edges
4. `react` - 16 edges
5. `construirAnalisis()` - 16 edges
6. `compacto()` - 16 edges
7. `compilerOptions` - 16 edges
8. `HttpError` - 15 edges
9. `Icono()` - 12 edges
10. `Base()` - 11 edges

## Surprising Connections (you probably didn't know these)
- `«Publicado en 30 días» cuenta solo piezas sólidas` --semantically_similar_to--> `Decisión 5 — Piso de 500 de alcance para entrar al ranking`  [INFERRED] [semantically similar]
  AUDITORIA.md → README.md
- `El snapshot crudo no lleva tasas calculadas` --semantically_similar_to--> `Vista v_pieza_ranking`  [INFERRED] [semantically similar]
  README.md → docs-contrato.md
- `Alcance sumado no es audiencia única` --semantically_similar_to--> `Decisión 6 — Un dato que la API no devolvió NO es cero`  [INFERRED] [semantically similar]
  AUDITORIA.md → README.md
- `Historias: correr a diario o no hay historia` --semantically_similar_to--> `Sincronización incremental con cursor y checkpoints`  [INFERRED] [semantically similar]
  README.md → AUDITORIA.md
- `Decisión 6 — Un dato que la API no devolvió NO es cero` --semantically_similar_to--> `Regla — null se propaga como null`  [INFERRED] [semantically similar]
  README.md → docs-contrato.md

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **Las seis decisiones de medición que no son configurables** — readme_tasa_de_guardado_sobre_alcance, readme_tasa_nunca_absoluto, readme_mediana_nunca_promedio, readme_multiplicador_por_formato, readme_piso_de_alcance, readme_nulo_no_es_cero [EXTRACTED 1.00]
- **Orden de implementación por fases con puertas de salida** — auditoria_fase_0_base_reproducible, auditoria_fase_1_aislamiento, auditoria_fase_2_conexion, auditoria_fase_3_ingesta_alojada, auditoria_fase_4_producto_alumno, auditoria_fase_5_produccion [EXTRACTED 1.00]
- **Correcciones de uso y calidad de datos en las vistas del panel** — auditoria_publicado_en_30_dias, auditoria_catalogo_vs_ranking, auditoria_rangos_en_piezas, auditoria_periodo_publicacion_vs_medicion, auditoria_alcance_sumado_no_es_audiencia_unica, src_views_resumen, src_views_piezas, src_components_filterbar [EXTRACTED 1.00]

## Communities (22 total, 2 thin omitted)

### Community 0 - "Vistas y componentes del panel"
Cohesion: 0.09
Nodes (49): react, Calendario, base, Icono(), NombreIcono, trazos, destacado(), ReelCard() (+41 more)

### Community 1 - "Backend seguro y rate limit"
Cohesion: 0.09
Nodes (49): HttpError, json(), rateLimit(), readBody(), reportError(), textField(), uuid(), windows (+41 more)

### Community 2 - "Aislamiento por alumno (S02, S05, S09)"
Cohesion: 0.06
Nodes (43): No esconder todo el contenido de cuentas pequeñas, Promesa y recorrido del alumno, Fase 1 — Aislamiento, Fase 4 — Producto alumno, «Publicado en 30 días» cuenta solo piezas sólidas, S02 — El modelo sigue siendo de una cuenta interna, S05 — Sesiones y respuestas antiguas pueden mezclarse en el cliente, S09 — Storage público necesita una decisión explícita (+35 more)

### Community 3 - "Dependencias del panel"
Cohesion: 0.06
Nodes (34): dependencies, react, react-dom, @supabase/auth-js, devDependencies, @types/node, @types/react, @types/react-dom (+26 more)

### Community 4 - "Esquema base de Supabase"
Cohesion: 0.19
Nodes (21): audiencia_snapshot, config, cuenta, cuenta_metrica, historia, historia_metrica, pieza, pieza_metrica (+13 more)

### Community 5 - "Base reproducible y contrato de datos"
Cohesion: 0.11
Nodes (21): Job CI «verificar», Alcance sumado no es audiencia única, Fase 0 — Base reproducible, Periodo de publicación ≠ periodo de medición, Pruebas contra datos vivos y confianza en las métricas, S01 — La seguridad real no es reproducible desde el repositorio, S08 — Publicar el workspace completo expone información innecesaria, Conversión ×100 de fracción a porcentaje (+13 more)

### Community 6 - "Vista de palabra clave"
Cohesion: 0.14
Nodes (19): PalabraClave, Kpi(), Numerico, boolOnulo(), CLAVES_EFECTO, CONECTORES, construirInventario(), FilaEfecto (+11 more)

### Community 7 - "Configuracion de TypeScript"
Cohesion: 0.11
Nodes (17): compilerOptions, allowImportingTsExtensions, isolatedModules, jsx, lib, module, moduleResolution, noEmit (+9 more)

### Community 8 - "Utilidades de pruebas"
Cohesion: 0.23
Nodes (11): ARCHIVO_ENV, bajarApi(), cargarEnv(), contarFilas(), credenciales(), leerRest(), levantarApi(), obtenerJwt() (+3 more)

### Community 9 - "Conexion Instagram e ingesta (S03, S04, S06, S07)"
Cohesion: 0.14
Nodes (15): Fase 2 — Conexión, Fase 3 — Ingesta alojada, Fase 5 — Producción, Instagram Login y permisos de Insights, Rate limiting de Meta (4800 × impresiones), Chunks, consultas y rendimiento, S03 — No existe onboarding OAuth por alumno, S04 — Sin límites propios y con trabajo excesivo por solicitud (+7 more)

### Community 10 - "Filtros y pruebas puras"
Cohesion: 0.17
Nodes (10): Los rangos ya existen en Piezas, aplicar(), CriterioOrden, dentroDelPeriodo(), FilterBar(), filtrar(), Filtros, FILTROS_INICIALES (+2 more)

### Community 11 - "Autenticacion Supabase"
Cohesion: 0.29
Nodes (7): @supabase/auth-js, Login(), EstadoSesion, anon, faltaConfig, supabase, url

### Community 12 - "Despliegue en Vercel"
Cohesion: 0.22
Nodes (8): maxDuration, buildCommand, functions, api/index.mjs, headers, outputDirectory, rewrites, $schema

### Community 13 - "Tipos de la base"
Cohesion: 0.25
Nodes (7): FilaConfig, FilaCuenta, FilaPiezaPilar, VBaseFormato, VEfectoPalabraClave, VPiezaRanking, VPilarRendimiento

### Community 14 - "Plan semanal interno"
Cohesion: 0.50
Nodes (3): auth, auth.users, public.dashboard_tarea

### Community 17 - "Verificacion estadistica"
Cohesion: 0.67
Nodes (3): Correlaciones publicadas con rho, p y n, Verificación del analizador con datos sintéticos, Verificador del clasificador de pilares

## Knowledge Gaps
- **111 isolated node(s):** `windows`, `name`, `private`, `version`, `type` (+106 more)
  These have ≤1 connection - possible missing edges or undocumented components. (Counts symbols only; 148 node(s) total have ≤1 connection when file, concept and rationale nodes are included.)
- **2 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `react` connect `Vistas y componentes del panel` to `Autenticacion Supabase`, `Aislamiento por alumno (S02, S05, S09)`, `Dependencias del panel`, `Vista de palabra clave`?**
  _High betweenness centrality (0.163) - this node is a cross-community bridge._
- **Why does `GET /api/analisis` connect `Base reproducible y contrato de datos` to `Backend seguro y rate limit`, `Aislamiento por alumno (S02, S05, S09)`?**
  _High betweenness centrality (0.133) - this node is a cross-community bridge._
- **Why does `S02 — El modelo sigue siendo de una cuenta interna` connect `Aislamiento por alumno (S02, S05, S09)` to `Backend seguro y rate limit`?**
  _High betweenness centrality (0.125) - this node is a cross-community bridge._
- **What connects `windows`, `name`, `private` to the rest of the system?**
  _111 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Vistas y componentes del panel` be split into smaller, more focused modules?**
  _Cohesion score 0.09000452284034374 - nodes in this community are weakly interconnected._
- **Should `Backend seguro y rate limit` be split into smaller, more focused modules?**
  _Cohesion score 0.09480519480519481 - nodes in this community are weakly interconnected._
- **Should `Aislamiento por alumno (S02, S05, S09)` be split into smaller, more focused modules?**
  _Cohesion score 0.061224489795918366 - nodes in this community are weakly interconnected._