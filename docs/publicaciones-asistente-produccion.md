# Publicaciones cortas: el asistente de la librería llega a producción

Borradores para revisión de Oliver (24/11/2026). Formato de The Lab: Markdown-lite (`**negrita**`, `*itálica*`, enlaces), tres párrafos (problema con cifras → qué hice, con enlace → lección y pregunta al lector), 180–350 palabras, primera persona, tags en inglés. Sirven igual como «Publicación» de LinkedIn; ahí conviene agregar al final 3 a 5 hashtags (sugeridos debajo de cada una).

Notas para la revisión:

- **Nombre:** el asistente se llama **Melquíades** (decidido el 25/11/2026). Está nombrado en la primera mención de las publicaciones 3 y 4. La 1 y la 2 ya las ajustó Oliver y no se tocaron: si se quiere el nombre ahí, va en la primera mención («un asistente con IA»).
- Todas las cifras salen del repositorio (bitácoras 01, 06, 07 y 08 de `asistente-ia/`, resúmenes de evaluación y ledger de esfuerzo) o de AWS el 24/11/2026. Ninguna es estimada.
- Orden sugerido: una por semana o cada tres días, de la 1 a la 4; el artículo largo puede ir entre la 2 y la 3 y enlazarse desde las siguientes.
- Pendiente antes de publicar: el flujo de siempre (revisión, traducción al inglés y limpieza con `watermarks-remover`).

---

## 1. Antes de escribir una línea de código

**Tags:** Use Case Definition, AI Governance, Data Exposure, Solution Architecture
**Hashtags LinkedIn:** #ArquitecturaDeSoluciones #IAGenerativa #Gobernanza #ProductManagement

Para aprovechar las ventas navideñas, el 16 de noviembre inicié el proceso de desarrollo de un asistente con IA, llamado **Melquíades** (como el sabio gitano de **Cien años de soledad**) para el catálogo público de la librería de [Le Tiende](https://letiende.co/libros/): una persona escribe «busco algo para mi hijo adolescente al que le gusta el manga» y recibe libros que de verdad están en el estante, con precio y ubicación. Antes del primer *commit* escribí una ficha de caso de uso: problema, usuarios, datos, indicadores de éxito, riesgos y cuándo escalar a una persona. Al revisar qué datos podría ver el modelo, encontré algo que no buscaba: el endpoint público de la ficha de cada libro llevaba meses devolviendo el registro completo de la base de datos, **costo, utilidad y descuento editorial incluidos**. Nadie lo había notado porque la interfaz solo pintaba lo necesario.

Ese mismo día lo corregí con una lista blanca de campos y una prueba que falla si aparece cualquier campo fuera de ella, y la regla quedó escrita para los agentes que trabajan en el repositorio: en un endpoint público nunca se esparce el ítem de la base de datos. La [ficha de caso de uso](https://github.com/ocastelblanco/babel-letiende/blob/main/asistente-ia/fichas/caso-de-uso.md) sigue en el repo, con fecha anterior a cualquier código del asistente.

Un asistente de IA amplía lo que el sistema expone hacia afuera (son muy comunicativos, los malditos), y esa pregunta conviene hacerla antes de conectar el modelo, no después. Lo que encontré no era un riesgo del modelo: era deuda de la aplicación, que el modelo habría heredado y repetido con mucha seguridad. ¿Qué te mostraría una auditoría de tus endpoints si la hicieras pensando en lo que un modelo podría leer?

---

## 2. El 0 % que no esperaba

**Tags:** RAG, Knowledge Sources, Data Engineering, Cost Optimization
**Hashtags LinkedIn:** #RAG #IngenieríaDeDatos #IAGenerativa #AWS

Para recomendar los libros de la librería de [Le Tiende](https://letiende.co/libros/) por su contenido, **Melquíades**, el asistente IA que desarrollé, necesita sinopsis, y el inventario no las tenía. El plan obvio era traerlas de Google Books por ISBN. Lo medí sobre los **2.541 libros** del inventario real: Google Books aportó **0** sinopsis útiles (200 caracteres o más). La cobertura llegó de seis sitios web colombianos con información bibliográfica, consultados uno tras otro hasta encontrar texto: **2.201 libros con sinopsis útil, el 86,6 %**. Al otro 13,4 % lo describen el título, el autor y la categoría, y **Melquíades** lo sabe.

El índice tampoco siguió la receta de moda. Con 2.541 libros no hace falta una base vectorial administrada: los *embeddings* (768 dimensiones, cuantizados) caben en un **archivo de 2,3 MB en S3** que la Lambda carga y compara en memoria. La construcción completa en producción tardó **50 segundos**, y cada 6 horas se actualiza solo lo que cambió. La búsqueda es híbrida: primero los filtros duros (idioma, precio, existencias), después el significado. La [bitácora de datos](https://github.com/ocastelblanco/babel-letiende/blob/main/asistente-ia/bitacora/01-datos-sinopsis.md) tiene la cobertura por fuente y por idioma.

La calidad de un asistente con recuperación la decide la fuente de conocimiento mucho antes que el modelo, y la fuente que todos dan por hecha puede no servir para tu catálogo. Medir la cobertura antes de escribir el primer prompt me ahorró construir sobre un supuesto. ¿Cuál es la fuente de conocimiento de tu asistente que nunca mediste?

---

## 3. La suite no lo vio; una persona sí

**Tags:** LLM Evaluation, Regression Testing, Prompt Versioning, Guardrails
**Hashtags LinkedIn:** #EvaluaciónDeLLM #PromptEngineering #QA #IAResponsable

Ningún cambio de prompt de **Melquíades**, el asistente con IA de la librería de **Le Tiende**, entra sin pasar una suite de evaluación: **52 casos** con libros aceptables definidos a mano, restricciones de precio e idioma, preguntas sin respuesta posible, políticas de la librería e intentos de inyección. Hay cuatro criterios de salida que deben dar cero o casi: libros inventados, libros agotados, inyecciones exitosas y menos del 90 % de restricciones cumplidas. El prompt va por la versión 6, pero **producción usa la 5**: la v6 cumplió 11 de 21 casos de restricciones contra 15 de 21 de la v5, así que no se adoptó, aunque «se veía mejor».

Lo más útil, sin embargo, lo encontró una persona. Probando a mano, **Melquíades** respondió «quedan 5 unidades, en el primer piso» sin consultar el inventario; el dato real era 1 ejemplar en otra sala. Lo reproduje: **2 de cada 3 intentos inventaban**. El prompt ya decía «siempre consulta la disponibilidad», y el modelo a veces no lo hacía. La corrección no fue otro prompt sino una guarda en el servidor que detecta la pregunta, obliga a llamar la herramienta y, si aun así no hay dato verificado, entrega un aviso en lugar del número. Después: 10 de 10. El [historial de versiones](https://github.com/ocastelblanco/babel-letiende/blob/main/asistente-ia/prompts/CHANGELOG.md) tiene cada cambio con su motivo y su efecto medido.

Una instrucción en el prompt es una preferencia, no un control: lo que no puede fallar se verifica con código. Y la suite solo mide lo que ya imaginaste; las pruebas a mano siguen encontrando lo que nadie escribió como caso. ¿Qué regla crítica de tu asistente depende solo de que el modelo obedezca?

---

## 4. Encenderlo sin cruzar los dedos

**Tags:** AI Security, OWASP LLM Top 10, Privacy by Design, FinOps
**Hashtags LinkedIn:** #Ciberseguridad #OWASP #PrivacidadDeDatos #FinOps

Un chat público con IA es un endpoint abierto que cuesta dinero en cada mensaje y recibe texto de cualquiera. Antes de encender **Melquíades**, el asistente de la librería de **Le Tiende**, puse los controles que yo exigiría en un sistema ajeno: **tope de gasto diario** (US$3 en producción), **30 mensajes por visitante al día**, límite de tasa en API Gateway (2 por segundo, ráfagas de 10) e interruptor de emergencia. La suite incluye **11 intentos de inyección**, 3 de ellos escondidos dentro de una sinopsis, que es texto de terceros: 0 tuvieron éxito. Un validador de fidelidad borra de la respuesta cualquier precio, horario o teléfono que no venga de una fuente verificada.

La privacidad quedó en el diseño, no en una política: cada consulta se guarda 90 días **sin IP, con correos, teléfonos y documentos enmascarados**, y la valoración con pulgares se ata a la IP con una sal que cambia cada día. La respuesta pública es una lista blanca de campos. Revisé el conjunto con mi skill de verificación OWASP (ASVS 5.0 nivel 2 más el Top 10 para LLM), y cuando el proveedor del modelo se saturó en pleno despliegue, el visitante recibió una cita de Cervantes, Machado o Larra en vez de un error 503. El [registro de la operación segura](https://github.com/ocastelblanco/babel-letiende/blob/main/asistente-ia/bitacora/08-operacion-segura.md) detalla cada control.

El 24 de noviembre se encendió en producción, **solo para el personal**, tres días antes de la fecha meta. El paso al público espera a que quien responde por los datos de la librería revise el aviso de privacidad: ese control no lo decide el código. ¿Tu asistente sale a producción con un interruptor y un tope de gasto, o con la esperanza de que nadie lo use demasiado?
