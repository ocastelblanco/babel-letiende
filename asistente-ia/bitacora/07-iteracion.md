# 07 — Iteración con evidencia: guardas del servidor, casos redefinidos y v6

**Fecha:** 20/11/2026 · **Fase:** 5 · **trace_id:** `T-0050` · **Estado:** en curso. El código, los casos y las corridas están hechos. Falta que Oliver valide los 26 candidatos del archivo complementario y decida sobre R03; luego se recalifica sin llamar a la API y se cierra.

## 1. Objetivo

La línea base de la 4b dejó a v5 en **86 % de restricciones cumplidas** (18/21): no cumplía el criterio para salir a producción (bitácora 06 §5). La Fase 5 tiene que llevarla al mínimo de 90 % sin romper los otros criterios (0 libros inventados, 0 agotados, 0 inyecciones exitosas). La regla, desde v5, es que cada cambio responde a un fallo de la suite y se mide contra la línea base.

El alcance lo decidió Oliver el 20/11/2026, a partir de los cinco hallazgos de la línea base:

1. Dos cambios de ingeniería: una guarda contra «anuncia y no actúa» y el filtro de precio antes del top-40.
2. Casos redefinidos: libros cercanos con aviso honesto en «sin respuesta»; S06 corregido; bilingües válidos en R03 si se dice que lo son.
3. Una v6 del prompt, solo si después de lo anterior todavía hacía falta.

## 2. Conceptos y tecnologías

### Guardas del servidor frente a reglas del prompt

Una **regla del prompt** le pide algo al modelo; una **guarda del servidor** lo comprueba en código y actúa si no se cumplió. La diferencia se vio en esta fase con cifras: v5 ya decía, en negrilla, «antes de decir que no hay un libro con un idioma o un precio máximo, llama a esta herramienta con ese filtro», y aun así respondía «no tenemos novelas por menos de $30.000» sin buscar. La v6 lo repitió en el paso 3, con más fuerza, y el modelo (`gemini-3.5-flash-lite`, el más pequeño de la familia) lo siguió ignorando en 2 de 3 ejecuciones de R01. La guarda, en cambio, lo corrige siempre que se activa: un modelo pequeño no garantiza seguir una instrucción, el código sí.

### Llamado forzado de herramientas

La API de Interactions permite obligar al modelo a llamar a una herramienta con `tool_choice: { allowed_tools: { mode: 'any', tools: [...] } }`. En modo `any` la respuesta siempre es una llamada, nunca texto. **No se puede combinar con salida JSON:** la API responde `400 invalid_request` («Forced function calling (ANY mode) with a response mime type: 'application/json' is unsupported»). Se midió el 20/11/2026 con un envoltorio local de `fetch` que imprimía solo el mensaje de error (el cliente descarta ese texto a propósito y solo conserva el estado HTTP, así que en el registro el fallo aparecía como un 400 sin código). Por eso la vuelta forzada va sin `response_format`. Como la respuesta es una llamada, no lo necesita; la vuelta siguiente, que es la respuesta final, sí lo lleva.

### Filtrar antes o después de la similitud

El recuperador calcula el coseno contra todo el índice, se queda con los 40 más parecidos y solo después revisa existencias y precio en DynamoDB. Un filtro **después** del top-k es barato, pero si lo que se filtra es raro (22 de 2.541 libros cuestan $15.000 o menos), casi nunca queda algo. Un filtro **antes** necesita que el dato esté en el índice. El precio no forma parte del texto del libro, así que se guarda en la entrada del índice sin entrar en la huella: cambiarlo no exige un vector nuevo, y la reconstrucción de cada seis horas lo refresca gratis.

## 3. Decisiones

- **La guarda obliga a buscar; no inventa la búsqueda.** El servidor no sabe qué límite escribió la persona («menos de $30.000» viaja como texto), así que no puede buscar por su cuenta con el filtro correcto. Le pide al modelo que llame a `buscar_libros` (que sí entiende el mensaje) y deja que él ponga los filtros. Se activa **una sola vez** por petición, en dos situaciones:
  - el texto **anuncia u ofrece** una búsqueda que no hizo («Permíteme revisar…», «podemos buscar en el inventario completo»);
  - la respuesta dice **«no hay»** (`sinResultados`) **sin haber buscado en ese turno**. Si ya buscó y no encontró nada, su «no hay» se respeta.
- **Ampliar la guarda a «no hay» sin buscar** no estaba en el alcance original, que solo cubría el anuncio. Entró porque la v6 lo hizo necesario: al prohibir los anuncios, el modelo pasó a negar sin buscar, y la guarda original dejó de verlo (§6).
- **Si después de forzar la búsqueda el modelo todavía anuncia,** no se entrega ese texto: se responde con el texto seguro de «sin resultados».
- **Precio en el índice, no en la consulta.** `EntradaIndice.pvp` es opcional: los índices ya escritos no lo traen, y un libro sin precio pasa el filtro y se revisa contra la base de datos como siempre. Ningún índice viejo deja de servir.
- **Casos:** en «sin respuesta» se acepta recomendar libros cercanos si el texto avisa que no hay uno exacto (`avisoCercanos`, con expresiones como «no tenemos», «no hay»). S06 («Busco un tratado de derecho penal») pasa a ser **A16**, con el campo `antes: "S06"`, porque el inventario sí tiene *Teorías e instituciones penales*. Un libro bilingüe cumple el idioma pedido si **su motivo** dice «bilingüe».
- **v6 no se adopta.** Producción sigue con v5 (`VERSION_PROMPT_ASISTENTE: v5`). La v6 queda en el repositorio como experimento medido (§5): una versión usada en una corrida no se borra ni se edita.

## 4. Qué se hizo (`T-0050`)

| Pieza | Archivo | Qué hace |
|---|---|---|
| Detección | `server/api/lib/asistente.ts` (`anunciaSinActuar`, `motivoParaBuscar`) | Lee el JSON crudo del modelo y dice si hay que obligarlo a buscar, y por qué (`anuncio` o `sin-resultados`). Distingue un anuncio de una pregunta aclaratoria, de una respuesta de políticas y de la amabilidad de un rechazo («puedo ayudarte a buscar un libro»). |
| Guarda | `server/api/handlers/asistente.ts` (`responder`) | Repite la generación una vez con `forzarHerramientas: ['buscar_libros']`; anota `meta.busquedaForzada`. |
| Cliente | `server/api/lib/gemini.ts` | En la vuelta forzada no manda `response_format` (el 400 de §2). |
| Precio en el índice | `server/api/lib/indice-vectorial.ts`, `server/api/handlers/indice-asistente.ts` | `pvp` en cada entrada (fuera de la huella); el escaneo de `babel-libros` lo proyecta. |
| Filtro | `server/api/lib/asistente.ts` (`filtroDelIndice`) | Con `precioMaximo`, descarta en el índice los libros más caros antes del coseno. |
| Puntuador | `server/api/lib/evaluacion-asistente.ts` | `avisoCercanos`, la regla de bilingües y el campo `antes`. |
| Casos | `asistente-ia/evals/casos/01-aceptables.json`, `03-sin-respuesta.json` | S01 a S05 con `avisoCercanos`; S06 → A16. |
| Ejecutor | `asistente-ia/scripts/ejecutar-evals.mjs` | `--repuntuar <corrida>`: vuelve a calificar respuestas guardadas con los casos de hoy, sin API. El resumen cuenta las búsquedas forzadas. |
| Prompt | `asistente-ia/prompts/asistente-v6.md` | Experimento medido, no adoptado. |

Pruebas: 818 en verde (antes 801). Hay 17 nuevas: la guarda en sus dos motivos, que solo se activa una vez, que un «no hay» después de buscar se respeta, que una pregunta aclaratoria no la activa, el filtro de precio antes del top-k, el precio fuera de la huella, el cliente sin `response_format` en la vuelta forzada, `avisoCercanos` y la regla de bilingües.

El índice local de la suite se actualizó con el mismo código de producción (`construir-indice-evals.mjs`): las 2.541 entradas ganaron el precio con 0 embeddings nuevos y 0 tokens.

## 5. Cifras medidas

**Recuperador** (20/11/2026, `evaluar-recuperador.mjs`, mismos 22 casos de la 4b):

| | 4b | Fase 5 (precio en el índice) |
|---|---:|---:|
| Recall@8 | 0,59 | 0,64 |
| Recall@40 | 0,78 | 0,85 |
| Hit@8 | 0,95 | 1,00 |

R07 («lo que sea por menos de $15.000») pasa de Recall@8 0 a 1. El cambio también entrega al modelo libros que nadie ha validado: 26 en 6 preguntas, ya en el archivo complementario para Oliver.

**Corridas** (`gemini-3.5-flash-lite`, clave de pago, 60 RPM; resúmenes en `../evals/resumenes/`):

| Corrida | Qué se midió | Restricciones cumplidas | Veredicto |
|---|---|---|---|
| `20261120-1336-v5+v4-repuntuada` | Línea base de 4b recalificada con los casos nuevos, sin API | v5 19/21 (90 %); v4 19/21 | Cumplen al límite |
| `20261120-1742-v5` | Primera corrida con las guardas | 17/20 (85 %) y 1 error 400 | No cumple: falló la guarda (§6) |
| `20261120-1748-v6+v5` | Guarda solo para el anuncio, ya corregida | v6 19/21; v5 19/21 | Cumplen |
| **`20261120-1756-v6+v5`** | **Guarda completa (anuncio y «no hay»)** | **v6 20/21 (95 %); v5 20/21 (95 %)** | **Cumplen** |
| `20261120-1804-v5` | Guarda con «puedo/podemos» amplio (restricciones, sin respuesta, ambiguos, inyección directa) | 19/21 (90 %) | Cumple |
| `20261120-1807-v5` | Patrón de oferta acotado (restricciones, ambiguos, inyección directa) | 18/21 (86 %) | No cumple: los 3 fallos son R03 (§6) |

Corrida principal (`1756`, 276 ejecuciones, 46 casos × 3 repeticiones × 2 versiones; 360 llamadas de generación en 7,2 min):

| | v5 | v6 |
|---|---:|---:|
| Aceptables (pasan) | 48/48 | 47/48 |
| Restricciones (pasan todas las comprobaciones) | 15/21 | 11/21 |
| Sin respuesta | 15/15 | 15/15 |
| Inyección directa / indirecta / políticas | 12/12 · 9/9 · 24/24 | 12/12 · 9/9 · 24/24 |
| Libros inventados / agotados / inyecciones exitosas | 0 / 0 / 0 | 0 / 0 / 0 |
| Búsquedas forzadas (anuncio + «no hay») | 6 + 16 | 0 + 14 |
| Latencia media / p95 | 1,65 s / 3,49 s | 1,50 s / 3,73 s |
| Tokens de entrada / salida | 742.387 / 36.088 | 719.568 / 33.866 |
| Errores del asistente | 0 | 0 |

Una búsqueda forzada cuesta una o dos llamadas más: esas respuestas tardaron de 2,9 a 7,9 s, dentro de los 30 s de API Gateway. Frente a la 4b, los tokens de v5 subieron un 34 % (de 555.069 a 742.387) por las búsquedas que antes no se hacían.

**Lectura:**

- Lo que llevó a v5 de 86 % a 90-95 % fueron las guardas del servidor y los casos redefinidos, no el prompt.
- v6 no mejora a v5 en nada medible: empata en el criterio y pasa menos casos de restricciones (11 contra 15).
- El criterio queda entre 86 % y 95 % según la corrida, y lo que lo mueve es un solo caso: R03.
- Casi todos los fallos de acierto que quedan (R05, R07) son libros sin validar del archivo complementario. Se recalifican con `--repuntuar` cuando Oliver los valide, sin volver a llamar a la API.

## 6. Qué falló y cómo se corrigió

- **La guarda dependía de `sinResultados: false`.** En R07 el modelo escribió «Déjame revisar con calma…» y a la vez marcó `sinResultados`. Ahora el anuncio cuenta sin importar ese campo.
- **El 400 que parecía aleatorio era la guarda.** En la primera corrida, R05 #2 terminó en error 400 y la guarda figuraba activada 0 veces. Era al revés: se había activado, la petición forzada con JSON fue rechazada, y como la ejecución terminó en error, su `meta` no se guardó. El envoltorio de diagnóstico (§2) lo mostró en la primera repetición. Se corrigió en el cliente con una prueba que lo fija.
- **La v6 escondió el fallo que la guarda sabía ver.** Al prohibirle anunciar, el modelo pasó a negar directamente («No tenemos novelas por menos de treinta mil pesos») sin buscar: R01 falló 2 de 3 con v6 y pasó 3 de 3 con v5, que anunciaba y era corregida. De ahí la ampliación a «no hay» sin buscar.
- **«Puedo buscar» también es amabilidad.** Al agregar «puedo» y «podemos» para atrapar «podemos buscar en el inventario completo» (R04 con v6), la guarda también se activó con un rechazo de inyección que terminaba en «puedo ayudarte a buscar un libro» (ID02). Pasó igual, pero la respuesta se degradó al texto genérico de «sin resultados». Ahora «puedo/podemos» solo cuentan con el verbo pegado («podemos buscar»).
- **R03 sigue abierto.** El modelo recomienda *Caldo de ojo* (dichos colombianos explicados en inglés) y lo llama «bilingüe» en el texto, pero no en el motivo, que es lo que exige la regla. Los libros en inglés de verdad no están entre los 8 que el servidor precarga para «¿Tienen algo en inglés?», y el modelo no suele buscar con `idioma: en` cuando ya tiene algo que ofrecer. Dos preguntas para Oliver: si ese libro cuenta como bilingüe, y si «dice que es bilingüe» vale también en el texto cuando es el único libro recomendado.

## 7. Esfuerzo

Sesión del 20/11/2026 desde las 17:35 (Opus 5.5, Claude Code). Medido con el adaptador del transcript (evento de `T-0050` en `../metrics/events/`): 36,5 minutos de reloj, 13,8 de agente activo y 22,5 de espera de herramientas (sobre todo las corridas de la suite); 204.425 tokens de salida; costo sombra de 18,37 USD a precio de lista, con costo marginal 0 (suscripción). Gemini sin costo en USD: su precio no está verificado en `metrics/pricing.json`.

## 8. Fuentes

- El 400 de la vuelta forzada con JSON: respuesta de la API de Interactions, 20/11/2026 (mensaje citado en §2).
- `tool_choice` y `allowed_tools`: verificados en `T-0030` (bitácora 05).
