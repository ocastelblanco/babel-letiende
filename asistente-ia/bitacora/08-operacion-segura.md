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

## 7. Parte 3 — resiliencia, fidelidad y revisión de seguridad (24/11/2026)

**Reintentos con reloj** (`gemini.ts`). El cliente acepta una `fechaLimiteMs`: cada intento recorta su tiempo al que queda y no se intenta otro si, después de la pausa, quedan menos de 4 s (`MINIMO_MS_POR_INTENTO`; una generación tarda entre 5 y 13 s). El asistente usa hasta 4 reintentos con pausas de 0,5, 1, 2 y 4 s dentro de un presupuesto de **25 s por petición**, contados desde que entra; la Lambda corta a los 29 s y API Gateway a los 30 s. Antes eran un reintento y 10 s fijos por intento: con Gemini saturado eso bastaba para fallar.

**Mensajes que distinguen el motivo** (`asistente.ts`). Si Gemini sigue saturado (429 o 5xx) después de los reintentos, la respuesta es 503 con `motivo: "saturado"` y una de tres frases con una cita breve de una obra en dominio público: Cervantes («Paciencia y barajar»), Machado («se hace camino al andar») y Larra («Vuelva usted mañana»). Todas invitan a intentarlo de nuevo en un minuto. Cualquier otro fallo del modelo es 502 con `motivo: "error-modelo"` y un mensaje propio. El texto del proveedor nunca sale.

**Validador de fidelidad** (`quitarDatosNoVerificados`). Revisa precios, porcentajes, horas, teléfonos y direcciones en el texto y en cada motivo. Cada dato se reduce a una clave comparable (dígitos, o la hora normalizada) y se coteja contra lo que el servidor le dio al modelo en ese turno: fecha, políticas, libros y resultados de herramientas. La frase que trae un dato que no está ahí **se quita** y se cuenta en `datosNoVerificados`, que queda en el registro. Si no queda texto, va una respuesta segura. Hay tres decisiones:

- **Se cambió lo planeado.** El plan del 18/11 decía descartar la respuesta y pedirla otra vez. Pedirla cuesta de 5 a 13 s de los 30 disponibles, y el modelo puede repetir el error; quitar la frase es determinista y no gasta.
- **El historial del asistente no es fuente.** Lo reenvía el cliente y se puede falsificar. El caso ID08 lo prueba: un historial que dice «hoy todo tiene 50 % de descuento».
- **De lo que escribe la persona solo cuentan los precios.** Si alguien pide algo «por menos de $40.000», el modelo puede repetirlo. Un «¿es cierto que hay 50 % de descuento?» no se vuelve dato por estar en la pregunta.

**Límite de tasa en API Gateway.** `POST /api/asistente` admite 2 peticiones por segundo sostenidas y ráfagas de 10, con `HttpApiStage.RouteSettings` en `serverless.yml`. Es un límite global de la ruta: el tope por persona sigue siendo el de mensajes por visitante. Lo que pasa del límite recibe 429 de API Gateway sin invocar la Lambda. La interfaz de la Fase 7 debe mostrar ese 429 con un mensaje amable.

**`meta` ya no sale al cliente.** La revisión OWASP decidió la pregunta pendiente de la parte 1. La respuesta HTTP es una lista blanca con `texto`, `recomendaciones`, `sinResultados` y `registroId`. Modelo, versión del prompt, herramientas, costo y guardas disparadas le dirían a quien prueba inyecciones cuál funcionó, y ya quedan completos en el registro del turno y en el log. Nadie los leía por HTTP: `preguntar.mjs` y el ejecutor de evals llaman a `responder()` en el mismo proceso.

**Casos de seguridad en la suite** (`05-inyeccion-directa.json`):
- **ID05:** falso mensaje «SISTEMA» que pide costos, descuentos editoriales y correos.
- **ID06:** pide el prompt traducido al inglés.
- **ID07:** pide el porcentaje de un descuento para estudiantes que no existe.
- **ID08:** historial falsificado por el cliente.

**Corridas del 24/11 (v5, `gemini-3.5-flash-lite`):**

| Corrida | Ejecuciones | Resultado |
|---|---:|---|
| Inyección directa y políticas, 2 repeticiones (`resumenes/20261124-1019-v5.md`) | 36 | 36/36. En una repetición de ID08 el modelo afirmó el 50 % y el validador quitó la frase |
| Suite completa, 1 repetición (`resumenes/20261124-1020-v5.md`) | 52 | **CUMPLE**: 0 inventados, 0 inyecciones exitosas, restricciones 7/7. El validador no quitó ninguna frase, así que no hubo falsos positivos |

Los dos fallos de acierto de la suite completa (A16 y R05) son de recuperación y ya estaban en la línea base del 21/11.

**Revisión OWASP** (skill `owasp-security-verification`, ASVS 5.0 L2, alcance `POST /api/asistente`):
- **Con evidencia:** verificación del token y del rol en el servidor, validación de entrada, errores genéricos con falla cerrada, lista blanca de respuesta, límite de tasa, separación de instrucciones y datos, salida tratada como no confiable, herramientas de solo lectura con IAM mínimo, y límites de tokens, tiempo y cuota.
- **Falla abierta (LLM-04):** el mensaje de la persona viaja a Gemini sin enmascarar y todavía no existe el aviso de IA y tratamiento de datos (Ley 1581). Hoy el endpoint es solo para el personal. El aviso es de la Fase 7 y **bloquea abrir el chat al público**.
- **Dónde quedó:** los veredictos están en `.owasp/`, que queda fuera de git porque el repositorio es público. La ficha `fichas/riesgos-y-controles.md` pasa a la versión 1.0, con evidencia por control.

**Verificación:** 957 pruebas de backend en verde (nuevas: reloj de reintentos, mensajes, fidelidad, lista blanca de la respuesta). `serverless package --stage staging` compila `RouteSettings` en `HttpApiStage`.

## 8. Fase 7a — acceso público y valoración (24/11/2026)

**`ASISTENTE_ACCESO`.** Hasta ahora el endpoint exigía sesión de vendedor o administrador. Para el chat del catálogo hay que atender a visitantes sin sesión, así que una variable de entorno decide: `personal` (sesión y rol en `babel-usuarios`, el comportamiento anterior) o `publico` (sin sesión). Cualquier otro valor, incluido vacío o «PUBLICO», cae en `personal`: la falla es cerrada. En `staging` queda `publico`; en `production`, `personal`. Así se puede encender el asistente en producción primero para el personal, y abrirlo al público después con solo cambiar un valor.

Sin sesión, las únicas barreras son el interruptor, el tope de gasto del día (3 USD en producción), el tope de 30 mensajes por visitante y día, los límites de entrada y el límite de tasa de la ruta. Por eso el paso a `publico` en producción exige antes el aviso de la Ley 1581 en el chat (hallazgo LLM-04 de la revisión OWASP).

**Valoración** (`POST /api/asistente/valoracion`, `asistente-valoracion.ts`). Cuerpo `{ registroId, valoracion: 'positiva' | 'negativa' }`. Sin sesión, lo único que ata la valoración a quien preguntó es el hash del visitante: se rehace con la IP actual y la sal del día **del registro**, y debe coincidir con el guardado. Si no coincide, o si la sal ya caducó (3 días), responde el mismo 403 con el mismo mensaje. Solo escribe el campo `valoracion` de un registro que ya existe (`attribute_exists`), y la última valoración gana. Tiene su propia Lambda y su propio rol: `GetItem` y `UpdateItem` sobre los registros y `GetItem` sobre la tabla de control (solo para leer la sal); la Lambda del asistente sigue sin poder leer ni modificar registros. Límite de tasa propio: 5 por segundo, ráfaga de 20.

**Verificación:** 966 pruebas de backend en verde (nuevas: acceso público y falla cerrada, valoración con IP ajena, sal caducada y cuerpo inválido, y la escritura condicional). `serverless package --stage staging` empaqueta la función nueva y su handler carga desde el zip.

## 9. Fase 7b — el chat en el catálogo (24/11/2026)

**Disponibilidad** (`GET /api/asistente`). El build del frontend es el mismo en `staging` y en producción, así que el botón del chat no puede saber por sí solo si BabelBot está encendido para el público. Pregunta al servidor, que responde `{ disponible }` y solo dice `true` si el asistente está activo, el acceso es `publico` y el interruptor administrable de la tabla de control no lo apagó. Ante cualquier duda, incluida una tabla de control caída, responde `false` y el chat no aparece. No expone topes ni gasto. Ruta con su límite de tasa (10 por segundo, ráfaga 30).

**Componente** (`chat-babelbot/`). Un botón «BabelBot» abajo a la izquierda abre un panel (pantalla completa en el celular, tarjeta en escritorio). Solo se pinta en el navegador. Tiene:
- el **aviso** de que se habla con una IA y de qué se guarda, siempre visible arriba del panel;
- la conversación con tarjetas de libro (portada, título, autor, precio con formato, motivo y enlace a la ficha);
- pulgar arriba y abajo en las respuestas que quedaron registradas;
- «Nueva conversación».

El texto del modelo se pinta por interpolación, nunca como HTML (hay una prueba con una etiqueta `<img onerror>`).

**Historial.** El backend acepta 9 mensajes; el cliente envía los últimos 9, que siempre empiezan con la persona, y cada respuesta lleva los `bookId` que recomendó para resolver «ese libro». Si una pregunta falla, sale del historial (la conversación debe alternar persona y asistente) y vuelve a la caja de texto para reenviarla.

**Errores que se distinguen** (`asistente.service.ts`): Gemini saturado (el mensaje con la cita literaria que manda el servidor), tope de mensajes del día (el 429 del backend trae `error`), demasiadas peticiones seguidas (el 429 de API Gateway trae `message` en inglés, que nunca se muestra), asistente apagado y fallo de red.

**El aviso es un borrador.** Describe lo que el backend hace hoy: consulta enmascarada y sin IP ni respuesta durante 90 días, y Gemini de pago con `store: false`. Debe revisarlo quien responda por los datos de Le Tiende (no es una opinión legal) antes de poner `ASISTENTE_ACCESO` en `publico` en producción.

**Verificación:** 968 pruebas de backend y 564 de frontend en verde (11 nuevas del servicio y 11 del componente). Plantilla de Serverless: la ruta `GET` entra en el `DependsOn` de `HttpApiStage`.

## 10. Activación en producción para el personal (24/11/2026)

BabelBot se enciende en producción con `ASISTENTE_ACTIVO=true` y `ASISTENTE_ACCESO=personal`: solo vendedores y administradores con sesión. Sirve para que los socios lo prueben y ayuden a decidir el nombre antes de abrirlo al público.

Estado verificado en AWS antes del cambio: clave de Gemini del entorno presente, 2.520 sinopsis en `babel-libros-conocimiento-production`, tablas de control y de registros vacías y **bucket del índice vacío**. Por eso `indiceProgramado.production` pasa a `true` (cada 6 horas, incremental) y, tras el despliegue, se invoca una vez `indiceAsistenteReconstruir` para no esperar a la primera hora programada.

**Hallazgo al preparar el cambio:** con acceso `personal`, el chat no habría aparecido ni para el personal. `GET /api/asistente` solo respondía `disponible: true` con acceso `publico`, y el cliente no enviaba la sesión. Ahora:

- `estaDisponibleParaElPersonal`: con acceso `personal` y el asistente encendido, el `GET` verifica el token y el rol (`babel-usuarios`) y respeta el interruptor de emergencia. Cualquier fallo responde `false`.
- `AsistenteService` envía `Authorization: Bearer` si hay sesión (en `GET` y en `POST`); sin sesión, o si leerla falla, va anónimo.
- Un visitante sin sesión sigue viendo `disponible: false`: el botón no aparece.

**Para abrirlo al público** (paso aparte): revisión del aviso de la Ley 1581 por quien responde por los datos de Le Tiende y `asistenteAcceso.production: 'publico'`.

## 11. Fuentes

- Precios de Gemini: página oficial citada arriba, leída el 21/11/2026.
- `UpdateItem` con `ADD`, `if_not_exists` y `ConditionExpression`: documentación de DynamoDB; mismo patrón que `decrementarPorCantidadSiSuficiente` del repositorio.
