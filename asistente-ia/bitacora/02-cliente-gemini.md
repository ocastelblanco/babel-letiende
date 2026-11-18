# 02 — Cliente de Gemini detrás de `ProveedorLlm`

**Fecha:** 17/11/2026 · **Fase:** 2 · **trace_id:** `T-0021` · **Estado:** `T-0021` fusionado; `T-0024` (migración a la Interactions API) implementado, PR abierto

## 1. Objetivo

Que el asistente hable con un modelo de lenguaje a través de una interfaz propia (`ProveedorLlm`), de modo que cambiar de proveedor, de modelo o de API sea escribir otra implementación y no tocar el resto. Esta entrada cubre solo el cliente; el índice (`T-0022`) y el asistente (`T-0023`) vienen después.

## 2. Conceptos y tecnologías

### Verificar el contrato contra la API real, no contra la documentación

La documentación oficial de Gemini cambió: las páginas de generación de texto y de salida JSON ya describen la «Interactions API» y no mencionan `generateContent`. Un cliente escrito de memoria, o solo desde esas páginas, habría supuesto un contrato sin comprobarlo. Por eso el primer paso fue un workflow (`asistente-verificar-gemini.yml`) que llama a la API real con la clave del entorno `staging` y textos sintéticos, e imprime solo estados, nombres de campos, tamaños y cifras de uso, nunca la clave ni el contenido del modelo.

Lo que confirmó el 17/11/2026:

| Hecho | Evidencia |
|---|---|
| La clave funciona y ve `gemini-3.5-flash-lite` y `gemini-embedding-2` | `GET /models`: 64 modelos |
| `embedContent` y `batchEmbedContents` con `output_dimensionality: 768` devuelven vectores de **norma 1,0000**: no hace falta normalizar | norma calculada en el workflow |
| `batchEmbedContents` devuelve un vector por petición | `embeddings: array(2)` |
| `generateContent` sigue vivo, acepta `responseMimeType` + `responseSchema` y devuelve JSON válido con las claves del esquema | prueba real |
| El uso llega en `usageMetadata` (`promptTokenCount`, `candidatesTokenCount`, `totalTokenCount`) | prueba real |
| La Interactions API también responde, con otro esquema (`steps`, `usage`) | prueba real |

### De `generateContent` a la Interactions API (`T-0024`)

En `T-0021` elegí `generateContent`: estaba verificado y la Interactions API parecía inestable (esquema cambiado en mayo de 2026, versión beta). Después las skills de Gemini se actualizaron: `generateContent` pasó a ser la API «vieja» y la Interactions API quedó estable en `v1`. Con esa razón caída, y por decisión del usuario, migré la generación.

La documentación se contradecía otra vez: las páginas hablaban solo de `v1beta` y no aclaraban si la cabecera `Api-Revision` era obligatoria, mientras la skill decía `v1`. En vez de elegir una versión, el workflow probó las cuatro combinaciones con la clave real. **Las cuatro funcionan** (`v1` y `v1beta`, con y sin cabecera). Se usa `/v1` y se envía `Api-Revision: 2026-05-20` para fijar el esquema de la respuesta.

Lo que se confirmó con la API real:

| Hecho | Evidencia |
|---|---|
| La conversación sin estado funciona: el historial va en `input` como pasos `user_input` / `model_output` con `content` en arreglo, y `store: false` evita que quede guardado en Google | prueba de varios turnos |
| La respuesta trae pasos `thought` y `model_output`; el texto sale de los `model_output` | forma de la respuesta |
| Un tope de tokens muy bajo devuelve `status: incomplete` con el texto cortado | prueba con 16 tokens |
| El pensamiento se reporta aparte (`total_thought_tokens`) y no entra en `total_output_tokens`: con `thinking_level: medium` fueron 339 tokens de pensamiento por 50 de salida | uso por nivel |
| `thinking_level` acepta `minimal`, `low`, `medium` y `high` en `gemini-3.5-flash-lite`; el pensamiento sube de 0 (minimal, low) a 339 (medium) y 509 (high) tokens | cuatro llamadas |
| Un bloqueo de seguridad **no se pudo verificar**: la documentación no describe cómo se señala en una interacción. El cliente trata como bloqueada toda respuesta sin texto que no terminó con normalidad | — |

El cliente suma el pensamiento a los tokens de salida (se factura como salida) y por defecto pide `thinking_level: low`; es un parámetro de la petición, para ajustarlo cuando haya evaluaciones que digan si más pensamiento mejora algo.

Además de las pruebas con respuestas simuladas, un segundo script (`verificar-cliente-gemini.mjs`) ejercita la clase real contra la API: 3 libros con consultas que deben encontrar el libro correcto (los tres aciertos, con puntajes de 0,67 a 0,73), una conversación de tres turnos con salida JSON que recomienda el libro de fantasía, y el caso de respuesta truncada.

### `gemini-embedding-2` no usa `task_type`

El modelo anterior distinguía documento de consulta con un parámetro. El actual no lo admite: el rol va como prefijo del texto, `title: … | text: …` para los libros y `task: search result | query: …` para la pregunta del visitante. Y una lista de textos dentro de **un** `content` produce **un solo** vector agregado; por eso el cliente manda una petición por texto dentro del lote y comprueba que vuelvan exactamente tantos vectores como textos (un desajuste desalinearía el índice con los libros sin que nada fallara).

## 3. Decisiones

- **768 dimensiones.** Recomendadas por la documentación, ya normalizadas, y dejan el índice de 3.000 libros en unos 9 MB en `float32`.
- **Modelo de texto: `gemini-3.5-flash-lite`** (estable, sin fecha de apagado anunciada; entrada US$ 0,30 y salida US$ 2,50 por millón de tokens según la página de precios). `gemini-3.1-flash-lite` tiene apagado anunciado para el 7/5/2027. Los modelos se leen del entorno (`GEMINI_MODELO_TEXTO`, `GEMINI_MODELO_EMBEDDINGS`) para cambiarlos sin código.
- **Reintentos acotados:** hasta 2 reintentos con pausa creciente, solo ante 429, 5xx o fallo de red; un 400 no se reintenta. Tiempo límite de 20 s por llamada.
- **La clave solo viaja en la cabecera** `x-goog-api-key`. Los errores conservan el estado HTTP y el código del proveedor, pero nunca el texto del error ni la clave.

## 4. Qué falló y cómo se corrigió

- **El resumen automático de la documentación y la skill se contradecían sobre `/v1`.** Se resolvió probando, no eligiendo.
- **Un test fallaba por reutilizar un `Response`.** Un cuerpo de respuesta solo se puede leer una vez; el mock devolvía el mismo objeto en cada reintento, así que el segundo intento no veía el código del error. El cliente estaba bien; el mock ahora crea una respuesta nueva por llamada.
- **El resumen automático de la documentación mintió dos veces** (dijo que el registro de cambios terminaba en diciembre de 2025 y que no había precios de la familia 3.5). El texto literal decía lo contrario. Por eso las cifras de esta entrada vienen del texto literal o de la prueba real, no de resúmenes.

## 5. Datos y privacidad

Según los términos de Gemini (versión del 23/3/2026), en el nivel gratuito Google puede usar lo enviado para mejorar sus productos y revisores humanos pueden leerlo; en el de pago no. Mientras el proyecto esté en nivel gratuito, solo se envían textos sintéticos o sinopsis; **ninguna pregunta real de un visitante debe pasar por ahí**. El chat público requiere el nivel de pago (ADR-015).

## 6. Esfuerzo

Eventos en [`../metrics/events/`](../metrics/events/).
