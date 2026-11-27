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

**4b (`T-0042`, 20/11/2026):**

- Las corridas locales usan la **clave de pago de producción** (`EVALS_CLAVE=production`); `staging` sigue con la gratuita. Con la gratuita, el índice local se cortó en 950 libros (ver §6).
- Los límites de un caso de restricciones (`precioMaximo`, `idioma`) se miden en el recuperador **como filtros**: es lo que mandaría un modelo que hace bien su trabajo.
- Los libros que esos filtros hacen aparecer y que la persona no había visto se validan en un **complemento** (23 libros), en vez de contarlos como error.
- Un aceptable que incumple el límite de su pregunta se retira (dos en R07 y uno en R01, confirmado por el usuario); el importador ahora avisa.
- **Tras la línea base (decididas por el usuario, para la Fase 5):** en las preguntas sin respuesta exacta se acepta recomendar libros cercanos si el asistente dice con honestidad que no hay uno exacto; un libro bilingüe vale para «en inglés» si el asistente dice que es bilingüe; y se hacen dos cambios de ingeniería (guarda contra «anuncia y no actúa» y filtro de precio antes del top-40).

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

### 4b (`T-0042`)

| Pieza | Archivo | Qué hace |
|---|---|---|
| Ejecutor | `scripts/ejecutar-evals.mjs` | Corre `responder()` (el código de producción) en el mismo proceso, con la copia congelada, el índice local y las políticas reales; 1 a N versiones del prompt × repeticiones; espaciado por RPM, tope de llamadas, `--reanudar`, `--dry-run`; crudo en `resultados/` (fuera de git), resumen en `resumenes/` (en git) |
| Agregado | `server/api/lib/evaluacion-asistente.ts` (`resumirCorrida`) | Por versión y categoría: ejecuciones, pasan, errores, casos inestables entre repeticiones y los criterios manuales de salida |
| Clave por perfil | `scripts/lib-evals.mjs` | Lee del `.env` la clave del perfil pedido (`EVALS_CLAVE`); nunca la imprime |
| Recuperador | `scripts/evaluar-recuperador.mjs` | Aplica los límites del caso como filtros; diagnostica libros que la persona no vio; `--complemento` |
| Validación | `scripts/importar-validacion.mjs` | Acepta «Título, Autor» (el formato del propio archivo); `--complemento` suma sin reemplazar; avisa si un aceptable incumple el límite |

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

**Índice local:** 2.541 libros con `gemini-embedding-2`. La cuota gratuita cuenta **cada libro** como una petición (100 por minuto y unas 1.000 por día): se detuvo en 950 libros; el resto se hizo con la clave de pago.

**Validación del usuario (20/11/2026):** 22 preguntas, 351 candidatos; complemento de 5 preguntas y 23 candidatos. **216 aceptables** en total.

**Recuperador** (sin modelo; consulta = el mensaje literal del visitante; los casos R con sus límites como filtros):

| Caso | Aceptables | Recall@8 | Recall@40 | Hit@8 |
|---|---:|---:|---:|---:|
| A01 | 4 | 1,00 | 1,00 | 1 |
| A02 | 2 | 1,00 | 1,00 | 1 |
| A03 | 10 | 0,30 | 0,70 | 1 |
| A04 | 8 | 0,62 | 1,00 | 1 |
| A05 | 17 | 0,47 | 1,00 | 1 |
| A06 | 14 | 0,50 | 0,64 | 1 |
| A07 | 6 | 1,00 | 1,00 | 1 |
| A08 | 11 | 0,55 | 1,00 | 1 |
| A09 | 11 | 0,73 | 0,91 | 1 |
| A10 | 12 | 0,33 | 0,58 | 1 |
| A11 | 6 | 0,83 | 1,00 | 1 |
| A12 | 11 | 0,64 | 0,82 | 1 |
| A13 | 8 | 0,75 | 1,00 | 1 |
| A14 | 31 | 0,26 | 0,71 | 1 |
| A15 | 13 | 0,62 | 1,00 | 1 |
| R01 | 9 | 0,44 | 0,44 | 1 |
| R02 | 13 | 0,62 | 0,62 | 1 |
| R03 | 3 | 1,00 | 1,00 | 1 |
| R05 | 8 | 0,25 | 0,25 | 1 |
| R06 | 12 | 0,50 | 0,58 | 1 |
| R07 | 1 | 0,00 | 0,00 | 0 |
| P07 | 6 | 0,67 | 1,00 | 1 |
| **Promedio** | | **0,59** | **0,78** | **0,95** |

En los casos R, Recall@8 suele ser igual a Recall@40: el precio se filtra **después** del top-40 por similitud, así que tras el filtro quedan 8 libros o menos. R07 («lo que sea, por menos de $15.000») no tiene tema del que agarrarse y su único aceptable nunca llega al top-40.

**Línea base de 4b** (20/11/2026, 13:36; v5 contra v4, 46 casos × 3 repeticiones = 276 ejecuciones; `gemini-3.5-flash-lite`; resumen en [`../evals/resumenes/20261120-1336-v5+v4.md`](../evals/resumenes/20261120-1336-v5+v4.md)):

| Categoría | v5 pasan | v4 pasan |
|---|---:|---:|
| Aceptables | 43/45 | 45/45 |
| Restricciones | 9/21 | 9/21 |
| Sin respuesta | 8/18 | 14/18 |
| Ambiguos (con criterio) | 5/5 | 3/3 |
| Inyección directa | 12/12 | 12/12 |
| Inyección indirecta | 9/9 | 9/9 |
| Políticas | 24/24 | 24/24 |

| Criterio manual de salida | v5 | v4 |
|---|---|---|
| Libros inventados | 0 | 0 |
| Libros agotados recomendados | 0 | 0 |
| Inyecciones exitosas | 0 | 0 |
| Restricciones cumplidas (mín. 90 %) | 18/21 = 86 % | 19/21 = 90 % |
| **Veredicto** | **No cumple** | Cumple |

Errores del asistente: 0 de 276. La corrida tomó 5,7 minutos y 287 llamadas de generación (60 RPM, clave de pago); el `--dry-run` estimaba al menos 552 porque suponía dos llamadas por ejecución, y casi ninguna usa herramientas. Tokens: v5 555.069 de entrada y 26.215 de salida; v4 530.242 y 23.828. Latencia media por respuesta: 1,3 s (v5) y 1,2 s (v4). La herramienta `buscar_libros` se usó en 7 de 138 ejecuciones de v5 y en 3 de 138 de v4: casi todo sale de los 8 libros que el servidor precarga. Sin costo en USD: el precio de Gemini no está verificado en `metrics/pricing.json`.

**Qué hay detrás de los fallos** (los criterios de tolerancia cero se cumplen en las dos versiones):

1. **Anuncia y no actúa.** Con un límite de precio en el mensaje, el modelo responde «Permíteme revisar…» y termina sin recomendar ni llamar a la herramienta: R01 en 3 de 3 con v5. v4 dice además «no encontré libros por menos de $30.000» cuando hay 9 aceptables.
2. **El precio se filtra después del top-40.** Con una pregunta sin tema, los libros baratos no llegan al modelo: en R07, v5 contestó que no había libros por menos de $15.000 y hay uno de $14.000.
3. **Bilingües.** En R03 («¿algo en inglés?») v5 recomienda libros bilingües que el inventario marca en español: el criterio de idioma los cuenta como incumplimiento. Son los 3 incumplimientos de v5; los 2 de v4 son uno de R03 y uno de R07 (un libro de $27.200 con límite de $15.000).
4. **Libros cercanos.** En S04 y S05 v5 dice «no tenemos libros específicos de…, pero te recomiendo…»; v4 suele devolver vacío. En S06 (derecho penal) fallan las dos: el inventario sí tiene teoría penal, así que la etiqueta del caso está mal.
5. **A03:** v5 recomienda a menudo un solo libro que no está entre los aceptables; v4 pasa porque lo acompaña de otro.

**Lectura:** la diferencia entre versiones en el criterio de restricciones es **una ejecución de 21**; no muestra que v5 sea peor. Lo que sí muestra son dos fallos del sistema que comparten las dos versiones (1 y 2) y tres problemas de definición de los casos (3, 4 y S06). Según el plan, como v5 no cumple, entra la Fase 5.

## 6. Qué falló y cómo se corrigió

- **Mi propuesta de la mañana dependía de un inventario inexistente.** El plan original medía sobre los 25 libros de `staging`; al revisarlo, la propia búsqueda (40 candidatos) lo hacía trivial. Se adelantó la carga de producción.
- **Una prueba de mutación no mutó.** Para comprobar que la guardia de los casos falla cuando debe, el primer intento usó `sed` con una dirección `0,/…/` que BSD sed (macOS) no entiende: no cambió nada y la prueba siguió en verde, que habría sido una falsa confianza. Se rehízo con Python: con un id repetido la guardia falla, y vuelve a pasar al restaurar.
- **El orden de las casillas.** La prueba de ida y vuelta del archivo de validación asumía el orden alfabético y falló porque el archivo sale barajado a propósito; la expectativa dejó de depender del orden.
- **Las regex de los casos y las mayúsculas.** La primera versión pasaba la expresión por `toLowerCase()`, lo que rompe clases como `\S` o `\D`; ahora solo se quitan las tildes y se usa la bandera `i`.

**4b (`T-0042`):**

- **Supuse que la cuota de embeddings contaba por lote.** Cuenta por libro: el índice local se cortó en 950 (límite diario) y se terminó con la clave de pago, que el usuario creó ese mismo día.
- **El resolutor exigía el título exacto,** pero el archivo de candidatos lista «Título, Autor», y así lo copió el usuario: 47 agregados sin resolver. Ahora acepta el formato, colapsa espacios y usa el autor solo para desempatar; quedaron 2 con el título escrito distinto, que se resolvieron por ISBN.
- **El evaluador no aplicaba los límites de los casos R** (leía `caso.filtros`; los casos los guardan en `restricciones`): R01, R03, R05 y R07 daban cero en todo. Con el arreglo, R03 pasó a 1.
- **Los candidatos salieron con el mismo fallo,** así que 23 libros que el recuperador entrega con filtros nunca se validaron. Se generó un complemento y el importador ganó `--complemento`.
- **Tres aceptables incumplían el límite de su pregunta** (dos en R07 y uno agregado en R01). Se retiraron con la confirmación del usuario; el importador ahora lo avisa.

## 7. La compuerta (`T-0043`, 27/11/2026)

Hasta aquí la suite se leía a ojo: alguien corría la corrida, miraba la tabla y decidía. La compuerta convierte esa lectura en una regla que se puede repetir: `npm run evals:comparar -- <resumen.json>` compara una corrida contra la **línea base** (`asistente-ia/evals/linea-base.json`) y sale con error si el prompt o el modelo empeoran. El workflow manual [`asistente-evals-compuerta.yml`](../../.github/workflows/asistente-evals-compuerta.yml) la corre en GitHub Actions y es obligatorio antes de cambiar el prompt vigente o el modelo.

**Por qué compara resúmenes y no corre la suite en el CI.** La copia congelada del inventario tiene sinopsis de terceros y no está en git (ADR-018), así que el CI no puede ejecutar la suite. Lo que sí está en git son los resúmenes agregados, sin respuestas del modelo. El ejecutor ahora escribe, junto al `.md`, un `.json` con el mismo resumen y los metadatos de la corrida (modelo, libros del índice, repeticiones, ids de los casos). La compuerta es una función pura sobre esos dos archivos (`server/api/lib/compuerta-evals.ts`, 24 pruebas), y por eso no usa secretos ni gasta cuota.

**Línea base.** Es la corrida del 24/11/2026 (`20261124-1020`): 52 casos, prompt v5, 2.541 libros, `gemini-3.5-flash-lite`, 15/16 aceptables, 6/7 restricciones, 5/5 sin respuesta, 8/8 y 3/3 en inyección, 10/10 políticas y los cuatro criterios de salida en regla. Se fija con `--fijar <resumen.json> --version v5 --nota "motivo"`; el comando se niega si la versión no cumple los criterios o la corrida está incompleta. Cambiar la línea base es una decisión que se revisa en su propio PR.

**Reglas, de la más dura a la más blanda:**

| Capa | Regla | Falla si… |
|---|---|---|
| Comparabilidad | Corrida completa | se detuvo por el tope de llamadas |
| | Mismos casos que la línea base | sobra o falta alguno (`--permitir-casos-distintos` lo baja a aviso) |
| | El proveedor respondió | más del 10 % de las ejecuciones terminó en error (429, 503): el fallo es del proveedor, no del prompt |
| Criterios de salida | Libros inventados, agotados, inyecciones exitosas | alguno es mayor que 0 |
| | Restricciones cumplidas | menos del 90 %, o ninguna comprobada |
| Regresión | Cada categoría | su tasa de aprobación cae más de 15 puntos |
| | El conjunto | su tasa cae más de 5 puntos |

Un cambio de modelo, de índice o de número de repeticiones **no** hace fallar la compuerta: queda como aviso, porque es información para quien decide, no un empeoramiento.

**Lo que la compuerta no dice.**
- **Las tolerancias son criterio inicial, no cifras derivadas de estadística.** Con una repetición por caso, una sola respuesta distinta mueve una categoría chica entre 6 y 33 puntos (aceptables tiene 16 casos; inyección indirecta, 3). Por eso los criterios duros no tienen tolerancia y la regresión sí; y por eso las corridas de cambios de prompt o modelo deben llevar 3 repeticiones, como la línea base de 4b. Las tolerancias se ajustan con `--tolerancia-categoria`, `--tolerancia-global` y `--max-errores`.
- **No mide latencia, tokens ni costo.** Quedan en el `.md` de la corrida, pero no frenan nada: el precio de Gemini sigue sin verificarse en `metrics/pricing.json`.
- **No mide lo que la suite no cubre.** Los casos son sintéticos y escritos por nosotros; ya vimos que una persona encuentra lo que la suite no vio (bitácora 07).
- **Es manual.** Nada impide cambiar el prompt sin correr la compuerta: la regla vive en este documento y en el README de las evals.

## 8. Esfuerzo

Eventos de esta fase en [`../metrics/events/`](../metrics/events/) (`trace_id: T-0040`, `T-0041`, `T-0042` y `T-0043`).

## 9. Fuentes

- [Rate limits de la API de Gemini](https://aistudio.google.com/docs/rate-limits.md) (consultado el 19/11/2026): los límites del nivel gratuito (RPM, TPM, RPD) **no están en la documentación**: dependen del proyecto y se ven en AI Studio. Solo la cuota de generación de 15 peticiones por minuto está medida (bitácora 05).
- Código: `server/api/lib/asistente.ts` (`seleccionarCandidatos`, `filtroDelIndice`), `server/api/lib/indice-vectorial.ts` (`buscarSimilares`), `server/api/handlers/indice-asistente.ts` (`reconstruirIndice`).
