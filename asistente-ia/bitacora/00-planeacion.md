# 00 — Planeación y alcance

**Fecha:** 16/11/2026 · **Fase:** 0 · **trace_id:** `T-0000` · **PR:** rama `docs/plan-asistente-ia`

## 1. Objetivo

Definir el alcance del asistente **antes de escribir código**: ficha de caso de uso, riesgos, arquitectura, fases con criterios de terminado y la forma de medir tanto el producto (suite, registro) como el proceso (esfuerzo humano vs. agente).

**Criterio de terminado:** ficha de caso de uso y ficha de riesgos escritas; plan aprobado por el usuario; ADRs registrados; motor JIT con las 2 primeras tareas; registro de esfuerzo funcionando.

## 2. Conceptos y tecnologías

### Definir el caso de uso antes del prototipo

Una ficha de caso de uso fija el problema, los usuarios, los datos, los indicadores de éxito, los riesgos y el escalamiento a una persona antes de construir. Sirve como contrato: si después el alcance cambia, el cambio queda registrado con su motivo, en lugar de ir apareciendo en el código. Aquí la ficha se escribió y se versionó en git antes de cualquier línea de implementación. La fecha del commit es la prueba.

### Por qué RAG y no reentrenar un modelo

El conocimiento que necesita el asistente (qué libros hay, en qué estante, a qué precio) **cambia todos los días** con cada venta y cada libro catalogado. Reentrenar o ajustar un modelo con ese inventario lo dejaría desactualizado al día siguiente y aun así podría inventar. Con RAG, el modelo no "sabe" el inventario: lo consulta en cada pregunta, y la respuesta se valida contra la fuente de verdad.

### Por qué no una base vectorial administrada

Las bases vectoriales (OpenSearch, Pinecone, pgvector, etc.) resuelven búsquedas sobre millones de vectores. Con unos 3.000 libros, comparar la consulta contra todos los vectores en memoria toma milisegundos, y el índice completo cabe en un archivo de pocos MB. Una base administrada añadiría costo fijo y otra pieza que operar, sin ninguna ganancia medible a esta escala. Babel tiene como objetivo un costo de infraestructura de $0 (`tech-specs.md` §7.3).

### Por qué el modelo no es la fuente de verdad

Un LLM puede producir un título plausible que no existe. Por eso el diseño tiene tres capas: herramientas que solo devuelven datos reales del inventario, un validador en código que descarta cualquier `bookId` inexistente o agotado, y una interfaz que pinta las tarjetas con datos de Babel y no con el texto del modelo. La métrica "libros inventados antes del validador" sigue midiendo cuánto alucina el modelo, aunque el visitante nunca vea esas alucinaciones.

## 3. Decisiones

| Decisión | ADR |
|---|---|
| RAG híbrido con índice de embeddings en un archivo en S3, sin base vectorial | ADR-013 |
| Herramientas de solo lectura, lista blanca de campos y validador determinista | ADR-014 |
| Gemini en un proyecto de AI Studio propio (gratuito para desarrollo, pago con tope en producción) detrás de `ProveedorLlm` | ADR-015 |
| Subproyecto con documentación y registro de esfuerzo propios en `asistente-ia/` | ADR-016 |
| Suite de evaluación propia con inventario congelado y compuerta de regresión | ADR-017 |

## 4. Qué se hizo

1. Se leyó la propuesta original de preparación y se cruzó cada capacidad con lo que ya existe en Babel y en el proyecto `flujo-n8n` (que ya usa Gemini y tiene un set dorado con evaluación por reglas).
2. Se verificó el punto de partida en el código y con consultas reales (ver [`../PLAN.md`](../PLAN.md) §1). Hallazgo principal: `api.letiende.co` ya devuelve la sinopsis y otros campos de Google Books que Babel descartaba. La Fase 1 se reduce a leerlos, completar con los sitios de librerías y medir la cobertura.
3. Se propuso un plan de 11 fases (0 a 10). El orden prioriza lo que llega al visitante antes de Navidad. El usuario lo aprobó junto con las 4 decisiones recomendadas.
4. Se escribieron el README, el plan, las fichas, esta bitácora y la ruta de estudio, y se actualizaron los documentos de Babel (`PRD.md`, `tech-specs.md`, `MEMORY.md`, `TODO.md`, `CLAUDE.md`).
5. Se inicializó `ai-effort-tracking`: configuración en `metrics/`, hooks en `.claude/settings.json` (del repositorio, para que también funcionen en sesiones en la nube), eventos en `asistente-ia/metrics/events/`.

## 5. Cifras medidas

| Cifra | Valor | Cómo |
|---|---|---|
| ISBN de prueba con sinopsis en `api.letiende.co` | 1 de 3 | Consulta manual, 16/11/2026. Muestra mínima, no representativa: la cobertura real se mide en la Fase 1 |
| Tamaño previsto del índice | ≈ 9 MB (float32) / ≈ 2,3 MB (int8) | 3.000 vectores × 768 dimensiones × 4 o 1 bytes |

## 6. Qué falló y cómo se corrigió

- La primera consulta de prueba a `api.letiende.co` usó una ruta equivocada (`/books/isbn/...`) y devolvió `Missing Authentication Token`. La ruta real es `/libros?barcode=<isbn>` (`server/api/services/api-letiende.ts:100`). Lección: verificar en el código cómo se llama un servicio antes de probarlo a mano.
- La propuesta original asumía 10 días hábiles. El plan se ajustó a 9 o 10 sesiones según el trabajo real, y se reordenó para que el chat llegue a producción antes de Navidad.

## 7. Esfuerzo

Ver el evento `workspace_setup` / `specs_definition` de esta fecha en [`../metrics/events/`](../metrics/events/) y la fila correspondiente en `../../tracking-detail.csv`.

## 8. Fuentes

- Código de Babel: `server/api/services/api-letiende.ts`, `src/app/core/models/libro.model.ts`, `docs/MEMORY.md` (ADR-008, ADR-010, ADR-011, ADR-012).
- `flujo-n8n`: `scripts/eval-gemini.mjs`, `golden-set/README.md`, `docs/MEMORY.md` (ADR-013 de ese proyecto, cuotas del nivel gratuito de Gemini).
- OWASP Top 10 for LLM Applications 2025 (marco de la ficha de riesgos). Se verificará contra la fuente oficial en la Fase 6.
