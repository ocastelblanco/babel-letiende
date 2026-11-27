# Artículo de LinkedIn: el asistente de la librería llega a producción

Borrador para revisión de Oliver (24/11/2026).

**Estructura según las guías consultadas:**

- Título con promesa concreta.
- Gancho de unas tres oraciones que responde «¿qué gano leyendo esto?».
- Un solo tema y subtítulos descriptivos.
- Párrafos de una a tres oraciones, con negritas y viñetas.
- Historia en primera persona, fracasos incluidos.
- Cierre con pregunta y hashtags amplios y de nicho.

**Fuentes de la estructura:**

- [Consejos de LinkedIn para escribir artículos](https://www.linkedin.com/help/linkedin/answer/a516913/consejos-para-escribir-articulos-en-linkedin).
- [Guía de RedactAI](https://redactai.io/es/blog/una-guia-para-escribir-articulos-en-linkedin-que-sean-notados): 1.000 a 2.000 palabras, una publicación promocional aparte con un gancho del artículo y no solo el enlace.

**Notas para la revisión:**

- **Cifras.** Todas salen del repositorio o de AWS al 24/11/2026. Las de esfuerzo salen del ledger, que mide 37 unidades de trabajo hasta la mañana del 24/11 y no incluye el chat ni la activación.
- **Nombre.** El asistente se llama **Melquíades** (decidido el 25/11/2026); se nombra en el gancho y en la publicación promocional.
- **Longitud.** Unas 1.200 palabras sin estas notas.
- **Imagen de portada sugerida.** Una captura del chat con una recomendación real y su tarjeta. Las guías no fijan medidas; usar la de la plantilla de artículos de LinkedIn al publicar.

---

## Título

**Del 16 al 24 de noviembre: 7 decisiones para que un asistente de IA no invente nada en producción**

Alternativas:

- «0 libros inventados en 52 pruebas: cómo llevé un asistente con IA a producción»
- «Lo que no está en los tutoriales de RAG: llevar un asistente de IA a una librería real»

---

## Cuerpo

Un asistente de IA que recomienda un libro agotado le hace perder la tarde a una persona; uno que inventa un precio le hace perder la confianza en la librería. En una semana y un día llevé a producción a **Melquíades**, el asistente de recomendación del catálogo de [Le Tiende](https://letiende.co/libros/), un centro cultural de Bogotá, con **0 libros inventados, 0 agotados y 0 inyecciones exitosas** en su suite de pruebas. Estas son las siete decisiones que lo hicieron posible y lo que salió mal en el camino.

### El problema, en una frase

Una persona escribe «quiero algo para mi hijo adolescente, le gustan el manga y las historias tipo Harry Potter». La respuesta debe traer libros **que estén en el estante**, con precio y ubicación, y decir «no tengo nada así» cuando sea verdad.

Debajo hay una aplicación de inventario que construí este año (Angular, AWS Lambda, DynamoDB), unos 2.500 libros y una meta: costo de operación cercano a cero.

### 1. Escribí el caso de uso antes que el código

El primer entregable fue una ficha de una página: problema, usuarios, datos, indicadores de éxito, riesgos y cuándo escalar a una persona. Hacerla tiene un efecto secundario que no esperaba: obliga a preguntar **qué datos va a ver el modelo**.

Al responder esa pregunta encontré que el endpoint público de cada libro llevaba meses devolviendo el registro completo, **con costo, utilidad y descuento editorial**. La interfaz no lo mostraba, así que nadie lo notó. Lo corregí ese día con una lista blanca de campos y una prueba que falla si aparece uno nuevo.

> Un asistente amplía lo que tu sistema expone. Esa auditoría se hace antes de conectar el modelo.

### 2. Medí la fuente de conocimiento antes de confiar en ella

Para recomendar por contenido hacían falta sinopsis. El plan obvio era Google Books. Medí sobre los 2.541 libros reales: **Google Books aportó cero sinopsis útiles.**

La cobertura vino de seis sitios web colombianos con datos bibliográficos consultados en cascada: **86,6 % del inventario con sinopsis útil**. El resto se describe con título, autor y categoría, y queda marcado. Sin esa medición habría escrito prompts sobre un supuesto falso.

### 3. No usé una base vectorial (y no hizo falta)

Con 2.541 libros, los *embeddings* cuantizados caben en **un archivo de 2,3 MB** en S3, que la función carga y compara en memoria. La construcción completa en producción tardó **50 segundos** y se actualiza cada 6 horas, solo con lo que cambió.

La búsqueda es **híbrida**: primero los filtros duros (idioma, precio, existencias) y después el significado. La arquitectura correcta es la que cabe en el problema, no la del último tutorial.

### 4. El modelo nunca es la fuente de verdad

Esta es la decisión que más pesa. El modelo redacta y elige; **los datos los pone el sistema**:

- Las herramientas que usa (buscar libros y consultar disponibilidad) son **de solo lectura** y devuelven únicamente campos públicos.
- Un **validador determinista** descarta cualquier libro que no exista o esté agotado antes de responder.
- La tarjeta que ve el visitante (portada, título, precio, enlace) se pinta **con datos de la base, no con texto del modelo**.
- Un **validador de fidelidad** borra de la respuesta cualquier precio, horario o teléfono que no venga de una fuente verificada.

El modelo (uno ligero de Gemini) vive detrás de una interfaz propia: cambiarlo por otro proveedor es un cambio de configuración, no una reescritura.

### 5. Ningún prompt cambia sin pasar la suite

La suite tiene **52 casos**:

- libros aceptables definidos a mano;
- restricciones de precio e idioma;
- preguntas sin respuesta posible;
- políticas de la librería;
- **11 intentos de inyección**, 3 de ellos escondidos dentro de una sinopsis, que es texto de terceros.

Hay cuatro criterios de salida: libros inventados, agotados e inyecciones exitosas deben dar **cero**, y las restricciones deben cumplirse al menos en un 90 %.

Los prompts viven en git, uno por versión, con motivo y efecto medido. La versión 6 «se veía mejor», pero cumplió 11 de 21 casos de restricciones contra 15 de 21 de la versión 5. **No se adoptó.** Producción corre la v5, que en la corrida del 24 de noviembre cumplió los cuatro criterios.

### 6. Lo que no puede fallar va en código, no en el prompt

Aquí está el fallo que más aprendizaje produjo. Probando a mano, el asistente respondió «quedan 5 unidades, en el primer piso» **sin consultar el inventario**. El dato real: un ejemplar en otra sala. Lo reproduje: **2 de cada 3 intentos inventaban**. Como sucede en todos los casos, el modelo estaba alucinando de lo lindo.

El prompt ya decía «siempre consulta la disponibilidad». El modelo a veces no obedecía. La solución no fue un prompt más enfático sino una **guarda en el servidor**: si la pregunta es sobre existencias o ubicación y no se consultó la herramienta, se repite la generación obligándola; si aun así no hay dato verificado, se entrega un aviso en lugar del número. Resultado: 10 de 10.

Dos lecciones salen de ahí:

- **Una instrucción en el prompt es una preferencia, no un control.**
- La suite solo mide lo que ya imaginaste. Ese caso lo encontró una persona; hoy es parte de la suite.

### 7. Operar con topes, privacidad y una salida gradual

Un chat público es un endpoint abierto que cuesta dinero en cada mensaje. Antes de encenderlo:

- **Gasto:** tope diario de US$3, 30 mensajes por visitante al día, límite de tasa en el API Gateway e interruptor de emergencia.
- **Privacidad por diseño:** las consultas se guardan 90 días sin IP, con correos, teléfonos y documentos enmascarados; la respuesta pública es una lista blanca de campos.
- **Seguridad:** revisión contra OWASP ASVS 5.0 (nivel 2) y el Top 10 para aplicaciones con LLM.
- **Resiliencia:** reintentos dentro de un presupuesto de 25 segundos; cuando el proveedor se saturó en pleno despliegue, el visitante recibió una cita de Cervantes, Machado o Larra en vez de un error.

El 24 de noviembre, tres días antes de la fecha meta, se encendió **solo para el personal de la librería**. Abrirlo al público espera la revisión del aviso de privacidad por quien responde por los datos: ese control no lo decide el código.

### Lo que costó, medido

Trabajé con agentes de IA como equipo de desarrollo, y medí el esfuerzo con una herramienta propia que lee los registros de cada sesión en vez de pedirme que lo recuerde. En las 37 unidades de trabajo registradas entre el 16 y el 24 de noviembre:

- **2,5 horas** de agente activo y **4,8 horas** mías revisando: casi 2 segundos de revisión por cada segundo de agente.
- **US$189,90** a precio de lista de los tokens consumidos. Es un precio sombra: con suscripción, el costo marginal fue cero.

La cifra que más me interesa es la primera. Dirigir agentes no elimina el trabajo humano; lo mueve a definir, revisar y decidir qué no entra.

### Lo que sigue

Ahora empieza la parte que más me interesa medir: qué preguntan las personas, cuántas respuestas valoran bien, cuánto cuesta cada conversación y qué pasa cuando se cambie el modelo. Lo contaré con las mismas reglas: cifras medidas, incluidas las que no favorecen.

¿Cuál de estas siete decisiones te ha costado más defender en tu equipo, y cuál te saltaste?

---

**Hashtags:** #IAGenerativa #ArquitecturaDeSoluciones #RAG #EvaluaciónDeLLM #PromptEngineering #IAResponsable

---

## Publicación promocional (para compartir el artículo)

Según la guía de RedactAI, va con un gancho propio y no solo con el enlace.

> El prompt decía «siempre consulta el inventario». En 2 de cada 3 intentos, el modelo no lo hizo y se inventó «quedan 5 unidades, en el primer piso».
>
> No lo arreglé con un prompt más enfático. Lo arreglé con código.
>
> Escribí sobre las 7 decisiones que llevaron a Melquíades, el asistente de recomendación de la librería de Le Tiende, a producción en ocho días, con 0 libros inventados en su suite de 52 pruebas, y sobre lo que salió mal en el camino. 👇
>
> [enlace al artículo]
>
> #IAGenerativa #EvaluaciónDeLLM #ArquitecturaDeSoluciones
