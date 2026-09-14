# Conexion Instagram e ingesta (S03, S04, S06, S07)

> 15 nodes · cohesion 0.14

## Key Concepts

- **S04 — Sin límites propios y con trabajo excesivo por solicitud** (5 connections) — `AUDITORIA.md`
- **S06 — Errores, métodos y cabeceras no están preparados para Internet** (4 connections) — `AUDITORIA.md`
- **S07 — La ingesta depende del Mac y está fallando** (4 connections) — `AUDITORIA.md`
- **Sincronización incremental con cursor y checkpoints** (4 connections) — `AUDITORIA.md`
- **El backend responde 200 con campo error, nunca 404** (4 connections) — `README.md`
- **Fase 3 — Ingesta alojada** (2 connections) — `AUDITORIA.md`
- **Fase 5 — Producción** (2 connections) — `AUDITORIA.md`
- **Instagram Login y permisos de Insights** (2 connections) — `AUDITORIA.md`
- **Rate limiting de Meta (4800 × impresiones)** (2 connections) — `AUDITORIA.md`
- **Chunks, consultas y rendimiento** (2 connections) — `AUDITORIA.md`
- **S03 — No existe onboarding OAuth por alumno** (2 connections) — `AUDITORIA.md`
- **Historias: correr a diario o no hay historia** (2 connections) — `README.md`
- **Fase 2 — Conexión** (1 connections) — `AUDITORIA.md`
- **Regla — 200 con campo error, nunca 404** (1 connections) — `docs-contrato.md`
- **Token de Meta muerto y permisos requeridos** (1 connections) — `README.md`

## Relationships

- [Aislamiento por alumno (S02, S05, S09)](Aislamiento_por_alumno_S02,_S05,_S09.md) (4 shared connections)
- [Backend seguro y rate limit](Backend_seguro_y_rate_limit.md) (3 shared connections)
- [Base reproducible y contrato de datos](Base_reproducible_y_contrato_de_datos.md) (1 shared connections)

## Source Files

- `AUDITORIA.md`
- `README.md`
- `docs-contrato.md`

## Audit Trail

- EXTRACTED: 8 (35%)
- INFERRED: 15 (65%)
- AMBIGUOUS: 0 (0%)

---

*Part of the graphify knowledge wiki. See [index](index.md) to navigate.*