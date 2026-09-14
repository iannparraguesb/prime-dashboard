# Base reproducible y contrato de datos

> 21 nodes · cohesion 0.11

## Key Concepts

- **GET /api/analisis** (7 connections) — `docs-contrato.md`
- **Vista v_pieza_ranking** (6 connections) — `docs-contrato.md`
- **Job CI «verificar»** (3 connections) — `.github/workflows/ci.yml`
- **Fase 0 — Base reproducible** (3 connections) — `AUDITORIA.md`
- **Pruebas contra datos vivos y confianza en las métricas** (3 connections) — `AUDITORIA.md`
- **S01 — La seguridad real no es reproducible desde el repositorio** (3 connections) — `AUDITORIA.md`
- **Vista v_base_formato** (3 connections) — `docs-contrato.md`
- **Decisión 6 — Un dato que la API no devolvió NO es cero** (3 connections) — `README.md`
- **Decisión 5 — Piso de 500 de alcance para entrar al ranking** (3 connections) — `README.md`
- **Publicación segura del repositorio y variables de Vercel** (3 connections) — `README.md`
- **S08 — Publicar el workspace completo expone información innecesaria** (2 connections) — `AUDITORIA.md`
- **Conversión ×100 de fracción a porcentaje** (2 connections) — `docs-contrato.md`
- **Decisión 3 — Mediana, nunca promedio** (2 connections) — `README.md`
- **Decisión 4 — Multiplicador contra la mediana del mismo formato** (2 connections) — `README.md`
- **El snapshot crudo no lleva tasas calculadas** (2 connections) — `README.md`
- **Alcance sumado no es audiencia única** (1 connections) — `AUDITORIA.md`
- **Periodo de publicación ≠ periodo de medición** (1 connections) — `AUDITORIA.md`
- **Regla — null se propaga como null** (1 connections) — `docs-contrato.md`
- **Números ancla del contrato** (1 connections) — `docs-contrato.md`
- **Vista v_efecto_palabra_clave** (1 connections) — `docs-contrato.md`
- **Vista v_pilar_rendimiento** (1 connections) — `docs-contrato.md`

## Relationships

- [Aislamiento por alumno (S02, S05, S09)](Aislamiento_por_alumno_S02,_S05,_S09.md) (2 shared connections)
- [Esquema base de Supabase](Esquema_base_de_Supabase.md) (1 shared connections)
- [Backend seguro y rate limit](Backend_seguro_y_rate_limit.md) (1 shared connections)
- [Conexion Instagram e ingesta (S03, S04, S06, S07)](Conexion_Instagram_e_ingesta_S03,_S04,_S06,_S07.md) (1 shared connections)

## Source Files

- `.github/workflows/ci.yml`
- `AUDITORIA.md`
- `README.md`
- `docs-contrato.md`

## Audit Trail

- EXTRACTED: 8 (28%)
- INFERRED: 21 (72%)
- AMBIGUOUS: 0 (0%)

---

*Part of the graphify knowledge wiki. See [index](index.md) to navigate.*