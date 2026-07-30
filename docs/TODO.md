# TODO.md — Babel

Motor JIT: este documento mantiene **siempre exactamente 2 tareas atómicas** activas. Al completar cualquiera, se elimina, se mueve el resumen a `MEMORY.md` §2, y se calcula la siguiente tarea más prioritaria comparando `PRD.md` (roadmap) contra `MEMORY.md` (estado actual).

**Prioridad de selección aplicada (2026-07-27):** el usuario cerró su ronda de pruebas manuales en `staging` (pausa iniciada 2026-07-25 tras `ajustes-finales.md` Tareas A-G) y entregó un nuevo lote de ajustes en `ajustes-2026-07-27.md`. El motor JIT se retoma con las 3 tareas que ese documento describe para Babel, en el orden en que aparecen en el documento, **antes** de las 2 últimas piezas del roadmap (modo offline, producción) que quedaron en pausa — instrucción explícita del usuario. La cuarta pieza de `ajustes-2026-07-27.md` — el generador de QR para imprimir — es una herramienta fuera de Babel (no vive en la app, no consume su API) y el usuario la excluyó deliberadamente de este orden: se rastrea aparte, en su propia pista independiente (ver sección al final), sin ocupar ninguno de los 2 slots activos.

**Tarea 1 completada (2026-07-27):** vista Lista/Tarjetas + orden Título/Autor/Precio en `CatalogoPublicoComponent` (PR #67, fusionado por el usuario). Se promueve el siguiente ítem del backlog (Reporte de ventas — Descuento de venta) al segundo slot activo.

**Tarea 1 (Gestionar > Editar) completada (2026-07-27):** todos los campos del libro editables + paneles como Catalogar (PR #69, probado por el usuario). Con esto se cierra el backlog completo de `ajustes-2026-07-27.md` salvo la pista independiente del generador de QR (ver más abajo). Queda un solo ajuste pendiente de esta ronda (Reporte de ventas) — se promueve **Modo offline** al segundo slot activo como siguiente pieza del roadmap, pero no debe iniciarse hasta cerrar también el Reporte de ventas y confirmar con el usuario que no hay más ajustes de esta ronda.

**Reporte de ventas completado (2026-07-27):** columna "Descuento de venta" en `handlerExportar` (PR #70, probado por el usuario en `staging`). Con esto se cierra el backlog completo de `ajustes-2026-07-27.md` — solo queda pendiente la pista independiente del generador de QR (ver más abajo), que el usuario confirmó dejar para después. El roadmap principal retoma sus últimas 2 piezas (`PRD.md` §6): el usuario eligió explícitamente **Modo offline primero**, luego Producción — se llenan los 2 slots activos en ese orden.

**Modo offline CANCELADO (2026-07-27, decisión explícita del usuario):** antes de planear la implementación (se llegó a producir un plan completo, descartado sin código), el usuario decidió cancelarlo por completo — los cortes de wifi en la librería son muy infrecuentes (menos de 1 al mes) y ya se resuelven compartiendo datos móviles del celular con el que se cataloga; no se justifica el costo de mantener una cola de sincronización. Ver `PRD.md` §6/§9 para el detalle. En su lugar, el usuario trajo 2 ajustes nuevos a los reportes, que ocupan los 2 slots activos antes de retomar Producción.

**Reportes de ventas e inventario completados (2026-07-27):** las 2 tareas de arriba se fusionaron (PR #72, PR #73) y el usuario las probó en `staging` — funcionan bien. Con esto se cierra por completo `ajustes-2026-07-27.md`, salvo la pista independiente del generador de QR (el usuario confirmó dejarla para después). Ya no queda ningún otro ajuste pendiente antes de producción.

**Solo 1 tarea activa (sin item para el segundo slot):** el único ítem que le queda al roadmap principal (`PRD.md` §6) es "Primer despliegue a producción" — no hay un segundo ítem que promover (mismo caso ya documentado el 2026-07-25 al cerrar `ajustes-finales.md`). La pista del generador de QR sigue deliberadamente fuera de los slots del motor JIT por decisión del usuario.

**Pista independiente del generador de QR — COMPLETA (2026-07-29):** `tools/qr-muebles/` implementado, revisado (2 rondas de `architect`) y fusionado (PR #76) — detalle completo movido a `MEMORY.md` §2. Sin pendientes salvo que el usuario confirme el escaneo físico con celular real antes de imprimir el lote completo (no bloquea nada de este documento).

**Prioridad de selección aplicada (2026-07-29):** el usuario trajo un nuevo lote de 4 ajustes a Babel (3 fixes + 1 pregunta/fix, ninguno documentado antes en `PRD.md`/`ajustes-*.md`). Se investigó el código real (desplegables de ubicación física, componente Catalogar, librería de escaneo `@zxing/browser`, modelo de datos `Libro`) antes de escribir las tareas — hallazgo clave: `bookId` es la clave primaria real, `isbn` es un índice secundario nullable SIN validación de unicidad hoy (el mismo ISBN puede tener N registros). Se resolvieron 2 preguntas de producto con el usuario (ver Tarea 2 abajo) antes de detallar el alcance. Estas 2 tareas ocupan los 2 slots activos; **"Primer despliegue a producción" queda pospuesta** (sin cambio real de fondo — ya estaba bloqueada por falta de confirmación explícita, ver abajo) hasta cerrar este lote, mismo patrón ya usado el 2026-07-27 con `ajustes-2026-07-27.md`. **No se ha iniciado la implementación** — el usuario pidió explícitamente esperar su confirmación antes de escribir código.

---

## Tarea 1 — Orden alfabético en los desplegables de Espacio/Mueble/Ubicación

**Qué:** los `<select>`/listas de Espacio, Mueble y Ubicación deben mostrar sus opciones en orden alfabético (por `nombre`, sensible a mayúsculas/tildes en español — `localeCompare('es', { sensitivity: 'base' })`), en las 4 pantallas donde aparecen hoy sin ningún orden garantizado (heredan el orden de inserción de DynamoDB):

1. `GestionUbicacionFisicaComponent` (`/admin/ubicaciones`) — select de Espacio en la pestaña Muebles, cascada Espacio→Mueble en la pestaña Ubicaciones.
2. `CatalogarLibroComponent` (`/gestionar`, pestaña Catalogar) — cascada Espacio→Mueble→Ubicación del panel "Ubicación del libro".
3. `EditarLibroComponent` (`/gestionar`, pestaña Editar) — misma cascada, para reubicar un libro ya catalogado.
4. `CatalogoPublicoComponent` (`/`) — filtro público por Espacio + Mueble.

**Dónde implementarlo:** fix centralizado en `UbicacionFisicaService` (`src/app/core/api/ubicacion-fisica.service.ts`) — ordenar los 3 arrays (`espacios`, `muebles`, `ubicaciones`) una sola vez, en el punto donde el servicio expone sus Signals de lectura. Los 4 componentes de arriba consumen ese mismo servicio y heredan el orden sin necesitar cambios propios (confirmado por exploración de código — ninguno aplica `.sort()` hoy). Sin cambios de backend: el dato ya viaja completo al cliente, basta con ordenar ahí.

**Verificación esperada:** los 3 niveles quedan alfabéticos en las 4 pantallas, incluida la cascada (el orden se conserva tras filtrar por el padre elegido).

---

## Tarea 2 — Mejoras al flujo de Catalogar (cámara, portada, duplicados)

Vive en `CatalogarLibroComponent` (`src/app/features/gestionar/catalogar-libro.component.{ts,html}`) — 3 ajustes relacionados, agrupados en una sola tarea por tocar el mismo componente.

### 2.1 — Aspect ratio horizontal (~3:1) de la cámara

El escaneo usa `@zxing/browser` (`BrowserMultiFormatReader`, solo `BarcodeFormat.EAN_13`), cámara trasera (`getUserMedia({ video: { facingMode: 'environment' } })`), sin ningún control de aspect ratio hoy — el `<video #videoEscaner>` solo tiene clases Tailwind (`w-full rounded-xl`), se adapta al ancho del contenedor. Como el código de barras (EAN-13) es horizontal, un recuadro más ancho que alto facilita el encuadre.

- Aplicar `aspect-ratio: 3/1` (clase Tailwind arbitraria `aspect-[3/1]` o equivalente) al contenedor/`<video>`, con `object-fit: cover` para que recorte visualmente sin deformar la imagen.
- Opcional/best-effort: agregar `aspectRatio: { ideal: 3 }` a los constraints de `getUserMedia` (junto a `facingMode`) para pedirle al navegador un stream más cercano a ese formato de forma nativa — no garantizado en todos los navegadores/dispositivos (advisory, no mandatory), el recorte CSS es lo único que garantiza el resultado visual final.
- Sin cambios de backend ni de modelo de datos.

### 2.2 — Thumbnail de portada

Hoy el campo `portadaUrl` es solo un `<input>` de texto — no hay preview de imagen en el formulario principal (sí existe una miniatura pequeña, pero solo en la lista de candidatos de búsqueda por título/autor).

- Agregar un `<img [src]="portadaUrl">` visible solo cuando el campo no está vacío, para que el catalogador confirme visualmente que es el libro correcto antes de guardar.
- Debe actualizarse reactivamente con cualquier fuente que llene `portadaUrl`: autocompletado por ISBN (escaneo o entrada manual), selección de un candidato de búsqueda por título/autor, o edición manual del campo.
- Criterio visual: consistente con `DESIGN.md` (tamaño más grande que la miniatura de 56×40px de la lista de candidatos, ya que aquí es la única portada mostrada).

### 2.3 — Detectar libros ya catalogados por ISBN (evitar duplicados)

**Decisiones de producto ya confirmadas con el usuario (no repreguntar):**
- La detección es **solo por ISBN exacto** — libros sin ISBN no participan (el riesgo de falsos positivos por coincidencia de título/autor no se justifica).
- Si hay **más de una coincidencia** (ya es posible hoy, sin validación previa): mostrar una lista para elegir cuál editar — mismo patrón visual ya usado para los candidatos de búsqueda por título/autor (portada, título, más la ubicación resuelta y cantidad disponible de cada coincidencia) — con opción de cerrar la lista y catalogar como entrada nueva independiente de todos modos.
- El campo "número de ejemplares" pasa a significar siempre **"cuántos ejemplares NUEVOS agregas ahora"** (no el total) — si hay un duplicado y el catalogador continúa sobre él, ese número se **suma** a `cantidadTotal`/`cantidadDisponible` del registro existente al guardar, en vez de reemplazarlo. Sin duplicado, el comportamiento no cambia (ya funciona así: `cantidadTotal` = lo que el vendedor ingresa).

**Flujo:**
1. Disparador: mismo punto donde hoy se dispara `MetadatosService.obtenerMetadatos(isbn)` (escaneo, blur del ISBN manual, o selección de candidato con ISBN).
2. Backend nuevo: buscar libros catalogados por ISBN exacto — `babel-libros` ya tiene un GSI por `isbn` (`tech-specs.md` §5.1), reutilizarlo. Ej. `GET /api/libros/por-isbn/:isbn` (vendedor/administrador) → devuelve **todos** los registros que coincidan (puede ser 0, 1 o varios), con Espacio/Mueble/Ubicación ya resueltos a nombre (mismo patrón que `handlerDetalle`/`handlerInventario`), `cantidadTotal`, `cantidadDisponible` y el resto de campos de `Libro`.
3. Frontend:
   - 0 resultados → sin cambios, flujo actual.
   - 1 resultado → alerta breve ("Este libro ya está catalogado: {Espacio}/{Mueble}/{Ubicación}, N disponibles") + precarga el formulario completo, incluida la selección del panel "Ubicación del libro" (sobrescribe lo ya seleccionado ahí — el catalogador está editando ese registro, no creando uno nuevo).
   - >1 resultado → lista de coincidencias para elegir (ver arriba).
   - Al guardar sobre un duplicado: reutilizar el endpoint de edición ya existente (`PUT /api/libros/:bookId`, el mismo que usa `EditarLibroComponent`), sumando el número de ejemplares nuevos a `cantidadTotal`/`cantidadDisponible` actuales antes de enviar — no crear un endpoint de "crear" duplicado. El vendedor puede además ajustar PVP/descuento/ubicación antes de guardar, igual que en Editar.

**Verificación esperada:** escanear/ingresar un ISBN ya catalogado no crea un segundo registro por accidente; con una sola coincidencia, el formulario queda listo para solo ajustar cantidad/ubicación y guardar; con varias, el catalogador elige cuál.

---

## Backlog

Sin ítems adicionales — "Primer despliegue a producción" (pospuesta, ver arriba) sigue siendo la última pieza pendiente del roadmap principal una vez se cierre este lote.

---

## Primer despliegue a producción (pospuesta)

`PRD.md` §6 — sin desglosar todavía en pasos atómicos; incluye al menos decidir dominio personalizado, revisar el objetivo de costo $0 con tráfico real, y una checklist de lo ya verificado en `staging` vs. lo que falta confirmar en producción.

**No iniciar sin confirmación explícita del usuario** — es la pieza más costosa de revertir de todo el roadmap (`ajustes-finales.md`/`ajustes-2026-07-27.md` ya establecieron este criterio). Queda pospuesta mientras las Tareas 1-2 de arriba ocupan los 2 slots activos del motor JIT; al cerrarlas, preguntar si el usuario quiere arrancarla ya o prefiere otra ronda de pruebas/ajustes primero.
