# Backend seguro y rate limit

> 56 nodes · cohesion 0.09

## Key Concepts

- **server.mjs** (56 connections) — `server.mjs`
- **atender()** (17 connections) — `server.mjs`
- **construirAnalisis()** (16 connections) — `server.mjs`
- **HttpError** (15 connections) — `backend/security.mjs`
- **security.mjs** (10 connections) — `backend/security.mjs`
- **plan()** (9 connections) — `server.mjs`
- **aPieza()** (8 connections) — `server.mjs`
- **redondear()** (8 connections) — `server.mjs`
- **seguridad.test.mjs** (7 connections) — `pruebas/seguridad.test.mjs`
- **aNumero()** (7 connections) — `server.mjs`
- **json()** (6 connections) — `backend/security.mjs`
- **rateLimit()** (6 connections) — `backend/security.mjs`
- **readBody()** (6 connections) — `backend/security.mjs`
- **textField()** (6 connections) — `backend/security.mjs`
- **uuid()** (6 connections) — `backend/security.mjs`
- **construirCompetencia()** (6 connections) — `server.mjs`
- **aPorcentaje()** (5 connections) — `server.mjs`
- **construirAnuncios()** (5 connections) — `server.mjs`
- **construirMesa()** (5 connections) — `server.mjs`
- **salud()** (5 connections) — `server.mjs`
- **spearman()** (5 connections) — `server.mjs`
- **traer()** (5 connections) — `server.mjs`
- **reportError()** (4 connections) — `backend/security.mjs`
- **betainc()** (4 connections) — `server.mjs`
- **catalogo()** (4 connections) — `server.mjs`
- *... and 31 more nodes in this community*

## Relationships

- [Conexion Instagram e ingesta (S03, S04, S06, S07)](Conexion_Instagram_e_ingesta_S03,_S04,_S06,_S07.md) (3 shared connections)
- [Aislamiento por alumno (S02, S05, S09)](Aislamiento_por_alumno_S02,_S05,_S09.md) (1 shared connections)
- [Base reproducible y contrato de datos](Base_reproducible_y_contrato_de_datos.md) (1 shared connections)

## Source Files

- `api/index.mjs`
- `backend/security.mjs`
- `docs-contrato.md`
- `pruebas/seguridad.test.mjs`
- `server.mjs`

## Audit Trail

- EXTRACTED: 148 (98%)
- INFERRED: 3 (2%)
- AMBIGUOUS: 0 (0%)

---

*Part of the graphify knowledge wiki. See [index](index.md) to navigate.*