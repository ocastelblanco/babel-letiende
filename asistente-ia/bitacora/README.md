# Bitácora del Asistente de Babel

Registro de lo que se hizo, cómo y por qué, escrito para **consultarlo después**: cada entrada explica las tecnologías, los protocolos y los flujos aplicados, no solo los cambios. Las cifras son medidas, nunca estimadas; lo que no funcionó también se cuenta.

## Índice de entradas

| # | Entrada | Fase | Estado |
|---|---|---|---|
| 00 | [Planeación y alcance](00-planeacion.md) | 0 | Completa (16/11/2026) |
| 01 | [Datos: enriquecer el inventario con sinopsis](01-datos-sinopsis.md) | 1 | Completa (`T-0011` a `T-0014` fusionadas; carga en producción corrida el 19/11/2026) |
| 02 | [Cliente de Gemini detrás de `ProveedorLlm`](02-cliente-gemini.md) | 2 | Completa (`T-0021` y `T-0024` fusionadas) |
| 03 | [Índice de embeddings](03-indice-embeddings.md) | 2 | Completa (`T-0022` fusionada) |
| 04 | [El asistente mínimo: endpoint, búsqueda híbrida, prompt v1 y validador](04-asistente-minimo.md) | 2 | Completa (`T-0023` fusionada y verificada en `staging`) |
| 05 | [Llamado de herramientas: contrato verificado, validación de argumentos y bucle acotado](05-herramientas.md) | 3 | Completa (`T-0030` fusionada, prompt v5) |
| 06 | [Suite de evaluación y línea base](06-evaluacion.md) | 4 | 4a y 4b completas (`T-0041` #165, `T-0042` #166); 4c (`T-0043`) después de producción |
| 07 | [Iteración con evidencia: guardas del servidor, casos redefinidos y v6](07-iteracion.md) | 5 | Completa (`T-0050`, PR #168) |
| 08 | [Operación segura: control de gasto y de tasa](08-operacion-segura.md) | 6 | En curso (`T-0060`, parte 1 implementada el 21/11/2026) |
| 08 | Operación segura: registro, topes y privacidad | 6 | Pendiente |
| 09 | Chat en el catálogo público y salida a producción | 7 | Pendiente |
| 10 | Tablero y análisis de 20 respuestas reales | 8 | Pendiente |
| 11 | Cambio de modelo y Azure | 9 | Pendiente |
| 12 | Empaque y cierre | 10 | Pendiente |
| — | [Ruta de estudio](estudio.md) | Transversal | En curso |

## Plantilla de cada entrada

Cada archivo `NN-tema.md` sigue la misma estructura, para que todas se lean igual:

1. **Objetivo** — qué capacidad demuestra la fase y su criterio de terminado.
2. **Conceptos y tecnologías** — explicados como referencia: qué son, cómo funcionan, por qué se eligieron aquí y qué alternativas había.
3. **Decisiones** — con enlace al ADR correspondiente en `docs/MEMORY.md` §3.
4. **Qué se hizo** — flujo, archivos clave (`ruta:línea`) y PR.
5. **Cifras medidas** — con la fecha y la forma de medirlas.
6. **Qué falló y cómo se corrigió** — incluido lo que detectó la suite.
7. **Esfuerzo** — tiempo humano vs. agente, tokens y costo, desde `../metrics/`.
8. **Fuentes** — documentación oficial consultada, con fecha de consulta.

## Mapa capacidad → evidencia

Se completa a medida que cada evidencia existe. Una capacidad solo se marca como demostrada cuando su evidencia está en el repositorio (o en producción) y tiene cifras medidas.

| Capacidad | Evidencia | Estado |
|---|---|---|
| Comunicar el caso de uso antes de construir | [`../fichas/caso-de-uso.md`](../fichas/caso-de-uso.md) (16/11/2026, antes de cualquier código) | Demostrada |
| Fuentes de conocimiento: estructura, carga y consulta | Tabla `babel-libros-conocimiento`, adaptadores por fuente y [entrada 01](01-datos-sinopsis.md); carga retroactiva y reporte de cobertura hechos y probados en `staging` | En curso |
| Recuperación híbrida | Índice, recall@k | Pendiente |
| Asistente con límites de respuesta | Endpoint, demo en el catálogo | Pendiente |
| Llamado de herramientas | Herramientas y sus pruebas | Pendiente |
| Evaluación y regresión de agentes | Suite, compuerta, tabla por versión | Pendiente |
| Versionado y optimización de prompts | `prompts/` con CHANGELOG y fichas | Pendiente |
| Uso responsable, privacidad y seguridad | Ficha de riesgos con controles implementados, casos de seguridad | Planeada |
| Métricas de desempeño y consumo | Tablero, análisis con mejora aplicada | Pendiente |
| Cambio de modelo y Azure | Tabla comparativa, procedimiento | Pendiente |
| Capacitación | Guía de una página para la librería | Pendiente |

## Glosario

Se amplía en cada fase. Las definiciones son las que se usan en este proyecto.

| Término | Definición |
|---|---|
| **LLM** | Modelo de lenguaje grande: genera texto a partir de instrucciones y contexto. Aquí redacta la recomendación y decide qué herramientas llamar. |
| **Prompt del sistema** | Instrucciones fijas que definen el rol, los límites y el formato de respuesta del asistente. Se versiona como un archivo. |
| **Embedding** | Vector numérico que representa el significado de un texto. Dos textos con significado parecido tienen vectores cercanos. |
| **Similitud coseno** | Medida de cercanía entre dos vectores (el coseno del ángulo entre ellos). Se usa para encontrar las sinopsis más parecidas a la consulta. |
| **RAG** (generación aumentada con recuperación) | Patrón en el que primero se recuperan documentos relevantes y después el modelo responde usando solo esos documentos. |
| **Búsqueda híbrida** | Combinar filtros estructurados (idioma, precio, existencias) con búsqueda por significado (embeddings). |
| **Top-k / recall@k** | Los k resultados más parecidos. Recall@k: proporción de libros correctos que aparecen entre esos k. |
| **Hit@k** | Si al menos un resultado aceptable aparece entre los k propuestos. |
| **Llamado de herramientas** (*function calling*) | El modelo no consulta datos por sí mismo: pide ejecutar una función declarada (nombre + esquema de argumentos) y el servidor la ejecuta y le devuelve el resultado. |
| **Salida estructurada** | Respuesta del modelo obligada a seguir un esquema JSON, para poder validarla con código. |
| **Validador determinista** | Código (no IA) que revisa la respuesta del modelo contra la fuente de verdad, aquí el inventario. |
| **Alucinación** | Contenido que el modelo presenta como cierto sin sustento; aquí, sobre todo, libros inexistentes. |
| **Inyección de prompt** | Texto que intenta cambiar el comportamiento del modelo. Directa: la escribe el usuario. Indirecta: viene dentro de datos de terceros, como una sinopsis. |
| **Suite de evaluación** | Conjunto fijo de casos con resultados esperados que se corre contra cada versión de prompt o de modelo. |
| **Línea base** | Resultado de la suite contra la versión vigente; cada cambio se compara contra ella. |
| **Compuerta de regresión** | Paso automático que bloquea un cambio si alguna métrica empeora más de la tolerancia. |
| **LLM como juez** | Usar un modelo para calificar las respuestas de otro. Útil para criterios difíciles de codificar; tiene sesgos (posición, longitud, preferencia por su propio estilo). |
| **Tokens** | Unidades de texto que el modelo procesa; con ellas se miden el consumo y el costo. |
| **Cuantización** | Guardar los vectores con menos precisión (por ejemplo, int8 en lugar de float32) para reducir su tamaño a cambio de una pérdida pequeña de exactitud. |
| **TTL** | Tiempo de vida de un registro en DynamoDB: pasado ese tiempo, se borra solo. |
