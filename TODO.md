# TODO.md — Babel

Motor JIT: este documento mantiene **siempre exactamente 2 tareas atómicas** activas. Al completar cualquiera, se elimina, se mueve el resumen a `MEMORY.md` §2, y se calcula la siguiente tarea más prioritaria comparando `PRD.md` (roadmap) contra `MEMORY.md` (estado actual).

**Prioridad de selección aplicada (2026-07-24):** se completó el modelo jerárquico Espacio→Mueble→Ubicación (PR #54, Tarea B del backlog de `ajustes-finales.md`) — la pieza fundacional de la que dependen las 5 tareas restantes del backlog. Sigue vigente la decisión del usuario: **no se retoma el plan de modo offline ni el despliegue a producción hasta cerrar todo el conjunto de `ajustes-finales.md`.** Se promueven las siguientes 2 tareas del backlog ordenado (`ajustes-finales.md` §"Backlog ordenado de implementación"): Tarea C (migrar `Libro.estanteId` → `ubicacionId`) sube a **Tarea 1**; Tarea D (vender desde la ficha) sube a **Tarea 2** — depende de que la Tarea 1 esté fusionada primero (necesita el campo ya migrado), mismo criterio de dependencia secuencial ya aplicado anteriormente en este backlog.

---

## Tarea 1 — [FEATURE]: migrar `Libro.estanteId` → `Libro.ubicacionId`

**Origen:** `ajustes-finales.md` Tarea C. Con el modelo Espacio→Mueble→Ubicación ya construido (PR #54, `/api/espacios`, `/api/muebles`, `/api/ubicaciones`), el siguiente paso es que los libros catalogados empiecen a usarlo — hoy `Libro.estanteId` sigue apuntando al modelo antiguo (`babel-estantes`, todavía intacto porque `CatalogarLibroComponent`/`CambiarEstanteComponent` dependen de él). Esta tarea es el punto de corte: después de ella, nada en el proyecto debe seguir escribiendo en `babel-estantes`.

**Qué ya existe y se puede reutilizar (confirmado en PR #54, no adivinado):**
- `GET /api/ubicaciones` (público, sin auth) ya devuelve `{ ubicacionId, muebleId, nombre }[]` — sirve para poblar cualquier `<select>` de ubicación.
- `GET /api/muebles`/`GET /api/espacios` (también públicos) ya permiten resolver nombre de mueble/espacio a partir de una `Ubicacion`, para mostrarlos como campos independientes.
- La ficha de libro (`/libro/:bookId`, `handlerDetalle` en `server/api/handlers/libros.ts`) ya resuelve y muestra la ubicación física del libro — hoy contra `babel-estantes` (`estante: { espacio, mueble, ubicacion }`), concatenados visualmente en el frontend con `—` entre cada campo (el hallazgo original de `ajustes-finales.md`: "no como una secuencia {ESPACIO} - {MUEBLE} - {UBICACION}"). Esta tarea cambia la fuente de datos (Espacio/Mueble/Ubicación reales, no texto libre) Y corrige la presentación (campos independientes).

**Qué hacer (orden sugerido):**
1. Backend: `POST /api/libros` (`handlerCrear` en `libros.ts`) — cambiar `estanteId` por `ubicacionId` en `DatosNuevoLibro`/`validarDatosNuevoLibro`; validar que el `ubicacionId` exista en `babel-ubicaciones` antes de guardar (mismo criterio que `handlerMuebles`/`handlerUbicaciones` validan a su padre). Actualizar `Libro` (modelo backend y `src/app/core/models/libro.model.ts`) para reemplazar `estanteId` por `ubicacionId`.
2. Backend: la ficha (`handlerDetalle`) debe resolver `ubicacionId` → `Ubicacion` → `Mueble` → `Espacio` (3 `GetItem` puntuales, no `Scan`) y devolver los 3 nombres como campos independientes en la respuesta (ej. `{ espacio: string, mueble: string, ubicacion: string } | null`, mismo shape final que hoy pero con la fuente de datos correcta).
3. Frontend: la ficha (`LibroDetalleComponent`) debe mostrar Espacio/Mueble/Ubicación como 3 líneas o campos separados, no concatenados con `—` (corrige el HTML actual).
4. Eliminar `handlerCambiarEstante` (`server/api/handlers/libros.ts`), la ruta `PATCH /api/libros/:bookId/estante`, `CambiarEstanteComponent` y la ruta `/libros/:bookId/estante` — quedan reemplazados por la pestaña "Editar" del área "Gestionar" (Tarea E, todavía no activa). Si Tarea E no está lista aún, evaluar dejar un placeholder mínimo o coordinar con el usuario si conviene esperar — **no dejar al vendedor sin ninguna forma de cambiar la ubicación de un libro ya catalogado** entre esta tarea y la Tarea E.
5. `CatalogarLibroComponent`: reemplazar el `<select>` de estante (que usa `EstantesService`) por selects de Ubicación (directamente, sin cascada Espacio→Mueble todavía — esa mejora de UX específica, con el panel "Ubicación del libro" persistente entre catalogaciones, es la Tarea E; esta tarea C solo necesita que el campo grabado sea `ubicacionId` válido).
6. Eliminar `EstantesService`, `server/api/handlers/estantes.ts`, el CRUD `/api/estantes`, la tabla `babel-estantes` de `serverless.yml`, y el modelo `Estante` (`estante.model.ts`) — ya nada los usa tras los pasos anteriores.
7. Cubrir con tests backend y frontend (catalogar con `ubicacionId` válido/inválido, ficha con campos independientes, ausencia de estante/ubicación resuelta).

**Definition of done:**
- [ ] `npm run build`, `npm run build:api`, `npm test -- --watch=false`, `npm run test:api` pasan sin errores
- [ ] Un libro se cataloga con una `Ubicacion` real (no un estante de texto libre)
- [ ] La ficha de un libro muestra Espacio/Mueble/Ubicación como campos independientes, no concatenados
- [ ] `EstantesService`/`estantes.ts`/`babel-estantes`/`Estante` ya no existen en el proyecto
- [ ] El vendedor sigue teniendo alguna forma de cambiar la ubicación de un libro ya catalogado (aunque sea provisional hasta la Tarea E)
- [ ] Verificado en vivo contra `staging`

---

## Tarea 2 — [FEATURE]: vender desde la ficha del libro

**Origen:** `ajustes-finales.md` Tarea D. Primera UI real para `POST /api/ventas` (hoy sin ningún frontend). **Depende de que la Tarea 1 esté fusionada** — el diálogo necesita que `Libro`/la ficha ya usen el campo `ubicacionId` migrado, para no construir sobre el modelo que la Tarea 1 está reemplazando.

**Decisiones ya confirmadas con el usuario (`ajustes-finales.md` §"Decisiones técnicas confirmadas"):**
- El diálogo "Vender" SÍ incluye selector de Forma de pago (obligatorio, mismo enum ya usado en Reportes).
- Cantidad > 1: se extiende el backend con un campo `cantidad` — **1 solo registro de `Venta`** representa N ejemplares (no N registros).
- La ficha de un libro agotado (`cantidadDisponible = 0`) sigue siendo accesible; solo se oculta el botón "Vender".

**Qué hacer (orden sugerido):**
1. Backend: `POST /api/ventas` (`handler` en `server/api/handlers/ventas.ts`) acepta un campo `cantidad` (entero positivo, default 1 si no viene — evaluar si default o requerido, criterio del usuario ya es "1 por defecto" en el diálogo, el backend puede exigirlo siempre y que el frontend mande 1 explícito). Reemplaza `decrementarSiPositivo` (decrementa exactamente 1) por una función nueva en `dynamodb.ts` que decremente condicionalmente por `cantidad` (rechaza si `cantidadDisponible < cantidad`, atómico). El registro de `Venta` guarda la `cantidad` vendida; `precioFinal`/`utilidad` se calculan sobre el total (¿por unidad o por el total de la transacción? — definir y documentar en el código, criterio sugerido: `pvp`/`costoLibro` quedan como snapshot unitario ya existente, se agrega `cantidad`, y `precioFinal`/`utilidad` representan el total de la transacción).
2. Frontend: botón "Vender" en `LibroDetalleComponent`, visible solo para vendedor/administrador autenticado (mismo patrón de guard visual que otros botones condicionados por rol) y solo si `cantidadDisponible > 0`. Al hacer clic, abre un diálogo con: cantidad (default 1, máximo `cantidadDisponible`), % descuento de venta (default 0), forma de pago (`<select>`, obligatorio), botones Cancelar/Confirmar.
3. Primera implementación real de `src/app/features/venta/` (hoy solo tiene un `.gitkeep`) o del cliente de venta donde tenga más sentido (evaluar si conviene un servicio nuevo `VentaService.registrarVenta(...)` o extender `VentasService` ya existente, que hoy solo exporta reportes).
4. Tras confirmar, refrescar la ficha (la disponibilidad bajó) y mostrar confirmación de éxito.
5. Cubrir con tests backend (cantidad válida/mayor a disponible, forma de pago faltante) y frontend (diálogo, botón oculto sin ejemplares, confirmación).

**Definition of done:**
- [ ] `npm run build`, `npm run build:api`, `npm test -- --watch=false`, `npm run test:api` pasan sin errores
- [ ] Un vendedor/administrador autenticado puede vender un libro desde su ficha, eligiendo cantidad, descuento y forma de pago
- [ ] El botón "Vender" no aparece si no quedan ejemplares disponibles
- [ ] No se puede vender más ejemplares de los disponibles (rechazo atómico, sin condición de carrera)
- [ ] Verificado en vivo contra `staging`

---

## Backlog restante de `ajustes-finales.md` (no activo todavía, ver detalle completo allá)

- **Tarea E** — Área "Gestionar" (Catalogar rediseñado con panel de ubicación persistente + autocompletado de descuento editorial; Editar reemplaza el cambio de ubicación provisional de la Tarea 1, con eliminar libro para administrador).
- **Tarea F** — Filtrado público por Espacio/Mueble, acumulativo, navegable por URL (listo para QR).
- **Tarea G** — Reporte de Inventario (XLSX).

Después de la Tarea G: retomar el plan de modo offline/cola de sincronización y evaluar la preparación del primer despliegue a producción.
