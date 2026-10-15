# Plan — Duplicados sin ISBN al catalogar

**Fecha:** 15/10/2026 · **Estado:** decisiones D1-D5 aprobadas (PR #145 fusionado). Tareas 1 y 2 fusionadas y desplegadas; Tarea 3 implementada (PR abierto, pendiente de verificación en `staging`).

## 1. Origen: el incidente del 14/10/2026

En producción, la ficha `GET /api/libros/7356e343-…` (*A la sombra de Occidente*) respondía 500. Al investigarlo aparecieron dos problemas distintos:

1. **El 500 en sí:** `handlerDetalle` le pasaba a `resolverEjemplares` el ítem crudo de DynamoDB. En un libro sin ISBN la clave `isbn` llega ausente (`undefined`, no `null`), así que se hacía un `Query` a `isbn-index` con clave `undefined`. Afectaba a 11 libros. **Corregido en el PR #144**, fusionado y verificado en producción.
2. **Los duplicados:** 7 de esos 11 libros eran copias exactas de un libro con ISBN: mismo título, PVP, portada, editorial y ubicación, creadas por la misma persona con 5 a 27 segundos de diferencia. Se borraron directamente en DynamoDB el 14/10/2026, tras verificar que ninguno tenía ventas. Los otros 4 libros sin ISBN son legítimos (ediciones artesanales sin registro, confirmado por el usuario) y se conservan.

Este plan evita que vuelvan a aparecer esos duplicados.

## 2. Causa raíz (verificada en los registros de CloudWatch y en el código)

En los tres casos revisados (*A la sombra de Occidente*, *MARIANELA* y *El Fin Del Rock*), las invocaciones Lambda de producción siguen el mismo patrón:

| *A la sombra de Occidente* (10/09/2026, UTC) | Lambda | Lectura |
|---|---|---|
| 19:10:30 – 19:10:33 | `librosPorIsbn` → `metadatos` | Primera búsqueda por ISBN; el formulario se llena |
| 19:10:36 | `librosPorIsbn` | **Segunda búsqueda del mismo ISBN**, en el mismo instante en que se pulsa guardar |
| 19:10:37 | `catalogarLibro` | Se crea el libro **con** ISBN; el formulario se vacía |
| 19:10:37 – 19:10:39 | `metadatos` | La segunda búsqueda responde **después** de vaciar el formulario y vuelve a llenar título, autor, editorial, portada y PVP. El campo ISBN queda vacío |
| 19:10:43 | `catalogarLibro` | El vendedor ve el formulario lleno y vuelve a pulsar guardar: se crea el libro **sin** ISBN |

Hay dos variantes de la misma condición de carrera en `CatalogarLibroComponent` (`src/app/features/gestionar/catalogar-libro.component.ts`):

- **Variante A: el blur del campo ISBN al pulsar guardar.** Tocar "Catalogar libro" hace que el campo ISBN pierda el foco. Eso dispara `alPerderFocoIsbn` → `dispararBusquedaPorIsbn`, que lo primero que hace es `await obtenerIdToken()`. Durante esa espera no hay ningún indicador de búsqueda activo (`buscandoDuplicados` se activa *después* del `await`), así que el botón sigue habilitado y el `click` llega a `guardar()`. El libro se guarda, `reiniciarFormulario()` vacía el formulario y, segundos después, la búsqueda ya obsoleta lo vuelve a llenar. `buscarYPrecargarMetadatos` solo rellena los campos vacíos, y todos lo están.
- **Variante B: búsquedas superpuestas.** Dos búsquedas seguidas del mismo ISBN comparten el mismo booleano `buscandoMetadatos`. El `finally` de la primera lo pone en `false` mientras la segunda sigue en curso, el botón se habilita, se guarda, y la segunda búsqueda llena el formulario ya vacío. Es el caso de *MARIANELA* (30/08/2026, 21:15:54 y 21:15:57).

Ninguna respuesta se coteja con el estado actual del formulario: ni con el ISBN que se buscó ni con si el formulario se reinició entretanto.

Además, la detección de duplicados existente es **solo por ISBN** (`PRD.md` §5.2). Un libro sin ISBN no la activa nunca, así que el segundo guardado pasó sin ningún aviso.

## 3. Decisiones de diseño (propuestas; se aprueban al fusionar este PR)

| # | Decisión | Propuesta | Por qué |
|---|---|---|---|
| D1 | ¿Cuándo dos libros son un "posible duplicado" sin ISBN? | **Mismo título normalizado, en la misma ubicación, y al menos uno de los dos sin ISBN.** El autor no se exige, pero se muestra en el aviso para que el vendedor compare. | El formato del autor varía entre fuentes: el par de *MARIANELA* tenía "Benito Pérez Galdós" y "PEREZ GALDOS, BENITO". Si se exigiera el autor, ese caso no se habría detectado. Si ambos libros tienen ISBN y estos difieren, son ediciones distintas y no se avisa (eso ya lo cubre el flujo por ISBN). |
| D2 | ¿Bloquear o avisar? | **Avisar sin bloquear**, con tres salidas: "Es el mismo libro: sumar ejemplares", "Es otro libro: catalogar igual" y "Cancelar". | Hay libros legítimos sin ISBN y títulos repetidos legítimos en una misma ubicación (ediciones artesanales, distintas traducciones). |
| D3 | ¿Dónde se hace la comprobación? | **En el backend, dentro de `POST /api/libros`**, consultando un GSI nuevo `ubicacion-index`. Responde `409` con los candidatos, salvo que el cliente reenvíe con `confirmarLibroDistinto: true`. | El índice ligero del cliente (`GET /api/libros/indice`) se carga **una vez por sesión** y no incluye lo que se cataloga después. No habría detectado ninguno de estos duplicados, creados segundos después de su gemelo. Tampoco cubre a dos vendedores en dispositivos distintos. El backend es la única fuente confiable (`CLAUDE.md` A08). |
| D4 | Si es el mismo libro, ¿cómo se suman los ejemplares? | `POST /api/libros/:bookId/fusionar-duplicado` sobre el registro existente, enviando **los datos del registro existente** (no los del formulario) y la cantidad del formulario como `ejemplaresNuevos`. Si el existente no tiene ISBN y el nuevo sí, se envía el ISBN nuevo. | `fusionarLibroDuplicado` (`dynamodb.ts`) hace `REMOVE isbn` cuando recibe `isbn: null`. Si se enviara el formulario sin ISBN, se **borraría el ISBN** del registro existente. |
| D5 | Fallo de la comprobación (p. ej. el GSI todavía está en estado `CREATING`) | **Se deja pasar el guardado sin bloquearlo** (se registra en el log y se cataloga normalmente). | Catalogar es la ruta crítica del sistema (`CLAUDE.md` §1). Un aviso auxiliar nunca debe impedir guardar. |

Este plan **revisa a propósito** la frase de `PRD.md` §5.2: "un libro sin ISBN nunca dispara este control (evita falsos positivos por coincidencia de título/autor)". El control nuevo se limita a la misma ubicación y no bloquea, lo que acota los falsos positivos que motivaron esa frase.

## 4. Tarea 1 — Condición de carrera en Catalogar (frontend, causa raíz)

Rama `fix/carrera-busqueda-isbn-catalogar`. Solo `CatalogarLibroComponent` (y su `.spec.ts`), sin backend.

- [ ] Indicador de búsqueda **síncrono**: `dispararBusquedaPorIsbn` marca la búsqueda como activa antes del primer `await`, incluido el `obtenerIdToken()`. Con eso el botón "Catalogar libro" queda deshabilitado desde el mismo tick del blur y se cierra la variante A.
- [ ] **Generación de búsqueda:** un contador `generacionBusquedaIsbn` que aumenta en cada `dispararBusquedaPorIsbn` y en `reiniciarFormulario()`. Los resultados de `buscarDuplicadosPorIsbn` y `buscarYPrecargarMetadatos` solo se aplican, y los indicadores solo se apagan, si la generación sigue vigente **y** el campo `isbn` todavía coincide con el ISBN buscado. Con eso se cierran la variante B y el llenado tras el reinicio.
- [ ] El blur no relanza la búsqueda si el ISBN no cambió desde la última búsqueda (`ultimoIsbnBuscado`). Así se evita la búsqueda redundante al tocar "Catalogar libro".
- [ ] Mismo resguardo de generación en los otros llenados asíncronos del formulario: `buscarPvpCandidatoSinIsbn` y `seleccionarCandidato`.
- [ ] Defensa en `guardar()`: si hay una búsqueda en curso, no envía nada (el botón ya estaría deshabilitado; esto cubre un envío del formulario con Enter).
- [ ] Pruebas con promesas controladas que reproduzcan **las dos líneas de tiempo reales** de §2: blur y submit en el mismo tick; dos búsquedas superpuestas en las que la primera termina antes; una respuesta que llega después de `reiniciarFormulario()` y no debe tocar el formulario. Cada prueba debe fallar sin el arreglo.
- [ ] Verificación en `staging` por el usuario: escanear un libro, pulsar "Catalogar libro" de inmediato, y comprobar que el formulario queda vacío y no aparece ningún registro duplicado.

## 5. Tarea 2 — Comprobación de posibles duplicados en `POST /api/libros` (backend)

Rama `feature/aviso-duplicado-sin-isbn-backend`.

- [ ] GSI nuevo **`ubicacion-index`** sobre `babel-libros` en `serverless.yml`: clave de partición `ubicacionId`, proyección `INCLUDE` (`titulo`, `autor`, `isbn`, `pvp`, `cantidadTotal`, `cantidadDisponible`). DynamoDB rellena el índice solo. Un libro sin `ubicacionId` (anterior a la migración `estanteId`→`ubicacionId`) queda fuera, como en un índice disperso. CloudFormation solo admite **un GSI nuevo por despliegue**: este PR no puede incluir otro.
- [ ] `handlerCrear`: si el cuerpo no trae `confirmarLibroDistinto: true`, hace un `Query` a `ubicacion-index` por el `ubicacionId` del libro nuevo. Con `normalizarParaComparacion` (ya existe en `libros.ts`) compara los títulos y aplica la regla D1. Si hay candidatos, responde `409` con `{ error, posiblesDuplicados: [{ bookId, titulo, autor, isbn, pvp, cantidadTotal }] }` sin escribir nada. Si la consulta falla, cataloga normalmente y lo registra en el log (D5).
- [ ] `validarDatosNuevoLibro`: acepta `confirmarLibroDistinto` opcional y booleano (`400` si viene con otro tipo). Nunca se persiste.
- [ ] IAM: permiso `dynamodb:Query` sobre `babel-libros/index/ubicacion-index` en el rol de la función `catalogarLibro`, y solo en ese (mínimo privilegio, `CLAUDE.md` A05). Sin módulos nuevos, así que el `package.patterns` no cambia. Revisarlo igualmente con `npm run build:api` (gotcha del PR #137).
- [ ] Pruebas: título igual con el nuevo sin ISBN → `409`; título igual con el existente sin ISBN y el nuevo con ISBN → `409`; los dos con ISBN distintos → `201`; misma ubicación con otro título → `201`; mismo título en otra ubicación → `201`; diferencias de mayúsculas y tildes → `409`; `confirmarLibroDistinto: true` → `201` sin consultar el índice; fallo del `Query` → `201`; `confirmarLibroDistinto` no booleano → `400`.
- [ ] Despliegue: comprobar en `staging` que el GSI quedó `ACTIVE` antes de dar la tarea por cerrada. En producción, el índice tarda un rato en rellenarse (unos 2.500 libros); mientras tanto rige D5.
- [ ] Al cerrar: `tech-specs.md` (índices de `babel-libros`) y `PRD.md` §5.2 (texto de la detección de duplicados).

## 6. Tarea 3 — Aviso de posible duplicado en Catalogar (frontend)

Rama `feature/aviso-duplicado-sin-isbn-frontend`. **Solo se abre cuando la Tarea 2 esté fusionada y desplegada** (regla del staging compartido).

- [x] `guardar()` atiende el `409` con `posiblesDuplicados`: muestra un aviso con mismo estilo que las advertencias de duplicado existentes (`DESIGN.md`). El aviso lista cada candidato (título, autor, ISBN o "sin ISBN", PVP y cantidad) y ofrece tres botones:
  - **"Es el mismo libro: sumar N ejemplares"** → `fusionar-duplicado` según D4, con los datos del registro existente. Hay un botón por candidato; el vendedor elige cuál. Los datos del existente (editorial, portada, descuento) se leen de su ficha con `LibrosService.obtenerDetalle`, porque el índice `ubicacion-index` no los proyecta.
  - **"Es otro libro: catalogar igual"** → reenvía `POST /api/libros` con `confirmarLibroDistinto: true`.
  - **"Cancelar"** → cierra el aviso sin enviar nada y conserva el formulario.
- [x] Tras cualquiera de los dos guardados, el mismo `reiniciarFormulario()` de siempre, que conserva el panel de ubicación.
- [x] Pruebas: aparece el aviso con los candidatos; la fusión envía los datos del existente (y no borra su ISBN); la confirmación reenvía con la bandera; cancelar no envía nada; un `409` sin `posiblesDuplicados` (otro error) sigue mostrando el mensaje de siempre.
- [ ] Verificación en `staging` por el usuario con un libro sin ISBN de prueba, catalogado dos veces en la misma ubicación.

## 7. Orden y motor JIT

Tareas 1 y 2 activas (son independientes: una es frontend y la otra backend), Tarea 3 en cola. Una rama y un PR por tarea, y nunca dos PR desplegando a `staging` a la vez. Se recomienda empezar por la Tarea 1: corrige la causa raíz por sí sola y no tiene riesgo de backend.
