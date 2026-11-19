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

## Revisión del 19/11/2026

Con las Fases 0 a 3 cerradas en tres días, se revisó el calendario y la Fase 4 antes de empezarla:

- **El ritmo lo marca la persona, no el código.** Hubo días con cinco PRs de backend; lo que se demora es validar, verificar en `staging` y activar la facturación. Producción pasa al viernes 27/11 (día 10 de la propuesta original); el ejercicio completo, al 4/12, porque la Fase 8 necesita unos días de tráfico real.
- **Una suite sobre 25 libros no mide nada.** La búsqueda toma 40 candidatos, más que el inventario de `staging`: Recall@k daría 100 % por construcción. La carga de sinopsis de producción se adelantó y la copia congelada sale de ahí.
- **Las etiquetas no pueden salir solo del recuperador.** Si los candidatos a «libro aceptable» vienen del mismo recuperador que se evalúa, un libro que no encuentra nunca cuenta como fallo. Los candidatos salen de dos fuentes y el usuario puede agregar otros.
- **Las versiones viejas no se reproducen con el código nuevo.** v1 a v3 se escribieron para un código que ya cambió (fecha y políticas en el contexto; la herramienta `consultar_politicas` ya no existe). La línea base es v5, comparada con v4; v1 a v3 quedan para la comparación de políticas (4c), con esa advertencia.
- La Fase 4 se partió en 4a y 4b (antes de producción) y 4c (después de las Fases 6 y 7). Producción sale con criterios manuales; la compuerta automática llega en 4c.

## Recorrido del calendario

Acordado el 19/11/2026: al cerrar cada fase, aunque sea parcial (4a, 4b…), se recalcula el calendario y se anota aquí con las fechas reales. Así el recorrido queda documentado con precisión y no reconstruido de memoria al final. Los «minutos de agente» salen de `tracking-detail.csv` (ventana de trabajo del agente en cada tarea; **no incluyen** el tiempo que la persona tarda en validar, verificar o decidir, que es lo que más pesa en el calendario).

**Propuesta original de dos semanas (fuera de git, 16/11):** día 1 datos · 2 índice y asistente mínimo · 3 herramientas · 4 suite de evaluación · 5 iteración de prompts · 6 chat · 7 registro y tablero · 8 seguridad · 9 Azure · 10 empaque y producción.

### Cierre de `T-0041` (Fase 4a) — jueves 19/11/2026, 12:08

| Hito | Día de la propuesta | Fecha real | Observación |
|---|---|---|---|
| Fase 0, documentación | previo | lun 16/11 | PR #151 |
| Fase 1, datos | 1 (lun 16) | 16 y 17/11 | `T-0011` a `T-0014`; 4 PRs porque no cabía en uno |
| Fase 2, índice y asistente mínimo | 2 (mar 17) | 17 y 18/11 | `T-0021` a `T-0024`; `T-0023` (#160) fusionado el 18/11; la migración a la Interactions API (`T-0024`) no estaba prevista |
| Fase 3, herramientas | 3 (mié 18) | mié 18/11 | PR #161 fusionado a las 21:21; tres correcciones del prompt tras pruebas en `staging` (v3, v4, v5) |
| Carga de sinopsis en producción | día 1 (se adelantó) | jue 19/11, 10:57 a 11:55 | 2.541 libros, 2.201 con sinopsis útil; la hizo el usuario |
| Fase 4a, base de la suite | 4 (jue 19) | jue 19/11, 11:57 a 12:08 de trabajo del agente | Código, 46 casos y bitácora listos; **faltan** la clave local de Gemini, el índice local y tu validación de candidatos |

Minutos de agente registrados por día: lun 16 → 22 · mar 17 → 57 · mié 18 → 134 · jue 19 (hasta 4a) → 23. **Lectura:** el ritmo real coincide con el de la propuesta original (4a cae el día 4 como estaba previsto); lo que cambió fue el orden y el tamaño de las fases, no los días.

**Calendario recalculado** (el usuario no trabaja el fin de semana del 21 y 22/11):

| Fecha | Trabajo | Depende del usuario |
|---|---|---|
| Jue 19/11 (tarde) | Pasa el 4a a `staging`; si el usuario pone la clave local, índice y candidatos | Clave local en `.env`; leer los límites de cuota en AI Studio |
| Vie 20/11 | Validar candidatos; 4b: ejecutor (se escribe sin la validación) y corrida de v4 y v5 | Validar los candidatos (1 a 2 horas) |
| Lun 23/11 | Si falta, la corrida de 4b; Fase 5 solo si 4b falla los criterios; Fase 6, parte 1 | Facturación prepagada con tope y clave de producción |
| Mar 24/11 | Fase 6, parte 2 | Verificar en `staging` |
| Mié 25/11 | Fase 7: chat en `staging` | Revisarlo |
| Jue 26/11 | Holgura / producción si 4b pasó a la primera | Fusionar y verificar |
| **Vie 27/11** | **Producción** | |
| Lun 30/11 – vie 4/12 | 4c, Fases 8, 9 y 10 | Azure, 20 respuestas, video |

**Cambio respecto al calendario del 19/11 por la mañana:** ninguna fecha de producción se mueve (sigue el 27/11, con un día de holgura el 26). El viernes 20 queda como el día que decide si hay holgura: si la validación llega ese día y 4b pasa los criterios a la primera, la Fase 6 empieza el lunes sin esperar y producción puede adelantarse al jueves 26/11.

