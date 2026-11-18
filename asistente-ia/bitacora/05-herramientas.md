# 05 — Llamado de herramientas: contrato verificado, validación de argumentos y bucle acotado

**Fecha:** 18/11/2026 · **Fase:** 3 · **trace_id:** `T-0030` · **Estado:** implementado, PR abierto

## 1. Objetivo

Que el modelo pueda **pedir datos en vivo** (buscar libros con filtros que él mismo extrae de lo que dice la persona, consultar existencias y ubicación física, consultar las políticas de la librería) sin que eso abra una puerta a datos internos ni vuelva impredecible la latencia ni el costo. La capacidad que demuestra es la integración de un modelo con sistemas reales: declaración de herramientas, validación de lo que el modelo envía, tope de rondas y respuesta definida cuando una herramienta falla.

## 2. Conceptos y tecnologías

### Cómo funciona el llamado de herramientas en la Interactions API (verificado contra la API real)

La documentación se leyó solo en parte y no decía varias cosas que el cliente necesita saber, así que se escribió `asistente-ia/scripts/verificar-herramientas-gemini.mjs` y se corrió en GitHub Actions con la clave de `staging` (solo textos y herramientas sintéticos). Lo que mostró:

| Pregunta | Resultado medido |
|---|---|
| ¿Cómo se declara una herramienta? | Plana, en `tools`: `{type:'function', name, description, parameters}` (JSON Schema). Sin envoltorio `function_declarations`. |
| ¿Cómo avisa el modelo que quiere una herramienta? | La interacción queda en `status: requires_action` con pasos `thought` + uno o más `function_call` de campos `id`, `type`, `name`, `arguments` (**objeto**, no texto). |
| ¿Qué hay que devolver? | Un paso `{type:'function_result', name, call_id, result}` por llamada. Sin estado (`store:false`) se reenvía todo: el mensaje de la persona, los pasos del modelo y los resultados. |
| ¿Forma del `result`? | **Lista de partes de texto** `[{type:'text', text}]`. Con un texto plano o un objeto la API responde 200 pero el modelo **no lo toma** y vuelve a pedir la herramienta (un bucle silencioso que cuesta tokens y tiempo). |
| ¿Hay que reenviar el pensamiento? | **Sí.** Omitir el paso `thought` (o reenviar solo el `function_call`) da `400 Request contains an invalid argument`. Se reenvían todos los pasos de la vuelta, tal cual llegaron. |
| ¿Se puede combinar con salida JSON con esquema? | Sí: herramientas + `response_format` en la misma petición. La respuesta final cumple el esquema. También funciona la vuelta final **sin** `tools` con la historia de la llamada dentro. |
| ¿Se puede forzar una llamada? | Sí: `generation_config.tool_choice.allowed_tools = {mode:'any', tools:[...]}`. Sin eso, un saludo no dispara ninguna herramienta. |
| ¿Llamadas en paralelo? | Sí: varios `function_call` en una misma vuelta, con `id` distintos; se devuelven todos los resultados en una sola petición. |
| ¿Qué pasa si la herramienta falla? | Se devuelve el error como resultado y el modelo responde con honestidad con lo que tiene. |
| ¿Respeta el esquema de argumentos? | **No siempre.** Con una petición enredada ('baratos, «doce mil pesos», en francés') omitió el parámetro **obligatorio** `consulta`. |

Lo último es el hallazgo de seguridad más importante de la fase: **el esquema declarado orienta al modelo pero no lo obliga**; los argumentos llegan del modelo (que a su vez lee texto no confiable) y se validan en el servidor, herramienta por herramienta, como cualquier entrada externa.

### Un cliente que no conoce la forma de ningún proveedor

`ProveedorLlm` (ADR-015) se amplió con tres conceptos neutrales: `DeclaracionHerramienta` (nombre, descripción, JSON Schema), `LlamadaHerramienta` (id, nombre, argumentos) y `RondaHerramientas`. Los pasos que devuelve el modelo (`pasosDelModelo`) son **opacos** para el orquestador: se guardan y se devuelven sin tocarlos, porque el proveedor exige reenviarlos completos (con el razonamiento interno). Todo lo específico de Gemini (`function_result`, `call_id`, lista de partes) vive en `gemini.ts`. Un efecto lateral corregido: una interacción en `requires_action` no trae texto, y antes se habría tratado como «bloqueada por seguridad».

### Recuperación primero, herramientas de apoyo

El diseño del plan era `buscar_libros` como herramienta. Medido contra la API real, cada llamada al modelo tarda de **5 a 13 s** (y hasta 38 s con reintentos por `503`) desde un ejecutor de GitHub, con la clave gratuita de `staging`. Si la búsqueda fuera solo una herramienta, **toda** pregunta costaría como mínimo dos llamadas al modelo (pedir → responder): entre 10 y 26 s, contra un límite duro de 30 s de API Gateway. Por eso el flujo conserva la búsqueda inicial de `T-0023` (la primera generación ya recibe los libros) y las herramientas entran solo cuando hacen falta:

- `buscar_libros`: cuando la persona cambia de tema o pide filtros que la búsqueda inicial no aplicó. Aquí es el **modelo** quien extrae «hasta $40.000» o «en inglés» del texto, algo que `T-0023` dejaba al cliente.
- `consultar_disponibilidad`: existencias, precio y **Espacio/Mueble/Ubicación** (dato nuevo; la ficha pública ya lo muestra).
- ~~`consultar_politicas`~~ (eliminada en v4, ver §6): horarios, pagos, cambios y envíos pasaron a ir siempre en el contexto, desde `asistente-ia/conocimiento/politicas-libreria.md` (contenido de Oliver). Un tema que falte en el archivo hace que el asistente diga con honestidad que no tiene el dato.

El caso normal sigue siendo **una** llamada al modelo; solo una pregunta que necesita un dato en vivo paga la segunda.

### Bucle acotado

- Máximo 3 vueltas de herramientas; después, la última llamada **no ofrece herramientas** (verificado: funciona con la historia dentro), así que el modelo está obligado a cerrar con texto.
- Máximo 4 llamadas ejecutadas por vuelta; las demás reciben un error controlado (cada `function_call` necesita su respuesta).
- Presupuesto de tiempo: si ya pasaron 14 s no se ofrece otra vuelta de herramientas; si pasaron 18 s no se hace otra llamada y se responde con un aviso de demora (`meta.tiempoAgotado`).
- Una herramienta nunca lanza hacia el modelo: argumentos inválidos → `{error}` con la causa (el modelo puede corregirse); fallo interno → mensaje genérico (sin detalle) y se cuenta en `meta.fallosHerramientas`.

### Qué puede recomendar el modelo

Solo libros que **vio con existencias** en esta petición: los de la búsqueda inicial o los que devolvió `buscar_libros`. `consultar_disponibilidad` informa pero no habilita: el modelo no puede «adivinar» un `bookId` y hacerlo recomendable preguntando por él. El validador de `T-0023` sigue siendo la barrera final.

## 3. Decisiones

- **Prompt v2 (`herramientas: true`), v1 intacto.** Una versión usada no se edita. El encabezado del archivo decide si se ofrecen herramientas, así v1 (sin herramientas) y v2 son comparables en la Fase 4 sin cambiar código.
- **Las políticas viven en un archivo del repositorio**, no en una tabla: es texto que cambia poco, se revisa en un PR y viaja empaquetado. Un tema con solo comentarios cuenta como vacío (no se ofrece).
- **Lista blanca de salida.** Lo que ve el modelo de cada libro: `bookId`, título, autor, categorías, idioma, precio, sinopsis (recortada); de disponibilidad: precio, existencias, ubicación. Nunca `costo`, `utilidad`, descuentos editoriales ni quién catalogó (hay una prueba con un libro que trae esos campos).
- **Permisos mínimos:** la Lambda gana `GetItem` sobre ubicaciones, muebles y espacios (para decir dónde está un libro). Sigue sin escribir en nada.

## 4. Qué se hizo

- `proveedor-llm.ts` / `gemini.ts`: herramientas, rondas, `tool_choice`, llamadas parseadas con validación de forma (id y nombre obligatorios, argumentos que no sean objeto = vacíos).
- `server/api/lib/herramientas-asistente.ts`: declaraciones, `validarLlamada` por herramienta, intérprete y buscador de políticas.
- `server/api/handlers/asistente.ts`: `responder` con el bucle, `buscarCandidatos` compartido entre la búsqueda inicial y `buscar_libros`, ejecución sin excepciones.
- `asistente-ia/prompts/asistente-v2.md` y `asistente-v3.md` (las que se probaron primero), `asistente-v4.md` (políticas siempre en el contexto), `CHANGELOG.md`, `asistente-ia/conocimiento/politicas-libreria.md` (completada por Oliver).
- `server/api/lib/asistente.ts`: `momentoActualParaModelo` y el bloque `FECHA_Y_HORA_ACTUAL` en el último turno.
- `serverless.yml`: tablas de ubicación, módulo nuevo y archivo de políticas en `package.patterns`, prompt v4 en `staging`.
- Pruebas: 61 nuevas (752 en total): validación de cada herramienta (incluido el caso real del parámetro omitido), políticas, ejecución con lista blanca, errores controlados, tope de rondas y de llamadas, presupuesto de tiempo, tokens acumulados, y que una herramienta no vuelva recomendable un libro no visto. Una mutación (quitar la línea que habilita los libros hallados por `buscar_libros`) hace fallar exactamente la prueba esperada.
- Verificación real: el script de verificación del cliente ejercita ahora el ciclo completo con la clase `ProveedorGemini`.

## 5. Cifras medidas

**Contrato y operación (verificación contra la API real, clave gratuita, 18/11/2026)**

- Latencia por llamada al modelo: 5 a 13 s; picos de 25 a 38 s con `503` y reintentos.
- Límite de la clave gratuita de `staging`: **15 peticiones por minuto**; el primer intento del script lo superó y recibió `429`. El script ahora deja 5 s entre llamadas y reintenta.
- `503 service unavailable` transitorios: aparecieron en varias llamadas seguidas ese día, incluida una en la verificación del cliente real.
- Consumo de una vuelta con herramientas: 223 tokens de entrada y 37 de salida para pedir una herramienta; ~250 caracteres en la respuesta final.

**Prueba funcional en `staging` con el prompt v2 (Oliver, 18/11/2026, `gemini-3.5-flash-lite`, 5 preguntas)**

| Pregunta | Herramienta usada | Latencia | Resultado |
|---|---|---|---|
| «¿Dónde encuentro *El camino de Ida* y cuántos quedan?» | `consultar_disponibilidad` | 3,5 s | Correcto: existencias y Espacio/Mueble/Ubicación reales (6.852 tokens de entrada) |
| «¿A qué horas abren?» | `consultar_politicas` | 2,5 s | Correcto: horarios tomados de `politicas-libreria.md` |
| «Ahora recomiéndame algo en inglés por menos de $20.000» | ninguna | 1,7 s | **Fallo de criterio:** dijo que no había nada sin llamar a `buscar_libros` con los filtros (la lista inicial no los aplica) |
| «Quiero un libro de Roberto Bolaño… dame el precio y dónde lo puedo encontrar» | ninguna | 2,4 s | **Fallo de criterio:** recomendó *Cuentos completos* pero no dio el precio ni la ubicación: «acércate a la librería» |
| «¿Abren mañana? ¿en qué horario?» | `consultar_politicas` | 2,4 s | **Falso:** dijo «mañana abrimos de 2:00 p.m. a 8:00 p.m.» cuando mañana era jueves (2:00 p.m. a 10:00 p.m.) |

- 0 fallos de herramientas y 0 recomendaciones descartadas en las cinco. Latencia total de 1,7 a 3,5 s con una sola ronda: muy por debajo de los 30 s de API Gateway.
- Con herramienta, la entrada pesa ~6.800 tokens frente a ~3.300 sin ella, porque la segunda llamada repite la conversación y el resultado.
- Además de lo anterior, una respuesta usó voseo («mirá») y diminutivos («pesitos», «momentico»), contra la regla del prompt de hablar «siempre de tú».

**Segunda prueba en `staging` con el prompt v3 (Oliver, 18/11/2026)**

| Pregunta | Herramientas | Latencia | Resultado |
|---|---|---|---|
| «Recomiéndame algo en inglés por menos de $20.000» | `buscar_libros` | 4,2 s | **Correcto:** buscó con los filtros y respondió que no hay. Verificado contra los datos: `staging` tiene 25 libros con conocimiento y uno solo en inglés (*Treasure Island*, $60.000) |
| Bolaño: recomendación, precio y cómo llegar | `consultar_disponibilidad`, `consultar_politicas` ×2 | 4,0 s (3 rondas, 15.214 tokens de entrada) | **Correcto:** precio $89.000, «Terraza, exhibidor 1, estante 1» y dirección. Gastó las 3 rondas permitidas |
| «¿Abren mañana? ¿en qué horario?» (1.ª vez) | — | — | **502** `No pude preparar una recomendación…`: el registro decía solo `Error` |
| «¿Abren mañana? ¿en qué horario?» (2.ª vez) | ninguna (0 rondas) | 3,5 s | **Alucinó:** «Mañana jueves estamos abiertos de nueve de la mañana a ocho de la noche» (real: 2 p. m. a 10 p. m.). Sí usó bien el día (jueves), pero no consultó las políticas |

## 6. Qué falló y cómo se corrigió

- **Primer intento de la verificación: `429`.** Mi script llamaba a la API a ritmo de prueba unitaria contra una clave de 15 por minuto. Se agregó pausa entre llamadas y reintento tras `429`/`5xx`.
- **Los `503` hicieron fallar dos veces el script y una el cliente real.** No eran del código: eran del servicio. Es una advertencia operativa para producción (el cliente ya reintenta 5xx; la interfaz tendrá que tolerar un «inténtalo de nuevo»).
- **El resultado de una herramienta como texto plano o como objeto no daba error, daba un bucle.** Lo habría detectado tarde (más latencia y más costo) de no haberlo probado con la API real.
- **«¿Abren mañana?» se respondió con el horario equivocado (staging, v2).** El modelo recibía las políticas correctas, pero ningún dato sobre qué día era, así que adivinó. No se arregla con prompt: un modelo no tiene reloj. El servidor calcula el día y la hora de Bogotá (UTC-5 fijo) y los pone, junto con el día de mañana ya calculado, en el último turno de la persona (`FECHA_Y_HORA_ACTUAL`, `momentoActualParaModelo`); el día de mañana se entrega calculado porque un modelo pequeño falla en la aritmética de fechas.
- **No buscó con filtros antes de decir «no hay» (v2).** La búsqueda inicial no aplica idioma ni precio si la persona los pide en el texto, así que «no hay nada en inglés por menos de $20.000» se decidió sobre una lista que nunca se filtró. Es un criterio de uso de herramientas, y el modelo lo omitió porque v2 decía «úsalas solo cuando hagan falta». v3 dice explícitamente que antes de afirmar que no hay un libro con un idioma o un precio máximo debe llamar a `buscar_libros` con ese filtro.
- **No consultó precio ni ubicación cuando se los pidieron (v2).** v3 exige `consultar_disponibilidad` siempre que pregunten por precio, existencias o dónde está, aunque el libro ya esté en la lista.
- **Voseo y diminutivos (v2).** v3 lo prohíbe de forma explícita. Es la primera observación del estilo, de la que se ocupará la Fase 5 con la evaluación.
- **Por qué v3 y no editar v2:** v2 es lo que se probó en `staging`; cambiarlo sin cambiar el número dejaría esta tabla sin una versión a la que atribuirla. La Fase 4 compara v1, v2 y v3 con la misma suite.
- **v3 acertó en tres de cuatro y falló en lo peor: inventó un horario.** Con `consultar_politicas` como herramienta, el prompt decía «siempre», y aun así una de las dos veces el modelo respondió sin consultarla (rondas: 0). Con 2 muestras no se puede medir una tasa, pero no hace falta: un horario falso le cuesta una visita en vano a una persona, y las políticas son unas pocas líneas (~300 tokens). **Decisión:** las políticas dejan de ser una herramienta y viajan SIEMPRE en el último turno (`POLITICAS_DE_LA_LIBRERIA`, `politicasParaModelo`). Es el mismo principio de «recuperación primero» que ya se usa para los libros, en su versión más simple porque el corpus es diminuto: no hay nada que recuperar, solo que dejar de depender de que el modelo decida mirarlo. `consultar_politicas`, `buscarPolitica` y su validación se eliminaron; v4 reemplaza a v3. Efecto colateral: la pregunta de Bolaño ya no gasta dos rondas en políticas.
- **El 502 no se pudo diagnosticar, y eso también fue un fallo.** El registro decía `fallo del modelo Error` porque `ErrorRespuestaInvalida` no definía su `name`; el único dato útil era que no tenía código HTTP, es decir, el modelo contestó pero con una respuesta que el validador rechazó (no JSON, cortada por el límite de tokens, o pidiendo herramientas cuando ya no se le ofrecían). Cambios: el error ahora tiene nombre y motivo fijo en el registro (sin texto de la persona); el límite de tokens de salida sube de 1024 a 2048 (el pensamiento cuenta dentro del tope); y si la respuesta final es inválida se pide **una sola vez más** (`meta.reintentoFinal`), porque ese tipo de fallo suele no repetirse. Sigue sin saberse cuál de las tres causas fue; con el nuevo registro, la próxima vez se sabrá.
- **Una prueba del prompt contra el modelo real.** `verificar-prompt-gemini.mjs` (workflow de Gemini) usa el prompt vigente con el contexto exacto que arma la Lambda y repite 3 veces el caso del horario del jueves, el del domingo y un tema que no está en las políticas. Es una alarma barata, no la suite de la Fase 4.
- **Pendiente:** que Oliver repita los casos con v4 en `staging`.

## 7. Esfuerzo

Ver `../metrics/events/` (`trace_id: T-0030`) y la fila de `tracking-detail.csv`.

## 8. Fuentes

- Documentación de llamado de funciones de la Gemini API (`aistudio.google.com/docs/function-calling.md`, consultada el 18/11/2026; solo se pudo leer en parte, de ahí la verificación contra la API real).
- OWASP Top 10: A01 (control de acceso: lista blanca), A03 (inyección: datos no instrucciones), A04/A05 (límites y configuración), A08 (validación de lo que produce un componente externo).
