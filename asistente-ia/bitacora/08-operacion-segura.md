# 08 · Operación segura (Fase 6, `T-0060`)

> **Estado:** en curso. Parte 1 (control de gasto y de tasa) implementada el sábado 21/11/2026, antes de lo previsto. Quedan los registros con enmascarado (parte 2) y el validador de fidelidad, el límite en API Gateway y la revisión OWASP (parte 3).

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

Como son USD por millón de tokens, tokens × tarifa da micro-USD exactos. Una respuesta típica (4.000 tokens de entrada, 300 de salida, 20 de embeddings) cuesta unos 1.954 micro-USD, es decir, 0,002 USD: con 1 USD al día caben unas 500 respuestas, y con 3 USD (producción) unas 1.500. La tarifa vive en `server/api/lib/control-asistente.ts`; si cambia el modelo o el precio, se corrige ahí. **No se tocó `metrics/pricing.json`**: sigue marcando a Gemini como no verificado para el registro de esfuerzo, y ese es un cambio que decide el usuario.

## 4. Decisiones que quedan para el usuario

- Los topes iniciales son **1 USD/día en `staging`, 3 USD/día en producción y 30 mensajes por visitante y día**. Son una propuesta; se cambian en `serverless.yml` (`asistenteTopeDiarioUsd`, `asistenteMensajesPorVisitante`).
- Si la tarifa verificada debe pasar a `metrics/pricing.json` (y con ella el costo en USD del registro de esfuerzo).

## 5. Verificación

- 908 pruebas de backend en verde (40 nuevas): el contador con tope, el TTL que se fija una sola vez, la sal creada a la vez por dos peticiones, el cambio de día, el interruptor, el tope de gasto, el 429, la falla cerrada, que la IP no aparezca en ninguna clave ni valor, y que el costo no salga al cliente.
- `serverless package --stage staging`: `control-asistente.js` va dentro de `asistente.zip` y el handler carga desde el paquete (regla de `CLAUDE.md` §7).
- **Falta**, tras el despliegue a `staging`: comprobar en la tabla real que se crean `gasto#`, `visitante#` y `sal#` con su TTL.

## 6. Fuentes

- Precios de Gemini: página oficial citada arriba, leída el 21/11/2026.
- `UpdateItem` con `ADD`, `if_not_exists` y `ConditionExpression`: documentación de DynamoDB; mismo patrón que `decrementarPorCantidadSiSuficiente` del repositorio.
