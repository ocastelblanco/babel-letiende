# 06 — Suite de evaluación y línea base

**Fecha:** 19/11/2026 · **Fase:** 4 · **trace_id:** `T-0040` (`T-0041` base sin LLM · `T-0042` ejecutor y línea base · `T-0043` comparación de políticas y compuerta) · **Estado:** `T-0041` implementada, PR abierto; el índice local y los candidatos esperan la clave de Gemini en la máquina y tu validación

## 1. Objetivo

Que cada cambio del asistente (prompt, modelo, recuperador) se pueda **medir contra el anterior** en vez de juzgarse por unas pocas pruebas manuales en `staging`. La Fase 3 mostró por qué: cada versión del prompt (v2 a v5) la corrigió un fallo que encontró una persona a mano, uno a la vez. Una suite repetible encuentra esos fallos antes y deja una tabla de resultados por versión.

Criterio de terminado de la Fase 4 completa: 40 a 60 casos con libros aceptables validados por una persona, métricas deterministas, ejecutor con control de cuota, corrida de la línea base y compuerta que sale con error si una métrica empeora. Esta entrada empieza con `T-0041`: **lo que se puede construir y probar sin llamar a un modelo de lenguaje**.

## 2. Conceptos y tecnologías

### Qué mide cada cosa (y por qué se separan)

| Se mide | Con qué | Gasta cuota de generación |
|---|---|---|
| **Recall@k del recuperador**: de los libros aceptables, qué parte aparece entre los `k` primeros que devuelve la búsqueda | Embeddings de las preguntas (una vez) | No |
| **Hit@k**: ¿al menos un aceptable entre los `k` primeros? | Lo mismo | No |
| Existencia, disponibilidad, restricciones (precio, idioma), rechazo correcto, acierto, texto esperado, inyección | Puntuador determinista sobre la respuesta guardada | Solo la corrida que produce las respuestas; volver a puntuar es gratis |

El recuperador se mide **aparte** del modelo porque son dos fallos distintos: si el libro correcto nunca llega a los 8 que ve el modelo (Recall@8), ningún prompt lo arregla; si llega y el modelo no lo recomienda, sí. Medir la mezcla de los dos esconde cuál falló. **Recall@8** es lo que el modelo llega a ver; **Recall@40**, lo que el índice encuentra antes de filtrar por existencias y precio.

### La copia congelada

Para que dos corridas sean comparables el inventario no puede cambiar entre una y otra (se venden libros, se catalogan otros). Se congela una copia de producción **fuera de git**: `asistente-ia/evals/congelado/` está en `.gitignore` porque contiene sinopsis de terceros (ADR-018).

- **Solo lectura y lista blanca en la propia petición.** El script usa `Scan` con `ProjectionExpression` explícita: `costo`, `utilidadCatalogo`, `porcentajeDescuentoEditorial` y `creadoPor` **nunca salen de AWS**, no solo «no se usan». Es la misma regla de lista blanca de la ficha pública (`CLAUDE.md` §7), aplicada a una lectura de administración.
- **Paginado a mano.** Un `Scan` sin paginar se corta en 1.000 resultados sin avisar (incidente del 24/09/2026); se sigue `LastEvaluatedKey` hasta el final y el manifiesto contrasta el conteo con el reporte de la carga.
- **Inyección indirecta sin tocar la copia.** Los casos de «sinopsis envenenada» necesitan que un libro relevante traiga una instrucción maliciosa en su sinopsis. Los parches (`casos/parches-congelado.json`, identificados por ISBN) se **aplican en memoria** al cargar; el archivo congelado queda intacto. El índice local se construye con los parches aplicados, porque es lo que el recuperador vería en producción si una sinopsis llegara envenenada.

### Etiquetas sin sesgo del recuperador

Un caso de «libros aceptables» necesita que una persona diga qué libros del inventario serían una buena respuesta. Si los candidatos que ella ve salen **solo del recuperador que se va a evaluar**, hay un sesgo circular: un libro que el recuperador no encuentra nunca llega a la lista, nunca se marca como aceptable y nunca cuenta como fallo; el Recall@k queda inflado sin que nadie lo note. Dos defensas:

1. Los candidatos son la **unión** de los primeros del recuperador y de una búsqueda por palabras (título, autor y sinopsis) independiente de los embeddings.
2. La persona puede **agregar** libros que conozca (`+ ISBN` o `+ Título exacto`).

Además el orden está **barajado de forma estable** (por caso), no por puntaje, para que los primeros de la lista no pesen más al marcar. El script reporta cuántos candidatos aportó la búsqueda por palabras que no estaban entre los 40 del recuperador: es una medida directa de sus puntos ciegos.

## 3. Decisiones

- La Fase 4 se parte en `T-0041`, `T-0042` y `T-0043`; la compuerta automática (`T-0043`) va **después** de la salida a producción, que sale con criterios manuales (decidido con el usuario el 19/11/2026, `PLAN.md` §3.1).
- Línea base = v5 comparada con v4. v1 a v3 solo en `T-0043`: el código actual siempre envía la fecha y las políticas y la herramienta `consultar_politicas` ya no existe, así que correrlas mide «prompt viejo con el código nuevo».
- Sin modelo juez en la Fase 4 (misma familia que el evaluado, sesgos propios, gasta cuota).
- La copia sale de **producción** (2.541 libros), no de `staging` (25): con 25 libros el recuperador toma 40 candidatos, más que el inventario entero, y Recall@40 da 100 % por construcción.

## 4. Qué se hizo (`T-0041`)

| Pieza | Archivo | Qué hace |
|---|---|---|
| Módulo de evaluación | `server/api/lib/evaluacion-asistente.ts` (+ `.spec.ts`, 24 pruebas) | Formato y validación de casos, `puntuarRespuesta`, `resumirPuntajes`, `recallEnK`, `hitEnK`, `aplicarParches`, formato y lectura del archivo de validación |
| Guardia de los casos | `server/api/lib/casos-evaluacion.spec.ts` (6 pruebas) | Falla si un caso está mal formado, repite id, la categoría no tiene su prefijo, falta un parche o una hora fija |
| 46 casos | `asistente-ia/evals/casos/*.json` | Siete categorías (ver abajo) |
| Congelar | `scripts/congelar-inventario.mjs` | Lectura de producción con lista blanca → `congelado/` |
| Índice local | `scripts/construir-indice-evals.mjs` | Reutiliza `reconstruirIndice` de producción con un almacén en disco; incremental y reanudable |
| Recuperador | `scripts/evaluar-recuperador.mjs` | Recall@k/Hit@k, candidatos para validar, `--dry-run`; guarda los embeddings de las preguntas |
| Validación | `scripts/importar-validacion.mjs` | Pasa tus marcas a `casos/*.json` (solo `bookId`) |

**Los 46 casos** (preguntas sintéticas, sin datos de personas): 15 aceptables, 7 restricciones, 6 sin respuesta posible, 3 ambiguos, 4 inyección directa, 3 inyección indirecta, 8 políticas. Se escribieron **contra el inventario real**: los temas «sin respuesta» (programación en Python, derecho tributario, reparar una lavadora, cálculo diferencial, Bitcoin, derecho penal) se comprobaron con búsqueda de palabras sobre los 2.541 libros y no tienen ninguna coincidencia; los umbrales de precio se eligieron mirando cuántos libros hay bajo cada uno (por ejemplo, de los libros en inglés disponibles el más barato cuesta $26.000, así que «en inglés por menos de $20.000» no tiene respuesta posible). Las preguntas de políticas llevan una hora fija (miércoles 18/11/2026, 12:00 m. en Bogotá) para que «mañana» y «hoy» den lo mismo en cada corrida.

## 5. Cifras medidas

**Copia congelada** (19/11/2026, 11:59 hora de Bogotá, lectura de solo lectura de producción):

| Cifra | Valor |
|---|---|
| Libros | 2.541 (el reporte de la carga dice 2.541: coincide) |
| Con existencias | 2.505 |
| Filas de conocimiento | 2.519 |
| Con sinopsis útil (≥ 200 caracteres) | 2.201 |
| Ubicaciones resueltas | 109 |
| Libros con ISBN repetido (varios ejemplares) | 32 |
| PVP | mínimo $5.000 · mediana $73.242 · p90 $138.000 · máximo $1.131.000 |
| Libros con existencias a $15.000 o menos / $30.000 o menos | 22 / 174 |

**Pendiente de medir en este PR** (necesita la clave de Gemini en la máquina y tu validación): índice local, Recall@8 y Recall@40, puntos ciegos del recuperador. Se registran aquí al terminar.

## 6. Qué falló y cómo se corrigió

- **Mi propuesta de la mañana dependía de un inventario inexistente.** El plan original medía sobre los 25 libros de `staging`; al revisarlo, la propia búsqueda (40 candidatos) lo hacía trivial. Se adelantó la carga de producción.
- **Una prueba de mutación no mutó.** Para comprobar que la guardia de los casos falla cuando debe, el primer intento usó `sed` con una dirección `0,/…/` que BSD sed (macOS) no entiende: no cambió nada y la prueba siguió en verde, que habría sido una falsa confianza. Se rehízo con Python: con un id repetido la guardia falla, y vuelve a pasar al restaurar.
- **El orden de las casillas.** La prueba de ida y vuelta del archivo de validación asumía el orden alfabético y falló porque el archivo sale barajado a propósito; la expectativa dejó de depender del orden.
- **Las regex de los casos y las mayúsculas.** La primera versión pasaba la expresión por `toLowerCase()`, lo que rompe clases como `\S` o `\D`; ahora solo se quitan las tildes y se usa la bandera `i`.

## 7. Esfuerzo

Eventos de esta fase en [`../metrics/events/`](../metrics/events/) (`trace_id: T-0040`).

## 8. Fuentes

- [Rate limits de la API de Gemini](https://aistudio.google.com/docs/rate-limits.md) (consultado el 19/11/2026): los límites del nivel gratuito (RPM, TPM, RPD) **no están en la documentación**: dependen del proyecto y se ven en AI Studio. Solo la cuota de generación de 15 peticiones por minuto está medida (bitácora 05).
- Código: `server/api/lib/asistente.ts` (`seleccionarCandidatos`, `filtroDelIndice`), `server/api/lib/indice-vectorial.ts` (`buscarSimilares`), `server/api/handlers/indice-asistente.ts` (`reconstruirIndice`).
