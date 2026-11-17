# Ficha de riesgos y controles — Asistente de Babel

**Versión:** 0.1 (planeada, 16/11/2026). Los controles están **planeados**: cada uno pasa a "implementado" con su evidencia (archivo:línea o caso de la suite) en la Fase 6, y la ficha se verifica con la skill `owasp-security-verification`.

Marco: **OWASP Top 10 para aplicaciones con LLM (edición 2025)**, más los riesgos generales de Babel (`CLAUDE.md` §5) y la Ley 1581 de 2012 (protección de datos personales en Colombia).

| # | Riesgo (OWASP LLM) | Cómo se materializa aquí | Control | Evidencia prevista | Estado |
|---|---|---|---|---|---|
| 1 | **LLM01 Inyección de prompt — directa** | El visitante escribe "ignora tus instrucciones y…" | Instrucciones del sistema separadas del contenido del usuario; salida estructurada con esquema; el validador ignora todo lo que no sea un `bookId` válido; la respuesta nunca ejecuta acciones | Casos de inyección directa en la suite | Planeado |
| 2 | **LLM01 Inyección de prompt — indirecta** | Una sinopsis obtenida de un tercero contiene instrucciones | Las sinopsis se pasan como datos delimitados y marcados como no confiables; se extrae solo texto plano (ADR-011, `cheerio`); prueba con una sinopsis envenenada en la copia congelada | Caso de inyección indirecta en la suite | Planeado |
| 3 | **LLM02 Divulgación de información sensible** | El modelo revela costo, margen o descuento editorial; o el registro guarda datos personales | Lista blanca de campos en las herramientas (el modelo nunca los recibe); enmascaramiento de correos, teléfonos y documentos antes de guardar; sin IP (hash con sal diaria); TTL en el registro | Pruebas de las herramientas y del enmascarador | Planeado |
| 4 | **LLM05 Manejo inadecuado de la salida** | Texto del modelo con HTML o scripts renderizado en el catálogo | Interpolación estándar de Angular, prohibido `innerHTML`; las tarjetas se pintan con datos de Babel, no con texto del modelo | Revisión del componente y pruebas | Planeado |
| 5 | **LLM06 Agencia excesiva** | El agente modifica inventario o vende | Herramientas de solo lectura; rol IAM con solo lectura sobre `babel-libros` y el bucket del índice; tope de rondas de herramientas | `serverless.yml` (rol IAM) y pruebas | Planeado |
| 6 | **LLM07 Fuga del prompt del sistema** | El visitante obtiene el prompt completo | El prompt no contiene secretos ni datos internos (es público en el repo de todas formas); se documenta como riesgo aceptado | Ficha del prompt | Planeado |
| 7 | **LLM08 Debilidades de vectores y embeddings** | Contenido de terceros en el índice manipula la recuperación | El índice se construye solo desde `babel-libros`; los textos se normalizan; recall@k vigilado por la suite | Suite (recall@k) | Planeado |
| 8 | **LLM09 Desinformación** | Libro inexistente, agotado o con un precio inventado | Validador determinista (existencia + disponibilidad); precio y ubicación siempre desde Babel; métrica de libros inventados | Suite y tablero | Planeado |
| 9 | **LLM10 Consumo sin límites** | Bots o abuso que disparan el gasto | Interruptor; tope de mensajes por visitante; tope de gasto diario con contador atómico; límites de longitud y de turnos; limitación de tasa en API Gateway; facturación prepagada con tope | Pruebas de los topes; configuración | Planeado |
| 10 | **LLM03 Cadena de suministro** | Dependencia comprometida o modelo retirado | `npm ci` con `package-lock.json`; `ProveedorLlm` intercambiable; procedimiento de cambio de modelo (Fase 9) | Procedimiento y tabla comparativa | Planeado |
| 11 | Contenido inapropiado para la edad | Se recomienda un libro adulto para un niño | Filtro por `clasificacionEdad` cuando se pide una edad; casos de la suite con edad explícita | Suite | Planeado |
| 13 | Propiedad intelectual y términos de uso de las fuentes | Las sinopsis son texto de editoriales; los términos de las APIs de Google (sección 5.e) prohíben crear copias permanentes del contenido devuelto | Uso interno: la sinopsis no se muestra textual al visitante, no sale en ningún endpoint público ni se sube al repositorio; tabla aparte con `fuenteSinopsis` para purgar todo lo de Google en una pasada; el riesgo fue aceptado por el usuario (ADR-018). Pendiente: revisar los términos de los sitios de librerías | `.gitignore`, `GET /api/libros/:bookId/conocimiento` autenticado, ADR-018 | Implementado (`T-0011`); riesgo residual aceptado |
| 12 | Privacidad (Ley 1581 de 2012) | El visitante no sabe que habla con una IA ni qué se guarda | Aviso visible en el chat; finalidad limitada a mejorar el servicio; retención con TTL; nivel de pago del proveedor en producción para que el contenido no se use para entrenar | Componente, configuración de la tabla, ADR-015 | Planeado |

## Riesgos aceptados

- **Términos de Google Books.** Se guardan sinopsis pese a que la sección 5.e de los términos de las APIs de Google prohíbe las copias permanentes. Aceptado por el usuario el 16/11/2026 con las mitigaciones del riesgo 13 (ADR-018). No es una opinión legal.
- El prompt del sistema es público (repositorio abierto). Se asume que cualquiera puede leerlo; por eso no contiene nada sensible.
- Un visitante puede escribir datos personales en una consulta pese al aviso. El enmascaramiento reduce el riesgo, pero no lo elimina; la retención limitada por TTL acota la exposición.
