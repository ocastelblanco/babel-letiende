# Plan — Asistente de Babel

**Aprobado por el usuario:** 16/11/2026 (las 4 decisiones de §2, tal como se recomendaron).
**Meta de calendario:** chat en producción la semana del 30/11/2026, a tiempo para la temporada de Navidad. Las Fases 8 a 10 pueden terminar después: no bloquean al visitante.
**Duración estimada:** 9 a 10 sesiones de trabajo (no los 10 días hábiles fijos de la propuesta original).

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
- [ ] Correr la carga en producción (tras el paso a producción de la semana del 30/11) y anotar las cifras reales en la bitácora (sin sinopsis en git).

**`T-0014` — Idioma de los libros (implementada, PR abierto 2026-11-17)**

La corrida de `T-0013` en `staging` dejó los 23 libros con idioma «desconocido»: ninguna librería lo entrega y Google Books no aportó nada. El asistente necesita el idioma para los filtros de la Fase 2.

- [x] Inferencia en dos pasos, en `server/api/lib/idioma.ts`: primero el grupo de registro del ISBN (978/979); si no es concluyente, las palabras funcionales de la sinopsis; si tampoco, queda vacío.
- [x] `resolverMetadatosCompletos` la aplica solo cuando ninguna fuente trajo idioma, así que Catalogar y Editar también la reciben como sugerencia editable.
- [x] La carga retroactiva completa el idioma de los libros que ya tenían sinopsis sin consultar fuentes externas; nunca cambia un idioma existente.
- [ ] Volver a pulsar «Iniciar carga» en `staging` y confirmar que el reporte por idioma ya no dice «desconocido».

### Fase 2 — Índice y asistente mínimo · `T-0020` · capacidades: recuperación, asistente con límites, prompts versionados

- [ ] Clave de Gemini del proyecto propio (secreto de GitHub Actions → variable de entorno; nunca en el repo).
- [ ] Embeddings de "título + autor + categorías + sinopsis" con el modelo de embeddings vigente de la Gemini API. Los libros sin sinopsis se indexan con lo que tengan y quedan marcados.
- [ ] Índice en un solo archivo en un bucket S3 privado (vectores de dimensión reducida y cuantizados; 3.000 × 768 en float32 ≈ 9 MB, en int8 ≈ 2,3 MB). Reconstrucción incremental programada (EventBridge): solo los libros con `actualizadoEn` posterior al índice.
- [ ] Lambda `asistente` (ADR-008), `POST /api/asistente`, **interruptor apagado en producción**. Conversación sin estado: el cliente envía los últimos turnos, con límites de longitud validados en el servidor.
- [ ] Búsqueda híbrida: filtros estructurados (disponible, idioma, precio máximo, edad) → similitud coseno → top-k.
- [ ] Respuesta con salida estructurada (esquema JSON: texto, recomendaciones `{bookId, motivo}`, `sinResultados`). El validador descarta los `bookId` inexistentes o agotados y cuenta cuántos descartó.
- [ ] `asistente-ia/prompts/asistente-v1.md` con encabezado (versión, modelo, fecha, motivo) + `CHANGELOG.md`.
- [ ] Pruebas unitarias del índice, del validador y del handler (con el modelo simulado).

### Fase 3 — Llamado de herramientas · `T-0030` · capacidad: integración con sistemas

- [ ] Herramientas de solo lectura: `buscar_libros(consulta, filtros)`, `consultar_disponibilidad(bookIds)` (precio, existencias, Espacio/Mueble/Ubicación), `consultar_politicas(tema)`.
- [ ] Lista blanca de campos: el modelo **nunca** recibe `costo`, `utilidad`, `porcentajeDescuentoEditorial` ni datos de ventas.
- [ ] Validación de argumentos, tope de rondas de herramientas por consulta y respuesta definida cuando una herramienta falla.
- [ ] Rol IAM de la Lambda: solo lectura sobre `babel-libros` y el bucket del índice.
- [ ] `asistente-ia/conocimiento/politicas-libreria.md` (**contenido del usuario**: horarios, cambios, formas de pago) que el asistente cita.
- [ ] Pruebas que ejercitan cada herramienta, incluidos los fallos.

### Fase 4 — Suite de evaluación · `T-0040` · capacidad: pruebas funcionales y de regresión

- [ ] 40 a 60 casos en `asistente-ia/evals/casos/`: con libros aceptables (**validados por el usuario**), con restricciones explícitas (idioma, precio, edad), sin respuesta posible, ambiguos, inyección directa, inyección indirecta (sinopsis envenenada en la copia congelada) y preguntas de políticas.
- [ ] Copia congelada del inventario (fuera de git) para que las corridas sean comparables.
- [ ] Métricas deterministas: existencia, disponibilidad, cumplimiento de restricciones, rechazo correcto, acierto (hit@k), resistencia a inyección, tokens, costo y latencia. Recall@k del recuperador sin LLM (barato). Modelo juez opcional para la fidelidad de la explicación, con sus sesgos documentados.
- [ ] Ejecutor con control de cuota, `--dry-run` y nueva puntuación sin llamar a la API; resultados crudos fuera de git y tabla agregada en git.
- [ ] Compuerta: `evals:comparar` contra la línea base sale con error si alguna métrica empeora más de la tolerancia. Workflow manual de GitHub Actions, obligatorio antes de cambiar prompt o modelo.
- [ ] Primera corrida con v1 = línea base.

### Fase 5 — Iteración de prompts · `T-0050` · capacidad: versionar y optimizar prompts

- [ ] v2 y v3 guiadas solo por fallos de la suite. Por cada cambio: motivo, hipótesis, efecto medido.
- [ ] Ficha por prompt y tabla de resultados por versión en la bitácora.

### Fase 6 — Operación segura (backend) · `T-0060` · capacidad: uso responsable, privacidad y seguridad

- [ ] Tabla `babel-asistente-registros` (TTL): consulta con correos, teléfonos y números de documento enmascarados, `bookId` propuestos, latencia, tokens, costo estimado, modelo, versión del prompt, valoración y banderas (rechazo, inyección sospechada). Sin IP: solo un hash con sal diaria rotativa.
- [ ] Tabla `babel-asistente-control`: interruptor administrable, contador atómico de gasto diario (tope en USD) y de mensajes por visitante (con TTL).
- [ ] Límites de entrada (longitud, número de turnos) y limitación de tasa en API Gateway para la ruta.
- [ ] Casos de seguridad agregados a la suite; ficha de riesgos actualizada con los controles reales; verificación con la skill `owasp-security-verification`.

### Fase 7 — Chat en el catálogo público · `T-0070` · capacidad: asistente conversacional → **producción**

- [ ] `ChatAsistenteComponent` standalone, solo en el cliente (sin SSR), con identidad visual de Babel (`docs/DESIGN.md`).
- [ ] Aviso visible: "Hablas con una IA" + qué se registra y para qué (Ley 1581 de 2012).
- [ ] Tarjetas pintadas con datos de Babel (nunca con texto del modelo), enlace a la ficha `/libro/:bookId`, pulgar arriba o abajo.
- [ ] Interpolación estándar de Angular; nada de `innerHTML` con texto del modelo.
- [ ] Suite en verde → producción con el interruptor encendido.

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
| 4 | Validar los libros aceptables de cada caso (el agente propone candidatos) |
| 6 | Activar la facturación prepagada con tope en el proyecto de AI Studio antes de producción |
| 8 | Revisar las 20 respuestas reales |
| 9 | Abrir la cuenta de Azure |
| 10 | Grabar el video y publicar la página de caso |
| Transversal | Ruta de estudio ([`bitacora/estudio.md`](bitacora/estudio.md)) |

## 5. Riesgos del plan

| Riesgo | Mitigación |
|---|---|
| Baja cobertura de sinopsis en español en Google Books | Respaldo con los sitios `info`; indexar con título, autor y categoría; medir y reportar la cobertura en lugar de ocultarla |
| Los términos de Google Books no permiten guardar o mostrar descripciones | Decisión 4: uso interno y citas breves |
| La cuota gratuita de Gemini no alcanza para iterar la suite | Recall@k sin LLM, `--dry-run`, nueva puntuación sin API, corridas con `--limit`; respaldo de pago con tope |
| Abuso o costo descontrolado en un chat público | Interruptor, tope por visitante, tope de gasto diario, limitación de tasa (Fase 6, antes de la Fase 7) |
| El modelo recomienda libros inexistentes | Validador determinista + métrica de libros inventados en la suite y en el tablero |
| El calendario de Navidad no se cumple | El orden de las fases pone primero lo que llega al visitante; las Fases 8 a 10 pueden ir después |
