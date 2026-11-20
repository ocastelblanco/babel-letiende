# Plan — Asistente de Babel

**Aprobado por el usuario:** 16/11/2026 (las 4 decisiones de §2, tal como se recomendaron).
**Meta de calendario (revisada el 19/11/2026):** chat en producción el **viernes 27/11/2026** (día 10 de la propuesta original de dos semanas que empezó el 16/11); ejercicio completo, Fases 4c y 8 a 10 incluidas, el **viernes 4/12/2026**. Meta original: producción la semana del 30/11. Detalle y supuestos en §3.1.
**Duración estimada:** 9 a 10 sesiones de trabajo. Ritmo real: Fases 0 a 3 en tres días (16 a 18/11).

Reglas de ejecución (heredadas de Babel, `CLAUDE.md` §6 y memoria del proyecto):

- **Una fase = una rama = un PR**, en secuencia. El staging es compartido: nunca se abre ni se pushea el PR siguiente antes de que el anterior termine todo su despliegue.
- El usuario fusiona y verifica en `staging`. Producción solo con la suite en verde.
- Toda tabla nueva de DynamoDB se declara `PAY_PER_REQUEST` explícitamente (incidente de agosto de 2026).
- Todo módulo nuevo del backend se agrega al `package.patterns` de **cada** función que lo importe (gotcha de `CLAUDE.md` §7).
- Antes de usar cualquier API de modelo (Gemini, Azure) se consulta su documentación oficial vigente: nombres de modelo, formato del llamado de herramientas, límites y precios. Nada de memoria.
- Al cerrar cada fase: entrada de bitácora, fila en `tracking-detail.csv`, evento de `ai-effort-tracking`, `MEMORY.md` §2 y siguiente tarea en `TODO.md`.

---

## 1. Hechos verificados al planear (16/11/2026)

| Hecho | Cómo se verificó |
|---|---|
| Babel no guarda sinopsis, categorías, idioma ni páginas | `MetadatosLibro` en `server/api/services/api-letiende.ts:26` y `src/app/core/models/libro.model.ts` |
| `api.letiende.co` ya devuelve `description`, `categories`, `language`, `pageCount` y `maturityRating` cuando Google Books tiene el ISBN | Consulta real a `/libros?barcode=9786073155540` |
| La cobertura real de sinopsis en español es desconocida: 2 de 3 ISBN de prueba no devolvieron nada | Misma consulta; se mide en la Fase 1 |
| El repositorio `babel-letiende` es público | `gh repo view` |
| Ya existe un patrón de evaluación reutilizable (puntuación por reglas, nueva puntuación sin llamar a la API, control de cuota) | `flujo-n8n/scripts/eval-gemini.mjs` |
| Ya existe un patrón de proceso asíncrono por lotes sin servicios nuevos | ADR-012 (`validarLibrosWorker`) |

## 2. Decisiones aprobadas

1. **Proyecto de AI Studio propio para Babel.** Nivel gratuito durante desarrollo y evaluación; nivel de pago con prepago y tope bajo para el chat público en producción, porque en el nivel gratuito Google puede usar el contenido enviado (incompatible con el aviso de privacidad al visitante). → ADR-015.
2. **Ejecutor de evaluación propio** en TypeScript (funciones de puntuación probadas con Vitest), coherente con `eval-gemini.mjs`. Promptfoo se estudia y se documenta en la bitácora como alternativa. → ADR-017.
3. **Registro de esfuerzo doble:** `tracking-detail.csv` (obligatorio en Babel) + `ai-effort-tracking` propio del subproyecto. → ADR-016.
4. **Términos de uso de Google Books:** se revisan en la Fase 1 antes de guardar o mostrar sinopsis. Si no lo permiten, el asistente las usa por dentro y solo cita fragmentos breves.

---

## 3. Fases

Cada fase indica la capacidad que demuestra, el criterio de terminado (DoD) y su `trace_id` para el registro de esfuerzo.

### 3.1 Calendario revisado (19/11/2026)

Fases 0 a 3 tomaron tres días, con varios PRs por día cuando el trabajo era solo de backend. Lo que marca el ritmo ahora no es escribir código sino lo que depende de una persona: validar libros, verificar en `staging` y activar la facturación. Las fechas suponen días hábiles; el usuario no trabaja el fin de semana del 21 y 22/11. **Se recalcula al cerrar cada fase** (aunque sea parcial) y el recorrido real, con fechas y minutos de agente, queda en [`bitacora/00-planeacion.md`](bitacora/00-planeacion.md) («Recorrido del calendario»). Última revisión: 20/11/2026, al cerrar `T-0042`: v5 no cumple los criterios de 4b, así que la Fase 5 entra el lunes 23; producción sigue el 27/11, con el jueves 26 como holgura, pero ya no puede adelantarse.

| Fecha | Trabajo | Depende del usuario |
|---|---|---|
| Jue 19/11 | Plan de la Fase 4; carga de sinopsis en producción; 4a (`T-0041`, PR #165) ✓ | Clave local de Gemini en `.env` ✓; límites de cuota ✓; cuenta de pago para `production` ✓ |
| Vie 20/11 | 4b (`T-0042`): validación, ejecutor y línea base v5 contra v4 ✓ (v5 no cumple); la Fase 5 empieza en local | Validar candidatos y complemento ✓; fusionar 4b |
| Lun 23/11 | Fase 5 (`T-0050`): dos cambios de ingeniería, casos redefinidos, v6 y nueva corrida; Fase 6, parte 1 (registro, control de gasto y de tasa) | Revisar v6 en `staging` y fusionar |
| Mar 24/11 | Fase 6, parte 2 (límites de entrada, validador de fidelidad, revisión OWASP) | Verificar en `staging` |
| Mié 25/11 | Fase 7: chat en el catálogo, en `staging` | Revisar el chat |
| Jue 26/11 | Holgura; producción si 4b pasó a la primera | |
| **Vie 27/11** | **Producción:** índice de producción, interruptor encendido | Fusionar y verificar |
| Lun 30/11 – vie 4/12 | 4c (comparación de políticas y compuerta), Fase 9 (Azure), Fase 8 (necesita unos días de tráfico real) y Fase 10 | Cuenta de Azure, revisar 20 respuestas, video y página de caso |

### Fase 0 — Documentación y ficha de caso de uso · `T-0000` · COMPLETA (este PR)

- [x] Ficha de caso de uso escrita **antes** de construir ([`fichas/caso-de-uso.md`](fichas/caso-de-uso.md)).
- [x] Ficha inicial de riesgos y controles ([`fichas/riesgos-y-controles.md`](fichas/riesgos-y-controles.md)).
- [x] README, este plan, bitácora (índice, glosario, entrada 00, ruta de estudio).
- [x] ADR-013 a ADR-017, `PRD.md` §5.8 y §6, `tech-specs.md` §6 y §11, `TODO.md` (motor JIT), `CLAUDE.md`.
- [x] `ai-effort-tracking` inicializado (hooks en `.claude/settings.json` del repo).

### Fase 1 — Datos: enriquecer el inventario · `T-0010` · capacidad: fuentes de conocimiento

Partida en tres PRs (no cabía en uno): `T-0011` backend, `T-0012` Catalogar y Editar, `T-0013` carga retroactiva y reporte de cobertura.

**`T-0011` — Backend (PR abierto, 2026-11-16)**

- [x] Revisar los términos de Google Books API sobre guardar descripciones. Conclusión: la sección 5.e de los términos de las APIs de Google prohíbe crear copias permanentes del contenido devuelto; el usuario aceptó el riesgo con mitigaciones → **ADR-018**.
- [x] Los campos van en una tabla aparte, `babel-libros-conocimiento` (cambio respecto al plan original, que los ponía en `babel-libros`; razones en ADR-018). Campos: `sinopsis`, `categorias`, `idioma`, `paginas`, `clasificacionEdad`, `fuenteSinopsis`.
- [x] `obtenerMetadatosPorIsbn` los lee de Google Books; los adaptadores de los 6 sitios extraen la descripción en texto plano y descartan las que solo repiten el título o son demasiado cortas (Lerner devuelve solo el título). La sinopsis de un sitio con `info: true` se prefiere a la de Google (que queda de respaldo) y se anota su fuente.
- [x] `POST`/`PUT /api/libros` aceptan `conocimiento` opcional (ausente = no tocar); `DELETE` lo borra; `GET /api/libros/:bookId/conocimiento` (solo vendedor/administrador) lo lee.
- [x] Pruebas en verde, `build:api`, `serverless print` y `serverless package --stage dev` verificados; `package.patterns` sin cambios (no hay módulos nuevos).

**`T-0012` — Catalogar y Editar (fusionada, 2026-11-17)** (A08: nada automático se guarda sin que la persona pueda corregirlo)

- [x] Catalogar muestra la sinopsis, las categorías, el idioma, las páginas y la clasificación por edad que llegan de `GET /api/metadatos/:isbn` como sugerencia editable, con su fuente, y los envía en `conocimiento` al crear un libro nuevo.
- [x] Editar los carga con `GET /api/libros/:bookId/conocimiento` y los guarda; si no pudo leerlos, no envía nada.
- [x] Sinopsis nunca en el catálogo público.

**`T-0013` — Carga retroactiva y cobertura (implementada, PR abierto 2026-11-17)**

- [x] Carga del inventario existente con el patrón de ADR-012 (Lambda que se auto-invoca por lotes, progreso en tabla, disparada por el administrador), respetando los límites de las fuentes (PR abierto, 2026-11-17).
- [x] Reporte de cobertura: libros con sinopsis útil (≥ 200 caracteres), por idioma y por fuente; libros sin nada. Solo cifras agregadas.
- [x] Corrida en `staging` (2026-11-17): 23 libros, los 23 con sinopsis útil; fuentes: Librería Nacional 9, Tornamesa 8, Casa Tomada 5, Librería del Au 1; ninguna de Google Books. Cifras en la bitácora.
- [ ] Correr la carga en producción y anotar las cifras reales en la bitácora (sin sinopsis en git). **Adelantada al 19/11/2026**: la suite de la Fase 4 necesita el inventario real (ver Fase 4).

**`T-0014` — Idioma de los libros (implementada, PR abierto 2026-11-17)**

La corrida de `T-0013` en `staging` dejó los 23 libros con idioma «desconocido»: ninguna librería lo entrega y Google Books no aportó nada. El asistente necesita el idioma para los filtros de la Fase 2.

- [x] Inferencia en dos pasos, en `server/api/lib/idioma.ts`: primero el grupo de registro del ISBN (978/979); si no es concluyente, las palabras funcionales de la sinopsis; si tampoco, queda vacío.
- [x] `resolverMetadatosCompletos` la aplica solo cuando ninguna fuente trajo idioma, así que Catalogar y Editar también la reciben como sugerencia editable.
- [x] La carga retroactiva completa el idioma de los libros que ya tenían sinopsis sin consultar fuentes externas; nunca cambia un idioma existente.
- [ ] Volver a pulsar «Iniciar carga» en `staging` y confirmar que el reporte por idioma ya no dice «desconocido».

### Fase 2 — Índice y asistente mínimo · `T-0020` · capacidades: recuperación, asistente con límites, prompts versionados

Partida en tres PRs: `T-0021` cliente de Gemini detrás de `ProveedorLlm` (verificado contra la API real), `T-0022` índice de embeddings en S3 con reconstrucción incremental, `T-0023` Lambda `asistente`, prompt v1 y validador.

**`T-0021` — Cliente de Gemini (implementado, PR abierto 2026-11-17)** · bitácora [`02-cliente-gemini.md`](bitacora/02-cliente-gemini.md)

- [x] Clave en el secreto `GEMINI_API_KEY` del entorno `staging` (creada por el usuario).
- [x] Contrato verificado con la API real mediante `asistente-verificar-gemini.yml`: embeddings de 768 dimensiones ya normalizados, lote, `generateContent` con esquema JSON y `usageMetadata`.
- [x] `ProveedorLlm` (`server/api/lib/proveedor-llm.ts`) y `ProveedorGemini` (`gemini.ts`): embeddings de documentos y de consultas, generación con salida JSON, reintentos acotados, errores sin clave. 31 pruebas.
- [x] `T-0024` — Generación migrada a la Interactions API estable (`POST /v1/interactions`, sin estado, salida JSON con esquema) tras actualizarse las skills de Gemini; verificada con la clave real: variantes de versión y cabecera, conversación de varios turnos, truncado y niveles de pensamiento (detalle en la bitácora 02). 604 pruebas backend.
- [ ] Clave de producción (prepago) como secreto del entorno `production`: se necesita solo antes de encender el asistente; la Fase 2 sale con el interruptor apagado.

**`T-0022` — Índice de embeddings (implementada, PR abierto 2026-11-17)** · bitácora [`03-indice-embeddings.md`](bitacora/03-indice-embeddings.md)

- [x] Texto «título + autor + categorías + sinopsis» (lo que falte no entra; los libros sin sinopsis se indexan con lo que tengan y quedan marcados) convertido en vectores de 768 dimensiones con `gemini-embedding-2`.
- [x] Índice en un solo archivo en un bucket S3 privado, vectores cuantizados a `int8` (≈ 2,3 MB para 3.000 libros), sin texto de sinopsis; formato propio validado al leer.
- [x] Reconstrucción incremental por **huella del texto** (cambio respecto al plan, que decía fecha: editar un título no toca la fecha del conocimiento). Reanudable, con presupuesto de tiempo, sin perder libros si el proveedor falla, y con escritura condicional en S3.
- [x] Lambda `indiceAsistenteReconstruir` programada cada 6 horas en `staging`; apagada en producción hasta que exista su clave.
- [x] Búsqueda por similitud con filtro previo (`buscarSimilares`), lista para `T-0023`.
- [x] 31 pruebas nuevas (601 en total).
- [x] Verificado en `staging` (2026-11-17): 25 de 25 libros indexados en 1,7 s con 6.096 tokens de entrada; la segunda corrida conservó los 25, no pidió ningún token ni escribió (94 ms); archivo de 22.676 bytes cifrado (AES256) en un bucket con acceso público bloqueado; regla de 6 horas activa.

**`T-0023` — Lambda `asistente`, prompt v1 y validador (fusionada, PR #160, 2026-11-18)** · bitácora [`04-asistente-minimo.md`](bitacora/04-asistente-minimo.md)

- [x] Clave de Gemini del proyecto propio (secreto `GEMINI_API_KEY` del entorno `staging`). La de producción (prepago) se necesita solo antes de encender el asistente allí.
- [x] Lambda `asistente` (ADR-008), `POST /api/asistente`. Conversación sin estado: el cliente envía los últimos turnos (máx. 9, 1.000 caracteres c/u) y el servidor valida límites, roles y filtros. **Cambio respecto al plan:** exige sesión de vendedor o administrador (no es público hasta las fases 6 y 7, cuando existan los topes de gasto y de tasa), además del interruptor `ASISTENTE_ACTIVO` (encendido en `staging`, apagado en producción). Decidido con el usuario el 17/11/2026.
- [x] Búsqueda híbrida: filtros del índice (idioma, excluir contenido adulto) → coseno (40) → existencias y precio máximo contra `babel-libros` → 8 libros al modelo. Los filtros los envía el cliente; el de edad es solo «excluir `MATURE`», el único dato que existe.
- [x] Respuesta con esquema JSON (`texto`, `recomendaciones {bookId, motivo}`, `sinResultados`). El validador descarta los `bookId` que no estén en la lista del turno (inexistentes, agotados o de otro turno), cuenta los descartes y, si todo se descartó, sustituye el texto por la respuesta segura. A la respuesta pública solo salen `bookId`, título, autor, PVP, portada y motivo (lista blanca); la sinopsis nunca.
- [x] `asistente-ia/prompts/asistente-v1.md` con encabezado (versión, modelo, fecha, motivo) + `CHANGELOG.md`; el mismo archivo se empaqueta y se lee en la Lambda.
- [x] 87 pruebas nuevas con el modelo simulado (691 en total).
- [x] Rol IAM `AsistenteLambdaRole`: solo `GetItem` sobre libros, conocimiento y usuarios, y lectura del índice en S3.
- [x] Verificado en `staging` por el usuario con su sesión (18/11/2026): recomendaciones reales, filtros de idioma y precio correctos, inyección directa resistida. Producción verificada con el interruptor apagado (`503`).

### Fase 3 — Llamado de herramientas · `T-0030` · capacidad: integración con sistemas

Bitácora [`05-herramientas.md`](bitacora/05-herramientas.md). **Cambio respecto al plan:** la búsqueda inicial de `T-0023` se conserva y las herramientas son de apoyo. Con 5 a 13 s por llamada al modelo (medido), hacer de `buscar_libros` el único camino costaría dos llamadas por pregunta, contra el límite de 30 s de API Gateway.

- [x] Contrato del llamado de herramientas verificado contra la API real (`asistente-ia/scripts/verificar-herramientas-gemini.mjs`): declaración plana, `requires_action`, el pensamiento se reenvía (si no, 400), el resultado va como lista de partes de texto, herramientas + salida JSON en la misma petición, llamadas en paralelo, `tool_choice`.
- [x] Herramientas de solo lectura: `buscar_libros(consulta, filtros)`, `consultar_disponibilidad(bookIds)` (precio, existencias, Espacio/Mueble/Ubicación). Las políticas de la librería no son herramienta: viajan siempre en el contexto (v4, tras un horario inventado en `staging`).
- [x] Lista blanca de campos: el modelo **nunca** recibe `costo`, `utilidad`, `porcentajeDescuentoEditorial` ni datos de ventas (prueba con un libro que los trae).
- [x] Validación de argumentos en el servidor (el modelo real omitió un parámetro obligatorio en la verificación), tope de 3 rondas y de 4 llamadas por ronda, presupuesto de tiempo, y respuesta definida cuando una herramienta falla o los argumentos son inválidos.
- [x] Rol IAM de la Lambda: solo lectura (`GetItem`) sobre libros, conocimiento, usuarios, ubicaciones, muebles y espacios, y lectura del índice en S3.
- [x] Prompt v2 (`herramientas: true`); v1 queda intacto como línea base sin herramientas.
- [x] 61 pruebas nuevas (752 en total) que ejercitan cada herramienta, incluidos los fallos.
- [x] `asistente-ia/conocimiento/politicas-libreria.md` (**contenido del usuario**, completado el 18/11/2026: horarios, formas de pago, cambios y devoluciones, ubicación, envíos y apartados). Un tema vacío hace que el asistente diga que no tiene el dato.
- [x] Verificado en `staging` por el usuario con su sesión (prompt v2, 5 preguntas): disponibilidad, ubicación y horarios correctos; 3 fallos hallados y corregidos en el mismo PR con el prompt v3 y la fecha calculada en el servidor (bitácora 05 §5-6).
- [x] Segunda prueba en `staging` (v3): buscar con filtros y precio/ubicación correctos; un horario inventado y un 502 → v4 (políticas siempre en el contexto, sin la herramienta `consultar_politicas`), reintento de la respuesta final y registro con motivo.
- [x] v4 verificada: 9 de 9 en el CI contra el modelo real (`verificar-prompt-gemini.mjs`) y varias pruebas de Oliver en `staging`, incluidas preguntas de políticas. Oliver agregó al archivo de políticas el tema del parqueadero.
- [x] v5 (vigente): el CI halló que un tema ausente de las políticas (wifi) podía responderse como «no contamos con…»; la regla nueva obliga a decir solo que no hay dato. 15 de 15 en el CI (parqueadero y wifi incluidos). Fase 3 fusionada en el PR #161 (18/11/2026).

### Fase 4 — Suite de evaluación · `T-0040` · capacidad: pruebas funcionales y de regresión

Partida en tres PRs (19/11/2026). **4a y 4b van antes del paso a producción; 4c, después de las Fases 6 y 7.** Producción no espera la compuerta automática: sale con los criterios manuales de 4b.

**Hallazgo al planearla (19/11/2026):** el único inventario con sinopsis era el de `staging`, con 25 libros. Con 25 libros la suite no mide nada: la búsqueda toma 40 candidatos (más que el inventario entero), así que Recall@k sale 100 % por construcción y los casos «sin respuesta» son artificiales. Por eso la carga de sinopsis de producción (`T-0013`, prevista para la semana del 30/11) se adelanta y la copia congelada sale de producción.

**`T-0041` — 4a. Base sin LLM (fusionada, PR #165, 2026-11-19; índice, candidatos y validación cerrados en 4b, 2026-11-20)** · bitácora [`06-evaluacion.md`](bitacora/06-evaluacion.md)

- [x] Prerrequisito (usuario): carga de sinopsis en producción, corrida el 19/11/2026: 2.541 libros, 2.201 con sinopsis útil (86,6 %), 0 errores, 58 minutos. Cifras en la bitácora 01. Hallazgos: ningún libro trae categorías ni clasificación por edad, y el idioma inferido por el grupo del ISBN puede equivocarse.
- [x] Copia congelada del inventario de producción, **fuera de git** (`scripts/congelar-inventario.mjs`): solo lectura, paginada a mano, con **lista blanca en la propia petición** (`ProjectionExpression`: nunca salen `costo`, `utilidadCatalogo`, `porcentajeDescuentoEditorial` ni `creadoPor`). Se usó el SDK con tu perfil de AWS y no el MCP, porque el MCP no puede escribir archivos en la máquina y la copia pesa varios MB. 2.541 libros, 2.519 filas de conocimiento, 109 ubicaciones.
- [x] Script del índice local (`scripts/construir-indice-evals.mjs`): reutiliza `reconstruirIndice` de producción con un almacén en disco y las sinopsis envenenadas aplicadas. Corrido: 2.541 libros. La cuota gratuita de embeddings cuenta cada libro (100 por minuto, unas 1.000 por día) y se detuvo en 950; se terminó con la clave de pago (`EVALS_CLAVE=production`). Límites anotados por el usuario el 19/11: `gemini-3.5-flash-lite` 15 RPM, 250K TPM, 500 RPD; `gemini-embedding-2` 100 RPM, 30K TPM, 1K RPD.
- [x] Formato de caso y **46 casos** en `asistente-ia/evals/casos/` (preguntas sintéticas, sin datos de personas): 15 aceptables, 7 restricciones, 6 sin respuesta, 3 ambiguos, 4 inyección directa, 3 inyección indirecta (3 sinopsis envenenadas **solo en la copia**), 8 políticas. Escritos contra el inventario real; guardia en `casos-evaluacion.spec.ts`.
- [x] Script de candidatos (`evaluar-recuperador.mjs --candidatos`) e importador (`importar-validacion.mjs`): para cada uno de los 22 casos que lo necesitan, la unión de los 10 primeros del recuperador y de una búsqueda por palabras, en orden barajado. Marcas con `x` y agregas con `+ ISBN` o `+ Título`: si los candidatos salieran solo del recuperador, Recall@k quedaría inflado. Generado (22 preguntas, 351 candidatos) y validado por el usuario el 20/11/2026, más un complemento de 23 libros (ver 4b). 216 aceptables.
- [x] Puntuador determinista y Recall@k/Hit@k probados con Vitest (30 pruebas nuevas, 791 en total), `--dry-run`, y los embeddings de las preguntas se guardan para volver a puntuar sin llamar a la API.

**`T-0042` — 4b. Ejecutor y línea base (implementada, PR abierto 2026-11-20)** · bitácora [`06-evaluacion.md`](bitacora/06-evaluacion.md) §5

- [x] Ejecutor que llama a `responder()` en el mismo proceso, con la copia congelada inyectada (sin `staging`, sin despliegues), control de cuota y `--limit`; resultados crudos fuera de git y tabla agregada en git (`scripts/ejecutar-evals.mjs`).
- [x] Métricas deterministas: existencia, disponibilidad, cumplimiento de restricciones, rechazo correcto, acierto, resistencia a inyección, tokens y latencia. **Costo en USD pendiente:** el precio de Gemini no está verificado en `metrics/pricing.json`.
- [x] Recuperador con la validación completa: Recall@8 0,59, Recall@40 0,78, Hit@8 0,95 (22 casos).
- [x] Primera corrida con **v4 y v5**, 3 repeticiones por caso: 276 ejecuciones, 0 errores (20/11/2026).
- [x] **Criterios manuales para producción:** 0 libros inventados o agotados recomendados, 0 inyecciones que cambien el comportamiento, y restricciones cumplidas en al menos el 90 % de los casos. **Resultado:** v5 cumple los tres primeros y queda en 86 % (18/21) en restricciones → **no cumple**; v4, 90 % (19/21). La diferencia es una ejecución: lo que pesa son dos fallos que comparten las dos versiones (bitácora 06 §5). → Fase 5.
- [x] Modelo juez: **fuera de la Fase 4**. Es de la misma familia que el evaluado, tiene sesgos y gasta cuota; las métricas deterministas cubren lo crítico. Se reconsidera en la Fase 5 si hace falta medir la fidelidad del motivo.

**`T-0043` — 4c. Comparación de políticas y compuerta (después de las Fases 6 y 7)**

- [ ] Compuerta: `evals:comparar` contra la línea base sale con error si alguna métrica empeora más de la tolerancia. Workflow manual de GitHub Actions, obligatorio antes de cambiar prompt o modelo.
- [ ] **v1 a v3 solo aquí, y con advertencia.** El código actual siempre envía la fecha y las políticas, y v2 y v3 piden la herramienta `consultar_politicas`, que se eliminó en v4. Correrlas mide «prompt viejo con el código nuevo», no el sistema de entonces; v2 y v3 solo tienen sentido con la herramienta restaurada detrás de la opción del encabezado.
- [ ] **Políticas: herramienta o contexto (decidido el 18/11/2026).** Convertir la anécdota de `staging` en una medición. Base actual, sin valor estadístico: con herramienta, v2 consultó las políticas en sus 2 preguntas de horario y v3 la omitió en 1 de 2 e inventó un horario; v4 (en el contexto) pasó 9 de 9 en el CI y las pruebas de Oliver. Plan: devolver `consultar_politicas` detrás de una opción del encabezado del prompt (`politicas: contexto | herramienta`, por defecto `contexto`), unas 15 preguntas de políticas (día relativo, día concreto, tema ausente, dato que se debe citar, pregunta mixta libro + política) con varias repeticiones, contra v3 (herramienta) y v4 (contexto). Métricas: acierto, alucinación, omisión de la herramienta, latencia y tokens. Resultado esperado: una tabla en la bitácora que justifique (o revierta) la decisión de v4. Producción sigue con `contexto` mientras tanto.

### Fase 5 — Iteración de prompts · `T-0050` · capacidad: versionar y optimizar prompts

Entra porque v5 no cumple los criterios de 4b (20/11/2026). Alcance decidido con el usuario ese día, a partir de la línea base:

- [ ] **Guarda contra «anuncia y no actúa»** (ingeniería): si la respuesta no recomienda nada, no declara `sinResultados` y no llamó a ninguna herramienta, el servidor no la entrega tal cual. R01 falló así en 3 de 3 con v5.
- [ ] **Precio antes del top-40** (ingeniería): con `precioMaximo`, los libros baratos no llegan al modelo porque el precio se filtra después de la similitud (R07). Filtrar por precio antes, o traer más candidatos cuando hay límite.
- [ ] **Casos redefinidos:** en «sin respuesta» se acepta recomendar libros cercanos si el asistente dice que no hay uno exacto; S06 se corrige (el inventario sí tiene teoría penal); en R03 un libro bilingüe vale si el asistente dice que es bilingüe.
- [ ] **v6**, si después de lo anterior todavía hace falta, con motivo, hipótesis y efecto medido. Desde v5, cambios guiados solo por fallos de la suite.
- [ ] Nueva corrida contra la línea base y los criterios de 4b; ficha por prompt y tabla de resultados por versión en la bitácora.

### Fase 6 — Operación segura (backend) · `T-0060` · capacidad: uso responsable, privacidad y seguridad

- [ ] Tabla `babel-asistente-registros` (TTL): consulta con correos, teléfonos y números de documento enmascarados, `bookId` propuestos, latencia, tokens, costo estimado, modelo, versión del prompt, valoración y banderas (rechazo, inyección sospechada). Sin IP: solo un hash con sal diaria rotativa.
- [ ] Tabla `babel-asistente-control`: interruptor administrable, contador atómico de gasto diario (tope en USD) y de mensajes por visitante (con TTL).
- [ ] Límites de entrada (longitud, número de turnos) y limitación de tasa en API Gateway para la ruta.
- [ ] **Validador de fidelidad (decidido el 18/11/2026).** Mismo principio que el validador de `bookId`, aplicado a datos: toda hora, porcentaje, teléfono, dirección y precio que aparezca en `texto` debe estar en las políticas o en los datos de ese turno (libros ofrecidos y resultados de herramientas). Si no, la respuesta se descarta, se pide una vez más y se cuenta en el registro. Sirve con las políticas en el contexto o detrás de una herramienta: tenerlas a la vista no impide que el modelo las cambie. Casos en la suite: respuestas con un dato alterado.
- [ ] Casos de seguridad agregados a la suite; ficha de riesgos actualizada con los controles reales; verificación con la skill `owasp-security-verification`.

### Fase 7 — Chat en el catálogo público · `T-0070` · capacidad: asistente conversacional → **producción**

- [ ] `ChatAsistenteComponent` standalone, solo en el cliente (sin SSR), con identidad visual de Babel (`docs/DESIGN.md`).
- [ ] Aviso visible: "Hablas con una IA" + qué se registra y para qué (Ley 1581 de 2012).
- [ ] Tarjetas pintadas con datos de Babel (nunca con texto del modelo), enlace a la ficha `/libro/:bookId`, pulgar arriba o abajo.
- [ ] Interpolación estándar de Angular; nada de `innerHTML` con texto del modelo.
- [ ] Criterios de 4b cumplidos (tras la Fase 5) → producción con el interruptor encendido (la compuerta automática llega en 4c).

### Fase 8 — Tablero y análisis · `T-0080` · capacidad: métricas de desempeño y consumo

- [ ] `/admin/asistente`: conversaciones, % de valoraciones positivas, tasa de rechazo, libros inventados por cada 100 respuestas, costo por conversación, latencia p50/p95, tokens; interruptor.
- [ ] Cola de revisión manual: el usuario marca 20 respuestas reales (bien, mal recomendado, inventado).
- [ ] Análisis de una página con hallazgos y **una mejora aplicada y medida**.

### Fase 9 — Cambio de modelo y Azure · `T-0090` · capacidad: retiro o cambio de modelo, Azure

- [ ] Interfaz `ProveedorLlm` con implementaciones Gemini y Azure (Azure AI Foundry / Azure OpenAI: verificar crédito gratuito y modelos disponibles por región al momento).
- [ ] Simulacro: cambiar la versión del modelo de Gemini y correr la suite. Correr la misma suite contra el modelo de Azure.
- [ ] Tabla comparativa de calidad, costo por conversación y latencia; procedimiento de cambio de versión en `fichas/procedimiento-cambio-modelo.md`.
- [ ] Opcional si el crédito alcanza: Azure AI Search como recuperador alternativo, comparado con el índice propio mediante recall@k.

### Fase 10 — Empaque · `T-0100` · capacidad: capacitar y comunicar

- [ ] README final con cifras medidas y enlaces a cada evidencia; versión en inglés (`README.en.md`).
- [ ] Guía de una página para quien atiende la librería (qué hace el asistente, qué no, cómo apagarlo, a quién escalar).
- [ ] Reporte final de esfuerzo (`ai-effort-tracking report`) y cierre de la bitácora.
- [ ] Tareas del usuario fuera del repositorio: video de 2 minutos, página de caso en su sitio personal.

---

## 4. Lo que hace el usuario (no lo puede hacer el agente)

| Fase | Tarea |
|---|---|
| 2 | Crear el proyecto de AI Studio de Babel, generar la clave y cargarla como secreto en GitHub |
| 3 | Redactar las políticas de la librería |
| 4 | Lanzar la carga de sinopsis en producción; validar los libros aceptables de cada caso (el agente propone candidatos y el usuario puede agregar otros) |
| 6 | Activar la facturación prepagada con tope en el proyecto de AI Studio y crear la clave de producción (a más tardar el 24/11) |
| 8 | Revisar las 20 respuestas reales |
| 9 | Abrir la cuenta de Azure |
| 10 | Grabar el video y publicar la página de caso |
| Transversal | Ruta de estudio ([`bitacora/estudio.md`](bitacora/estudio.md)) |

## 5. Riesgos del plan

| Riesgo | Mitigación |
|---|---|
| Baja cobertura de sinopsis en español en Google Books | Respaldo con los sitios `info`; indexar con título, autor y categoría; medir y reportar la cobertura en lugar de ocultarla |
| Los términos de Google Books no permiten guardar o mostrar descripciones | Decisión 4: uso interno y citas breves |
| Una suite sobre un inventario diminuto no mide nada (25 libros en `staging`) | Copia congelada del inventario real de producción tras su carga de sinopsis (Fase 4) |
| Etiquetas sesgadas por el recuperador (Recall@k inflado) | Candidatos de dos fuentes y libros agregados por el usuario (Fase 4a) |
| La cuota gratuita de Gemini no alcanza para iterar la suite | Recall@k sin LLM, `--dry-run`, nueva puntuación sin API, corridas con `--limit`; respaldo de pago con tope |
| Abuso o costo descontrolado en un chat público | Interruptor, tope por visitante, tope de gasto diario, limitación de tasa (Fase 6, antes de la Fase 7) |
| El modelo recomienda libros inexistentes | Validador determinista + métrica de libros inventados en la suite y en el tablero |
| El calendario de Navidad no se cumple | El orden de las fases pone primero lo que llega al visitante; las Fases 8 a 10 pueden ir después |
