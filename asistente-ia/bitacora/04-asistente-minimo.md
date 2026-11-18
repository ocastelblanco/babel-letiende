# 04 — El asistente mínimo: endpoint, búsqueda híbrida, prompt v1 y validador

**Fecha:** 18/11/2026 · **Fase:** 2 · **trace_id:** `T-0023` · **Estado:** implementado, PR abierto

## 1. Objetivo

Que exista, de punta a punta, un asistente que reciba una conversación y devuelva libros **reales y disponibles** con un motivo para cada uno, sin inventar ninguno. Esta entrada cubre la Lambda `asistente`, la búsqueda híbrida, el prompt v1 versionado y el validador de la respuesta. Lo que no cubre: herramientas (Fase 3), evaluación (Fase 4), topes de gasto y registros (Fase 6) y la interfaz (Fase 7).

## 2. Conceptos y tecnologías

### Generación aumentada por recuperación (RAG), en una sola pasada

El modelo no conoce el inventario de la librería. En vez de pedirle que «recuerde» libros, cada pregunta recorre este camino:

1. **Consulta → vector.** El texto de lo que pidió la persona (sus últimos mensajes, no lo que dijo el asistente) se convierte en un vector con `gemini-embedding-2`.
2. **Filtro previo + similitud.** Del índice de S3 (`T-0022`) se descartan los libros que no cumplen el idioma o la edad pedidos y se ordenan los demás por coseno. Se toman 40.
3. **Filtro contra la base de datos.** Existencias y precio cambian más rápido que el índice (se reconstruye cada 6 horas), así que se leen de `babel-libros`: se descartan agotados, borrados y los que superan el precio máximo. Los ejemplares del mismo ISBN en distintas ubicaciones cuentan una vez.
4. **Contexto al modelo.** Los 8 mejores, con título, autor, categorías, idioma, precio y sinopsis (recortada a 700 caracteres), van como JSON en el último turno de la persona.
5. **Generación con salida estructurada.** Una sola llamada a Gemini con esquema JSON: `texto`, `recomendaciones[{bookId, motivo}]` y `sinResultados`.
6. **Validación.** Todo `bookId` que no esté entre los 8 ofrecidos se descarta y se cuenta.

Es «híbrida» porque combina filtros exactos (idioma, edad, precio, existencias) con similitud semántica: la similitud sola recomendaría un libro agotado o fuera del presupuesto con la misma seguridad que uno disponible.

### Por qué el validador es la defensa real contra las invenciones

Pedirle al modelo en el prompt que «no invente» reduce las invenciones; no las elimina. El validador es código determinista que no depende de que el modelo obedezca: solo pasan los `bookId` de la lista de ese turno. Si el modelo recomienda algo y **todo** se descarta, su texto probablemente nombra libros inexistentes, así que se sustituye por una respuesta segura de «sin resultados». El conteo de descartes (`meta.descartados`) es una métrica de calidad del prompt: la Fase 4 la usará.

### Contexto como datos, no como instrucciones (inyección de prompt)

Las sinopsis son texto de terceros y el mensaje de la persona es texto no confiable; cualquiera de los dos puede traer «ignora lo anterior». Dos medidas, ambas de estructura y no de confianza:

- Las instrucciones del sistema están **fijas** (el archivo del prompt); nada del inventario ni de la conversación se mezcla en ellas.
- Los libros viajan serializados con `JSON.stringify`: una sinopsis con comillas, saltos de línea o un falso `MENSAJE_DE_LA_PERSONA:` sigue siendo una cadena dentro del JSON y no puede cerrar la estructura (hay una prueba con exactamente ese ataque).

El prompt además le dice al modelo que ambos son datos. Esto **reduce** el riesgo, no lo cierra: las pruebas de inyección real (directa e indirecta) son de la Fase 4. Lo que sí es independiente del modelo: aunque obedeciera la orden, el validador no deja pasar un libro fuera de la lista y el esquema no deja salir otro formato.

### Conversación sin estado

El servidor no guarda nada entre mensajes. El cliente envía los últimos turnos (máximo 9, alternando persona/asistente, 1.000 caracteres cada uno, 20.000 en total) y el servidor valida todo: rol fijo por posición (el cliente no puede inyectar un turno `system`), longitudes y filtros. Costo: una pregunta de seguimiento («y algo más corto») busca con las frases anteriores de la persona concatenadas; el validador solo acepta libros del turno actual, así que «háblame del segundo» de un turno viejo puede degradarse. Se mide en la Fase 4.

### Prompt como archivo versionado

`asistente-ia/prompts/asistente-v1.md` tiene un encabezado (`version`, `modelo`, `fecha`, `motivo`) y el resto es el prompt tal cual. **Una sola fuente:** el mismo archivo que se revisa en el PR se empaqueta en la Lambda y se lee en el arranque (`cargarPrompt`), en vez de copiarlo a una constante de TypeScript que se desincronice. Una versión usada no se edita: un cambio es `asistente-v2.md`, y `VERSION_PROMPT_ASISTENTE` elige cuál corre. `prompts/CHANGELOG.md` anota motivo y efecto medido de cada versión; la validación de la versión (`^v\d{1,3}$`) evita que una variable mal escrita lea rutas arbitrarias.

## 3. Decisiones

- **El endpoint no es público todavía.** Exige sesión de vendedor o administrador (verificada contra `babel-usuarios`, A01) y un interruptor `ASISTENTE_ACTIVO` (encendido en `staging`, apagado en producción). Un chat anónimo con una clave que cuesta dinero necesita los topes de gasto y de tasa de la Fase 6; se abre al público en las fases 6 y 7. Decidido con el usuario el 17/11/2026; el plan original no lo decía.
- **Los filtros los envía el cliente**, no los deduce el modelo. Sin herramientas (Fase 3) no hay un paso intermedio donde el modelo extraiga «hasta $40.000» del texto; la interfaz del chat los ofrecerá como opciones. El filtro de **edad** es hoy solo «excluir contenido adulto» (`maturityRating` de Google Books: `MATURE`/`NOT_MATURE`); un rango infantil/juvenil necesitaría otro dato que no existe.
- **Un libro de idioma desconocido no cumple un filtro de idioma.** Es lo seguro (no recomendar en inglés a quien pidió español); el idioma se infiere desde `T-0014`, así que son pocos.
- **Sin candidatos no se llama al modelo:** si los filtros no dejan ningún libro, se responde «sin resultados» sin pagar una generación.
- **Intentos cortos:** el cliente de Gemini admite ahora `timeoutMs` y `reintentosMaximos`; este endpoint usa 10 s y 1 reintento para quedar bajo los 30 s de API Gateway. Las tareas de fondo mantienen 20 s y 2 reintentos.
- **Registros sin contenido:** la Lambda escribe solo cifras (versión del prompt, modelo, tokens, candidatos, descartados, latencia). Ni el texto de la persona ni la respuesta llegan a CloudWatch; el registro de conversaciones enmascarado es de la Fase 6.

## 4. Qué se hizo

- `server/api/lib/asistente.ts`: validación de la petición, `textoDeConsulta`, `filtroDelIndice`, `seleccionarCandidatos`, `libroParaModelo` (lista blanca), `mensajesParaModelo`, `validarRespuesta`, `cargarPrompt`.
- `server/api/handlers/asistente.ts`: `responder(dependencias, peticion)` (orquestador, probable con el modelo simulado), `crearCargadorIndice` (el índice se baja de S3 una vez cada 5 minutos por contenedor caliente) y el `handler` HTTP (interruptor → sesión → rol → cuerpo → respuesta; errores con mensaje genérico).
- `serverless.yml`: función `asistente` (timeout 29 s, 512 MB), rol `AsistenteLambdaRole` de mínimo privilegio (solo `GetItem` sobre libros, conocimiento y usuarios; solo lectura del índice en S3; ninguna escritura), `custom.asistenteActivo`, y el prompt incluido en `package.patterns`.
- `asistente-ia/prompts/asistente-v1.md` y `CHANGELOG.md`.
- 84 pruebas nuevas (688 en total) con el modelo simulado: límites y filtros de la petición, orden y filtrado de candidatos, lista blanca (nunca `costo`, `utilidad` ni datos internos), el ataque de sinopsis envenenada, descarte y conteo de `bookId` inventados o agotados, respuesta bloqueada o truncada, índice ausente o de otro modelo, interruptor, 401/403/400/413/502/503/500 sin detalle interno.
- Regla de `CLAUDE.md` §7 (módulo nuevo ⇒ `package.patterns`): comprobada desempaquetando `.serverless/asistente.zip` (34,5 MB) y cargando el handler y el prompt desde ahí.

## 5. Cifras medidas

- Pruebas: 688 de backend (604 antes), todas en verde.
- Paquete de la Lambda: 34,5 MB (la del índice, con el SDK de S3 y el cliente de Gemini, pesa 60 MB).
- Verificación en `staging`: pendiente (se anota abajo al terminar).

## 6. Qué falló y cómo se corrigió

*(Se completa con la verificación en `staging`.)*

## 7. Esfuerzo

Ver `../metrics/events/` (`trace_id: T-0023`) y la fila de `tracking-detail.csv`.

## 8. Fuentes

- Interactions API, salida estructurada y niveles de pensamiento: verificados contra la API real (entrada [02](02-cliente-gemini.md)); no se consultó nada nuevo en esta fase.
- OWASP Top 10: A01 (control de acceso), A03 (inyección), A05 (configuración), A08 (integridad de datos): reglas de `CLAUDE.md` §5.
