# Auditoría del dashboard de Leo y propuesta para alumnos

Fecha: 7 de septiembre de 2026. Alcance: código local, build, pruebas existentes, consultas de lectura a Supabase y recorrido del plan Demo de Moka. **Resultado: hay una base útil para el equipo, pero todavía no está lista para abrirse a alumnos ni para desplegarse tal cual.**

Esta entrega propone cambios; no modifica la aplicación, las políticas de producción, cuentas, tokens ni infraestructura. No se creó ni publicó un repositorio remoto.

## 1. Evidencia y límites

| Comprobación | Resultado observado |
|---|---|
| `npm run build` | Correcto: TypeScript y Vite compilan |
| JavaScript de producción | Un archivo principal de 433,95 kB; 124,51 kB gzip |
| CSS de producción | 22,76 kB; 5,17 kB gzip |
| `npm audit --json` del dashboard | 0 vulnerabilidades reportadas por el registro. No demuestra ausencia de vulnerabilidades propias |
| `npm test` | 61 pruebas: 54 pasan, 7 fallan |
| Acceso anónimo a Supabase | 0 filas en 9 recursos consultados: `cuenta`, `pieza`, `pieza_metrica`, `historia`, `audiencia_snapshot`, `v_pieza_ranking`, `v_anuncio`, `cuenta_vigilada`, `usuario` |
| API sin sesión | `/api/analisis` no entrega rankings; responde HTTP 200 con `requiere_login` |
| API con token inválido | No entrega datos; HTTP 200 con detalle del error de PostgREST |
| API con lector de pruebas | 313.672 bytes, aproximadamente 630 ms en una petición local; snapshot principal 2026-08-30 |
| Secretos actuales | Sin coincidencias literales de secretos privados del `.env` en archivos versionados actuales ni en `dist` |
| Historial Git | 379 blobs revisados: sin coincidencias de los secretos privados actuales. La búsqueda heurística produjo candidatos en URLs firmadas, locks y binarios; no confirmó un token antiguo expuesto |
| GitHub | Git local existente, sin remoto configurado. Hay 21 archivos de `data/` ya versionados |
| Moka | Sesión existente de Chrome, plan Demo, sin Instagram conectado; dashboard, Reels y onboarding inspeccionados. Ventas y Mesa bloqueados por plan |

No se ejecutaron escrituras, pruebas de carga ni ataques contra Moka. El frontend local abrió en login; la revisión interna de sus vistas se hizo sobre código y datos de la API, sin un recorrido visual autenticado. No se inspeccionó el catálogo SQL de producción con privilegios administrativos. Falta verificar políticas completas, funciones, grants, Storage, usuarios no autorizados, JWT caducados y aislamiento real entre dos alumnos. No hay dos alumnos provisionados con los que demostrar ese aislamiento.

Logs de la ejecución: `.tmp/auditoria-dashboard-tests.log` y `.tmp/auditoria-dashboard-deps.json`. No contienen credenciales volcadas por esta auditoría.

## 2. Hallazgos que bloquean el lanzamiento

### S01 — La seguridad real no es reproducible desde el repositorio · crítica antes del deploy

`projects/dashboard-contenido/supabase/migrations/0001_esquema_contenido.sql:292` crea políticas `TO anon, authenticated USING (true)` en diez tablas. Las políticas permisivas se combinan con OR: añadir después otra restrictiva no basta si se conserva esta política abierta.

La base viva sí devuelve cero filas al anónimo en la muestra revisada, pero el repo no incluye la migración de `usuario`, la lista blanca, sus funciones ni las políticas que las pruebas describen. Tampoco contiene el DDL de `cuenta_vigilada`, sus triggers y las vistas de anuncios consumidas por el servidor. Además, `0006_ventana_de_analisis.sql:18` deja la recreación de cinco vistas como comentario, sin el SQL ejecutable.

**Consecuencia:** un entorno nuevo no reproducirá el existente; reaplicar la migración inicial podría reintroducir lectura pública donde existan los grants correspondientes. Esto es un riesgo confirmado en el código, no una fuga anónima demostrada en producción.

**Cambio:** extraer y revisar el esquema vivo; completar migraciones, grants y políticas; retirar explícitamente las políticas abiertas; probar una base vacía en staging. Mantener `security_invoker` en todas las vistas expuestas. No ejecutar el migrador actual contra producción como parte de un deploy automático.

**Aceptación:** instalación desde cero, sin pasos manuales, con pruebas negativas para anon, usuario fuera de lista y escritura con lector. Las vistas deben respetar RLS. [Documentación de Supabase](https://supabase.com/docs/guides/database/postgres/row-level-security).

### S02 — El modelo sigue siendo de una cuenta interna · crítica antes de alumnos

`server.mjs:463` separa propios de competidores mediante `not.like.externa:*`; `server.mjs:650` toma `cuentas[0]`. Los agregados se organizan por formato o pilar, y no hay un modelo versionado de pertenencia a un alumno. El selector Dirección/Contenido de `src/App.tsx` cambia presentación; no es un rol de autorización.

**Cambio:** incorporar workspaces y membresías, cuentas de Instagram asignadas a un workspace y autorización por `auth.uid()` más pertenencia. Propagar el aislamiento a métricas, históricos, miniaturas, recomendaciones, competidores, tareas y exportaciones. Usar claves y referencias compuestas cuando sean necesarias para impedir cruces entre tenants. Las vistas y agregados deben conservar contexto de cuenta, especialmente cuando Leo vea varios alumnos.

**Aceptación:** A no puede leer ni modificar datos de B alterando IDs, filtros, rutas de archivos, RPC o llamadas directas a PostgREST. Un JWT legítimo de B representa a B: no sirve como prueba de aislamiento decir que “A usa el token de B”. La prueba correcta utiliza el JWT de A y solicita recursos de B. El acceso de mentor debe ser explícito, acotado y revocable.

### S03 — No existe onboarding OAuth por alumno · alta

Hoy se usa correo/clave de Supabase y un token central de Instagram en `.env`. No se encontró implementación de OAuth de Instagram, callback, token individual cifrado, renovación, desconexión ni autorización de acceso al programa.

**Cambio:** entrada de alumno por invitación, conexión oficial de Instagram y vínculo persistente con el usuario interno. El token de Instagram autoriza lecturas de Meta; no debe aceptarse automáticamente como JWT de Supabase. Si la entrada debe ser literalmente “Continuar con Instagram”, hay que implementar y validar el puente de identidad que crea la sesión propia. La alternativa de menor complejidad es invitación/magic link seguida de “Conectar Instagram”.

El callback debe verificar `state` aleatorio de un uso, caducidad, asociación con la sesión/invitación y redirección permitida. Intercambiar códigos solo en backend; verificar identidad de la cuenta en Meta; rechazar reutilización y conflictos de propiedad. PKCE únicamente si el flujo oficial elegido lo soporta. Nunca pedir la contraseña de Instagram en nuestro formulario.

### S04 — Sin límites propios y con trabajo excesivo por solicitud · alta

`server.mjs:463–487` inicia **19 consultas** por análisis. `traer()` pagina de 1.000 en 1.000 hasta recuperar todo, sin máximo global, deadline propio ni orden estable en varias consultas. El resumen incluye también audiencia, anuncios y competencia aunque no se abran esas pantallas. Un token inválido llega a esta etapa y dispara consultas antes de que PostgREST lo rechace.

`leerCuerpo()` (`server.mjs:955`) acumula todo el body en memoria sin límite explícito de aplicación. Las rutas de competidores carecen de un manejador exterior de excepciones de red. Son problemas de código; no se provocó agotamiento de recursos para demostrarlos.

**Cambio:** validar identidad antes de trabajos costosos, conservar RLS como autorización de datos, límites distribuidos por IP y usuario, cuotas por operación y conexión, body máximo y validación de tipos/longitudes, timeout y manejo central de errores. El limitador en memoria no basta con múltiples instancias. Considerar también llamadas directas a la Data API: limitar solo `/api` no limita PostgREST.

Valores iniciales propuestos, a ajustar con el piloto: 60 lecturas/minuto/usuario; 5 intentos de conexión/10 minutos; una sincronización manual cada 5 minutos/cuenta y un solo trabajo activo por cuenta; bodies de estas operaciones pequeñas hasta 16 KiB. Responder 429 con `Retry-After`. No son cuotas oficiales de Meta.

### S05 — Sesiones y respuestas antiguas pueden mezclarse en el cliente · alta antes de alumnos

`src/hooks/useApi.ts:48` no cancela peticiones al cambiar JWT o ruta, ni borra inmediatamente el estado al cerrar sesión. `App` sigue montado durante login/logout. Una respuesta lenta del usuario anterior puede llegar después de cambiar de identidad y reemplazar el estado; un error de red también conserva `datos` anteriores. Riesgo deducido del flujo; no reproducido con dos usuarios en esta revisión.

**Cambio:** cancelar con `AbortController`, identificar la solicitud vigente, vaciar datos al cambiar usuario/workspace y no consultar sin sesión. Toda caché debe incluir usuario/workspace, cuenta, rango y versión de permisos. Prueba de navegador: A consulta lentamente, sale, B entra y nunca ve A, ni un frame.

### S06 — Errores, métodos y cabeceras no están preparados para Internet · media

`server.mjs:967` usa CORS `*`; rutas devuelven errores internos y comandos de terminal con HTTP 200. `/api/analisis` no restringe método. `/api/salud` es anónima y expone estado operativo del token. No hay configuración de cabeceras de producción. CORS abierto no suplanta un JWT por sí mismo.

**Cambio:** mismo origen por defecto; 401/403 para identidad/permisos, 400/413/429 y 5xx según causa; permitir 200 vacío para “cuenta conectada sin publicaciones”. Preflight y 405 explícitos, errores públicos breves con ID de incidente, logs redactados. Health público mínimo; diagnóstico autenticado. CSP en HTML, `nosniff`, `Referrer-Policy`, protección contra framing y HSTS en producción HTTPS; probar también fuentes e imágenes permitidas. No habilitar caché CDN compartida de respuestas privadas.

### S07 — La ingesta depende del Mac y está fallando · alta

Snapshot de análisis: **30 de agosto**, ocho días antes de la auditoría. `data/instagram/historias-cron.log` repite `Operation not permitted` al abrir `tools/ig_historias.py`. El botón Refrescar solo reconsulta Supabase. La hora mostrada por `useApi` es la hora de lectura, no la última sincronización de Instagram. El token central tiene fecha declarada, pero esa fecha por sí sola no demuestra su vigencia real.

**Cambio:** worker/cola alojados, checkpoints persistentes y estado por fuente. Mostrar “Datos de Instagram actualizados el…” y separar “Volver a cargar” de “Sincronizar”. Registrar última ejecución exitosa, próxima ejecución, fallos consecutivos y motivo de pausa. No depender del filesystem efímero de una función para reanudar tareas.

### S08 — Publicar el workspace completo expone información innecesaria · alta antes de GitHub

`.env` está ignorado y no versionado, pero sí hay 21 archivos de datos con snapshots de Instagram, pauta, reconocimiento de CRM y logs. El workspace contiene además estrategia comercial y otros proyectos. Añadir `data/` a `.gitignore` no quita lo ya guardado en Git.

**Cambio recomendado:** repositorio privado dedicado al producto con un primer commit limpio, copiando únicamente código, migraciones completas, configuración y documentación técnica saneada. Mantener el workspace original intacto. Antes de publicar, revisar el conjunto exacto de archivos y el historial que se enviará. Si se confirma un secreto histórico, rotarlo; la limpieza de Git no lo revoca.

### S09 — Storage público necesita una decisión explícita · media

`0003_miniaturas_en_storage.sql` documenta bucket público. Alojar copias duraderas resuelve la caducidad de URLs de Instagram, pero quien posea una URL pública puede conservar acceso tras logout o desconexión. No se verificó la configuración viva del bucket.

**Cambio:** bucket privado con políticas por workspace y URLs firmadas de corta duración para contenidos de alumnos. Revisar retención, borrado y caché; prefijos por tenant no sustituyen permisos. Si se publican thumbnails deliberadamente, limitarlo a material explícitamente público y documentar esa decisión.

## 3. Experiencia que debería recibir el alumno

**Promesa propuesta:** “Conecta tu Instagram, entiende qué contenido te ayuda a crecer y decide qué publicar esta semana”. El valor debe cerrar el recorrido entre observar, decidir y ejecutar.

| Momento | Propuesta concreta |
|---|---|
| Acceso | Invitación al programa; una cuenta interna y un workspace propio. Estado claro si la membresía terminó |
| Conectar | Explicar Business/Creator, permisos de lectura y cuenta seleccionada. Soportar cancelar, rechazar permisos y reconectar |
| Primera carga | Progreso por etapas: conexión, publicaciones, métricas. Mostrar datos parciales válidos y reintentar solo lo pendiente |
| Inicio | 3–4 métricas relevantes, rango 7/30/90 días, comparación equivalente, última sincronización y una recomendación principal |
| Contenido | Todas las publicaciones, búsqueda y filtros persistentes. Separar catálogo completo de ranking con muestra suficiente |
| Detalle de una pieza | Métricas, tendencia disponible, fecha de medición, comparación por formato, notas de hook/guion/visual/CTA |
| Plan semanal | Guardar una idea, asignarle estado y fecha, vincular después la publicación y revisar resultado |
| Mentoría | Leo accede solo a alumnos asignados, con autorización y registro; el estudiante entiende quién ve sus datos |
| Ajustes | Cuenta conectada, permisos, estado de sincronización, desconectar, exportar y solicitar borrado |

Navegación inicial sugerida: **Inicio · Contenido · Historias · Audiencia · Mi plan**. Conexión en Ajustes; selector de alumnos solo para mentor autorizado. Integrar Palabra clave como filtro/análisis contextual de contenido. Ads, CRM, automatizaciones de DM e IA generativa quedan como ampliaciones, no requisitos del MVP de insights.

La Mesa actual ya explica por qué recomienda repetir una pieza, pero no permite convertirla en tarea, guardar notas ni cerrar el ciclo. Esta es una oportunidad de diferenciación educativa: relacionar cada acción con una lección de Leo y registrar si el alumno la ejecutó.

### Correcciones de uso y calidad de datos

1. **“Publicado en 30 días” cuenta solo piezas sólidas** (`Resumen.tsx:24–53`). Una publicación bajo 500 de alcance desaparece del KPI. Contar desde el catálogo, y aplicar el piso solamente a comparaciones estadísticas.
2. **No esconder todo el contenido de cuentas pequeñas.** `Piezas.tsx` usa exclusivamente `rankings.todas`. Mostrar piezas con poca muestra con una etiqueta; mantenerlas fuera del ranking robusto. Conservar el umbral actual hasta validar otro criterio; no bajarlo solo para obtener resultados.
3. **Periodo de publicación ≠ periodo de medición.** El filtro de 30/90 días selecciona publicaciones por fecha, mientras muchas métricas son acumuladas al snapshot. Rotular ambas fechas; obtener series de cuenta para métricas de periodo. No llamar “alcance de este mes” a la suma de alcance lifetime de posts publicados este mes.
4. **Alcance sumado no es audiencia única.** Puede contar a la misma persona varias veces. Explicarlo y usar alcance de cuenta cuando corresponda. `reduce(...) || null` convierte un total cero en nulo: distinguir muestra vacía de cero real.
5. **Rangos sí existen en Piezas.** `FilterBar.tsx` ya tiene 30/90/365 días, conteos y explicación de chips deshabilitados. El documento comparativo anterior quedó desactualizado. Faltan fechas consistentes en el resumen y URLs que conserven navegación/filtros.
6. **Reducir texto técnico inicial.** Mover correlaciones, archivos Python, detalles SQL y explicaciones extensas a “Cómo se calcula” o diagnóstico de administrador. Un alumno necesita acciones como Reconectar/Reintentar, no comandos.
7. **Accesibilidad pendiente de validación visual.** Hay foco visible y reduced-motion en CSS; los selects Pilar/Orden usan `span` sin asociación de label. Revisar etiquetas, lector de pantalla y navegación por teclado. En móvil hay nueve opciones horizontales y calendario mínimo de 700 px: proponer vista agenda y navegación reducida. No se midió contraste ni comportamiento móvil autenticado.

## 4. Qué confirmó el recorrido de Moka

| Pantalla revisada hoy | Observación | Aplicación a Prime |
|---|---|---|
| [Dashboard](https://app.usemoka.io/) | Resumen de 30 días, calendario, metas, facturación y efectivo recolectado; sin datos conectados muestra varios ceros | Jerarquía simple, periodos y metas; distinguir no conectado, no disponible y cero real |
| [Reels](https://app.usemoka.io/instagram?tab=reels) | 90 días, orden, Reel/Trial, orgánico/pagado, CTA de conexión | Adoptar filtros solo donde existan datos válidos para sostenerlos |
| [Onboarding](https://app.usemoka.io/onboarding) | Declara OAuth de Meta y lectura de Instagram, páginas y Meta Ads | Explicar permisos y valor; nuestro MVP de Instagram Login tiene un alcance diferente |
| [Ventas](https://app.usemoka.io/ventas) y [Mesa](https://app.usemoka.io/mesa-de-trabajo) | Bloqueadas por plan | No fue posible verificar su funcionamiento ni atribución |

No se conectaron cuentas ni se sortearon bloqueos. No hay base para afirmar que la facturación de Moka sea necesariamente manual, que no tenga CRM o cómo funciona su backend. La conclusión previa basada en ausencia de integraciones visibles era demasiado fuerte. Tampoco se verificaron diagnósticos IA con datos reales.

La referencia visual útil es la jerarquía clara y la separación de tareas. Prime puede conservar su marca y diferenciarse con recomendaciones educativas, metodología transparente y seguimiento semanal.

## 5. Integración de Instagram y rate limits

**Documento recibido de Iann:** [Instagram Platform](INSTAGRAM-PLATFORM-FUENTE.md). Confirma la separación entre Instagram Login y Facebook Login. Es un overview y no enumera los permisos de Insights; para esos permisos se mantiene la referencia específica verificada abajo. La capacidad de obtener métricas básicas de otras cuentas se describe bajo Facebook Login: la sección Competencia actual no debe darse por compatible automáticamente con el onboarding de Instagram Login. Sharing to Stories/Feed y Embedding tampoco sustituyen la API de Insights. Que un producto admita mensajes o publicación no significa que debamos solicitar esos permisos para este MVP de lectura.

La documentación oficial abierta en Chrome confirmó cuentas Business/Creator y que Instagram Login no requiere página de Facebook. Para Insights, el endpoint documenta **`instagram_business_basic` y `instagram_business_manage_insights`**. Para atender cuentas de terceros hace falta Advanced Access; Meta describe App Review y verificación del negocio. No hay garantía de plazo de aprobación. [Instagram Login](https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-instagram-login), [Insights](https://developers.facebook.com/documentation/instagram-platform/insights), [Overview](https://developers.facebook.com/documentation/instagram-platform/overview).

No prometer “todos los insights” sin matices: hay métricas sujetas a tipo de medio, permisos, tamaño de cuenta y disponibilidad histórica. Meta documenta restricciones bajo 100 seguidores, retención de métricas de usuario hasta 90 días y `story_insights` por webhook solo para Facebook Login. El histórico debe construirse desde la conexión; un cambio de login no recupera automáticamente historias perdidas. Ads requiere su integración propia. [Limitaciones de Insights](https://developers.facebook.com/documentation/instagram-platform/insights).

El overview documenta para endpoints aplicables `4800 × impresiones` en una ventana de 24 horas, con excepciones para otros casos de uso. **10 impresiones dan 48.000 llamadas, no 48:** corregir el cálculo del plan anterior. Esa fórmula no sustituye observar respuestas, cabeceras de uso y restricciones específicas del endpoint. [Rate limiting de Meta](https://developers.facebook.com/documentation/instagram-platform/overview).

Propuesta de sincronización:

- OAuth crea una conexión y encola un trabajo; el callback no extrae todo el histórico.
- Sincronización incremental con cursor y ventanas de fecha. Revisitar publicaciones recientes porque sus métricas siguen creciendo; “solo posts nuevos” deja insights congelados.
- Lotes acotados, por ejemplo 50 piezas por trabajo, checkpoint persistente, deduplicación y lock por conexión. Tamaño ajustable tras medir costo y duración reales.
- Presupuesto de llamadas por app/cuenta, concurrencia limitada y lectura de cabeceras de uso. Respetar `Retry-After`, backoff exponencial con jitter y máximo de reintentos. Separar permisos/expiración de errores transitorios.
- Guardar estados parciales y métricas faltantes como nulos con razón. No perder trabajo exitoso por un fallo de un endpoint.
- Tokens de larga duración: guardar expiración recibida y renovar antes del vencimiento; cifrado con acceso exclusivo del worker/backend, llave separada y control de privilegios. Nunca exponer token, código OAuth ni secreto de app en frontend, logs o URLs propias.
- Desautorización y borrado verifican las firmas que correspondan a cada callback; no todos usan el mismo formato. Para webhooks que lo especifiquen, verificar `X-Hub-Signature-256` sobre el body crudo; para `signed_request`, validar ese formato. Cancelar trabajos, revocar conexión y aplicar política de retención de datos y backups.

## 6. Chunks, consultas y rendimiento

La app ya renderiza tarjetas en tandas de 48 y usa imágenes lazy. Eso reduce trabajo del DOM, **pero no reduce el JSON descargado ni las consultas de Supabase**. El build importa las nueve vistas directamente; no hay carga diferida por sección.

Cambios por orden de impacto:

1. Endpoints por pantalla con selección mínima y agregados SQL. El inicio no necesita anuncios ni todo el histórico de métricas.
2. Paginación de publicaciones en backend, orden estable con desempate por ID y rango máximo; no recuperar tablas completas para paginar visualmente.
3. Caché privada correctamente aislada e invalidada tras sincronizar. Nunca cachear por una clave global como `analisis`.
4. `React.lazy`/`Suspense` para las vistas secundarias. Separar vendor solo si las mediciones lo justifican; muchos chunks minúsculos también tienen costo.
5. Límite y deadline por trabajo de ingesta, además de paginación HTTP y code splitting: son tres problemas distintos.

Objetivos iniciales propuestos para el piloto: JavaScript inicial gzip bajo 100 kB si el split lo permite; resumen JSON bajo 50 kB; contenido paginado de 24–48 piezas; LCP móvil p75 bajo 2,5 s e INP bajo 200 ms. Son metas de diseño, no mediciones actuales. La petición local de 630 ms no representa latencia p95 ni experiencia en Vercel.

## 7. Pruebas y confianza en las métricas

Las siete fallas actuales son aserciones numéricas contra datos vivos: esperan 176 piezas en ventana / 168 aptas / 112 reels aptos y hoy devuelven 174 / 166 / 110. El total histórico sigue en 302. Una publicación del 1 de septiembre de 2025 ya aparece fuera de ventana, mientras la del 7 sigue dentro: el resultado es consistente con el desplazamiento temporal, pero no se reconstruyó el DDL vivo para atribuir exhaustivamente cada diferencia.

No se cambiaron expectativas ni tolerancias para hacer pasar la suite. Separar:

- Pruebas deterministas de transformaciones y ventanas con reloj fijo y fixtures sin datos personales.
- Pruebas de integración de esquema, permisos y contratos en staging.
- Monitoreo de producción: frescura, conteos y anomalías con fecha de referencia; no congelar para siempre un conteo de ventana móvil.
- Seguridad: dos alumnos, usuario sin membresía, mentor acotado, JWT inválido/caducado, cambios de sesión, acceso directo a DB/Storage, OAuth replay/state, reintentos idempotentes, borrado y 429.

Conservar reglas valiosas: mediana por formato, piso de muestra declarado, nulos distintos de ceros y trazabilidad de snapshots/fuentes.

## 8. GitHub, Supabase y Vercel: orden de implementación

| Fase | Entrega | Puerta de salida |
|---|---|---|
| 0 — Base reproducible | Repo privado dedicado, inventario de datos excluidos, migraciones completas, staging separado | Clon limpio instala, compila y recrea esquema seguro |
| 1 — Aislamiento | Workspace, membresías, RLS, Storage privado y roles reales | Dos alumnos no se cruzan por UI, API ni acceso directo |
| 2 — Conexión | App Meta, scopes correctos, OAuth, cifrado, renovar/revocar/borrar | Cuenta de prueba conecta, desconecta y reconecta sin filtrar secretos |
| 3 — Ingesta alojada | Cola/worker, presupuesto, checkpoints y observabilidad | Métricas se actualizan sin el Mac y sin duplicados |
| 4 — Producto alumno | Inicio, catálogo completo, filtros, estados y plan semanal | Piloto de 5–10 alumnos con un recorrido de activación observable |
| 5 — Producción | Funciones HTTP, frontend Vite, cabeceras, entornos, pruebas y rollback | App Review/Advanced Access cuando corresponda y puertas de seguridad aprobadas |

La preparación de Meta y la verificación de negocio pueden avanzar en paralelo; no hay razón técnica para prohibir construir el esquema o prototipo mientras tanto.

Configuración prevista de Vercel: si se conserva la estructura de carpetas, Root Directory `projects/dashboard-contenido`, build `npm run build`, salida `dist`. En un repo dedicado con la app en raíz, Root Directory será la raíz. El `package.json` del workspace superior no es la app.

El proxy de `vite.config.ts` solo resuelve `/api` durante desarrollo. Para producción, adaptar el handler HTTP a Vercel Functions y separar el arranque local `listen`; no basta con subir `dist`. No es obligatorio migrar a Next.js ni reescribir todos los cálculos. [Vite en Vercel](https://vercel.com/docs/frameworks/frontend/vite).

Vercel sí tiene runtime Python: la afirmación del plan previo de que Python “no corre” allí es incorrecta. Los scripts actuales, como jobs locales con checkpoints en disco, requieren adaptación; un worker con cola es preferible para ingestas largas y recuperables. Revisar duración, región y bundles del plan elegido. [Runtimes de Vercel](https://vercel.com/docs/functions/runtimes), [Python](https://vercel.com/docs/functions/runtimes/python).

Variables públicas permitidas: URL y clave publishable/anon de Supabase. Son visibles por diseño; las protecciones son grants/RLS. **Jamás** usar prefijo `VITE_` para service role, secretos de Meta, tokens de Instagram o cifrado. Restringir variables de Preview/Production y evitar que previews usen los datos reales de alumnos. [Claves de Supabase](https://supabase.com/docs/guides/getting-started/api-keys).

GitHub no es un requisito técnico absoluto para desplegar Vercel, pero su integración facilita revisión, CI y rollback. Antes del lanzamiento deben estar disponibles privacidad, términos, soporte y procedimientos de eliminación coherentes con el tratamiento real. Definir responsable, retención y destinatarios; no copiar textos de otro SaaS sin adaptar el producto.

## 9. Decisiones propuestas para validar con Leo

MVP de insights orgánicos y plan semanal, una cuenta profesional por alumno, acceso por invitación, vistas de mentor por asignación y datos privados por defecto. Mantener Ads del equipo fuera del alcance de alumnos en backend, no solo oculto en navegación. Posponer mensajes y atribución comercial hasta contar con integración y definición verificable.

Faltan decisiones de producto para implementar: cantidad de alumnos esperada, quién invita y revoca membresías, si el mentor ve a todos o solo asignados, si la entrada inicial debe ser exclusivamente Instagram y cuál entidad operará la app Meta. Estas decisiones no impiden cerrar los defectos ya documentados.
