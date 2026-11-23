# 08 · Operación segura (Fase 6, `T-0060`)

> **Estado:** en curso. Parte 1 (control de gasto y de tasa) hecha, fusionada y desplegada el sábado 21/11/2026, antes de lo previsto. Parte 2 (registros con enmascarado) hecha y verificada en `staging` el lunes 23/11/2026. Queda la parte 3: reintentos ante Gemini saturado, validador de fidelidad, límite en API Gateway y revisión OWASP.

## 1. Por qué existe

Un chat público con una clave que cobra por token necesita tres frenos antes de abrirse: poder apagarlo sin desplegar, un techo de gasto diario y un techo de uso por persona. Hoy el endpoint es solo para el personal; esto deja el mecanismo listo y probado para las fases 7 y 8.

## 2. Qué se hizo

- **Tabla `babel-asistente-control`** (DynamoDB, bajo demanda, TTL en `expiraEn`). Cuatro tipos de ítem, todos por clave de texto: `interruptor`, `gasto#<día>`, `visitante#<día>#<hash>` y `sal#<día>`. El día es el de Bogotá.
- **Interruptor en dos capas.** El entorno (`ASISTENTE_ACTIVO`) sigue mandando; además, un ítem `interruptor` con `activo: false` apaga el asistente sin desplegar. La pantalla para moverlo llega con la Fase 8.
- **Tope de gasto diario.** Después de cada respuesta se suma su costo estimado al ítem del día (`ADD` atómico); antes de cada una se lee el total y, si llegó al tope, responde 503 sin llamar a Gemini. La lectura y la suma no son una sola operación, así que con peticiones simultáneas el tope puede pasarse por el costo de unas pocas respuestas (centavos). Se aceptó a propósito: reservar el costo por adelantado exigiría estimarlo antes de saberlo.
- **Tope por visitante.** 30 mensajes por día. El contador sube antes de responder con una condición en la misma escritura (`attribute_not_exists OR < tope`), de modo que dos peticiones simultáneas no pueden pasarse. Al llegar, 429.
- **Visitante anónimo.** No se guarda la IP. Se calcula `sha256(sal + "|" + ip)` con una sal aleatoria de 16 bytes que se crea una vez al día (`PutItem` condicional; si dos peticiones la crean a la vez gana una y la otra la lee) y caduca a los 3 días. El mismo visitante se cuenta junto durante el día y no se puede cruzar entre días.
- **Falla cerrada.** Si la tabla no responde o no está configurada, el endpoint responde 503: sin poder verificar el tope no se gasta.
- **El costo no sale al cliente.** `meta.costoMicroUsd` queda en el registro de la Lambda y en el gasto del día, pero se quita de la respuesta HTTP. Queda pendiente decidir, en la revisión OWASP de la parte 3, qué más de `meta` (tokens, herramientas) debe salir cuando el endpoint sea público.

## 3. Tarifa verificada

Leída de la página oficial de precios de Gemini el 21/11/2026 (`https://ai.google.dev/gemini-api/docs/pricing`), nivel de pago estándar, USD por millón de tokens:

| Concepto | Modelo | Precio |
|---|---|---:|
| Entrada | `gemini-3.5-flash-lite` | 0,30 |
| Salida (incluye el pensamiento) | `gemini-3.5-flash-lite` | 2,50 |
| Embeddings, texto | `gemini-embedding-2` | 0,20 |

Como son USD por millón de tokens, tokens × tarifa da micro-USD exactos. Una respuesta típica (4.000 tokens de entrada, 300 de salida, 20 de embeddings) cuesta unos 1.954 micro-USD, es decir, 0,002 USD. **Medido el 21/11/2026 en `staging`:** dos respuestas sin libros que recomendar costaron 9.485 micro-USD en total, unos 0,0047 USD cada una, el doble de la estimación: con 1 USD al día caben unas 210 respuestas, y con 3 USD (producción) unas 630. Se revisa con tráfico real. La tarifa vive en `server/api/lib/control-asistente.ts`; si cambia el modelo o el precio, se corrige ahí. **No se tocó `metrics/pricing.json`**: sigue marcando a Gemini como no verificado para el registro de esfuerzo, y ese es un cambio que decide el usuario.

## 4. Decisiones que quedan para el usuario

- Los topes iniciales son **1 USD/día en `staging`, 3 USD/día en producción y 30 mensajes por visitante y día**. Son una propuesta; se cambian en `serverless.yml` (`asistenteTopeDiarioUsd`, `asistenteMensajesPorVisitante`).
- Si la tarifa verificada debe pasar a `metrics/pricing.json` (y con ella el costo en USD del registro de esfuerzo).

## 5. Verificación

- 908 pruebas de backend en verde (40 nuevas): el contador con tope, el TTL que se fija una sola vez, la sal creada a la vez por dos peticiones, el cambio de día, el interruptor, el tope de gasto, el 429, la falla cerrada, que la IP no aparezca en ninguna clave ni valor, y que el costo no salga al cliente.
- `serverless package --stage staging`: `control-asistente.js` va dentro de `asistente.zip` y el handler carga desde el paquete (regla de `CLAUDE.md` §7).
- **Comprobado en `staging` el 21/11/2026** con dos preguntas reales: se crearon `gasto#` (9.485 µUSD), `visitante#` (`mensajes` = 2) y `sal#`, los tres con TTL a 3 días, y la respuesta no trae el costo. Producción desplegó el mismo día con la tabla vacía y el asistente apagado.

## 6. Parte 2 — registros de turnos (23/11/2026)

Cada respuesta del asistente deja un ítem en **`babel-asistente-registros`** (DynamoDB, bajo demanda, clave `registroId`, TTL `expiraEn` a **90 días**). Sirve para medir (costo, latencia, libros propuestos, banderas) y para revisar fallos; no para espiar.

**Qué se guarda:** el último mensaje de la persona **enmascarado y recortado a 500 caracteres**, cuántos mensajes lleva la conversación, los `bookId` propuestos, las herramientas llamadas, modelo y versión del prompt, latencia, tokens y costo estimado, y las banderas (`sinResultados`, `bloqueado`, `sospechaInyeccion`, `tiempoAgotado`, `reintentoFinal`, `busquedaForzada`, `disponibilidadForzada`, descartados y fallos de herramientas). **Qué no:** el texto de la respuesta, la IP, el correo de la cuenta ni el historial de la conversación. Quien quiera saber *qué le dijo* el asistente a alguien no puede: es deliberado.

**Enmascarado** (`enmascararDatosPersonales`, `registro-asistente.ts`): correos → `[correo]`; celulares colombianos (con o sin `+57`, con espacios, guiones o paréntesis), fijos con indicativo e internacionales → `[teléfono]`; números de documento → `[documento]` (cualquier número después de «cédula», «cc», «NIT», «documento», «pasaporte» o «DNI», los escritos con puntos de miles como `1.020.304.050` y cualquier corrida de 7 o más dígitos). Se prefiere enmascarar de más: **se conservan** los precios con `$`, los números de hasta 6 dígitos (años, cantidades, `50000`) y los ISBN-13; un ISBN-10 puede quedar enmascarado como documento. No detecta nombres propios ni direcciones: la consulta recortada puede tenerlos si la persona los escribe; por eso la retención es corta y el registro no lleva a nadie asociado.

**Bandera de inyección** (`sospechaInyeccion`): heurística de frases en español e inglés («ignora tus instrucciones», «system prompt», «modo desarrollador», «ahora eres»…). Solo marca el registro para revisarlo; nunca bloquea, porque las defensas reales son la lista blanca de datos y el validador de `bookId`. **No hay bandera de «rechazo»**: el modelo no la devuelve y el servidor no puede distinguir de forma fiable un rechazo de una respuesta de política; el panel de la Fase 8 la aproxima con `sinResultados`, sin herramientas y sin recomendaciones.

**Cómo escribe:** después de responder, dentro de `try/catch`. A diferencia del control de gasto, el registro **no** es condición para responder: si falla, la persona recibe su respuesta con `registroId: null` y el fallo queda en el log de la Lambda. La Lambda solo tiene `PutItem` sobre esa tabla (mínimo privilegio); leer y valorar se agregan con las Fases 7 y 8.

**`registroId` en la respuesta HTTP:** identificador opaco (UUID) para que el cliente pueda valorar esa respuesta en la Fase 7. El endpoint de valoración deberá comprobar que quien valora es el mismo visitante del registro (el hash está guardado).

**Sin índices:** el panel de la Fase 8 leerá por escaneo del día; si el volumen lo pide se agrega un índice por `dia`.

**Verificado en `staging` (23/11/2026).** Una pregunta con un correo y un celular dejó su ítem: consulta `Escríbeme a [correo] o al [teléfono]: quiero una novela`, 2 datos enmascarados, `expiraEn` a 90 días, sin texto de respuesta, IP ni correo; costo 1.811 µUSD, 6,8 s. La respuesta trajo el `registroId`, el mismo del ítem. La regla de la cédula quedó solo en pruebas automáticas.

**Hallazgo: Gemini saturado (23/11/2026).** Las siguientes preguntas en `staging` dieron 503 (siete seguidas entre las 18:04 y las 18:11, hora de Bogotá). Se descartó que fuera propio: la Lambda usa la misma clave que el equipo local (misma huella), una llamada mínima a `gemini-3.5-flash-lite` dio 200 tres de tres, y la petición completa del asistente dio 503 una de tres con latencias de 10 s (a las 18:08 tardaba 1,6 s). Es saturación intermitente del modelo con las peticiones grandes. El log solo guarda el estado (503) y no el cuerpo del error, a propósito. **Decisión del usuario:** reintentar más veces con espera creciente y mostrar mensajes explícitos con citas literarias; entra en la parte 3.

## 7. Fuentes

- Precios de Gemini: página oficial citada arriba, leída el 21/11/2026.
- `UpdateItem` con `ADD`, `if_not_exists` y `ConditionExpression`: documentación de DynamoDB; mismo patrón que `decrementarPorCantidadSiSuficiente` del repositorio.
