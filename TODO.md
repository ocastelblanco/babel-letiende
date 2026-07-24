# TODO.md — Babel

Motor JIT: este documento mantiene **siempre exactamente 2 tareas atómicas** activas. Al completar cualquiera, se elimina, se mueve el resumen a `MEMORY.md` §2, y se calcula la siguiente tarea más prioritaria comparando `PRD.md` (roadmap) contra `MEMORY.md` (estado actual).

**Prioridad de selección aplicada (2026-07-24):** se completaron la Tarea C (PR #56, migrar `Libro.estanteId`→`ubicacionId`) y la Tarea D (PR #57, vender desde la ficha) del backlog de `ajustes-finales.md`. Sigue vigente la decisión del usuario: **no se retoma el plan de modo offline ni el despliegue a producción hasta cerrar todo el conjunto de `ajustes-finales.md`.** Se promueven las siguientes 2 tareas del backlog ordenado (`ajustes-finales.md` §"Backlog ordenado de implementación"): Tarea E (área "Gestionar") sube a **Tarea 1** — sus dependencias (B y C) ya están fusionadas, sin bloqueo; Tarea F (filtrado público por ubicación) sube a **Tarea 2** — depende solo de B (ya fusionada), así que puede avanzar en paralelo con la Tarea 1 sin conflicto real de archivos (una toca `/gestionar` y `CatalogarLibroComponent`, la otra `CatalogoPublicoComponent`).

---

## Tarea 1 — [FEATURE]: área "Gestionar" (Catalogar rediseñado + Editar/Eliminar libro)

**Origen:** `ajustes-finales.md` Tarea E. Reemplaza `/libros` (`ListaLibrosCatalogadosComponent`) y `/catalogar` como destinos separados por una única ruta `/gestionar` con 2 pestañas. También reemplaza de verdad el placeholder mínimo de la Tarea C (`CambiarUbicacionComponent`, ruta `/libros/:bookId/ubicacion`), que solo permitía cambiar la ubicación — esta tarea permite editar el libro completo.

**Qué ya existe y se puede reutilizar (confirmado en el código, no adivinado):**
- `UbicacionFisicaService` (`src/app/core/api/ubicacion-fisica.service.ts`) ya expone `cargarEspacios()`/`cargarMuebles()`/`cargarUbicaciones()` + signals `espacios`/`muebles`/`ubicaciones` (endpoints públicos, sin token) — sirve directamente para la cascada Espacio→Mueble→Ubicación del panel "Ubicación del libro", sin crear ningún endpoint nuevo.
- `EditorialesDescuentosService.descuentos` ya expone `{ editorial, porcentajePorDefecto, porcentajesDisponibles }[]` — sirve para autocompletar `porcentajeDescuentoEditorial` al catalogar por coincidencia de nombre de editorial (comparación insensible a mayúsculas/tildes, mismo criterio `normalize('NFD')` ya usado en la búsqueda del catálogo público, `catalogo-publico.component.ts`).
- `CatalogarLibroComponent` ya tiene resuelto todo el flujo de búsqueda/escaneo (ISBN por cámara, autocompletado por ISBN vía `api.letiende.co`, búsqueda por título/autor con selección de candidato) — nada de eso se toca; esta tarea solo agrega el panel de ubicación ANTES del formulario y reemplaza su `<select>` plano de Ubicación (Tarea C) por la cascada persistente.
- No existe todavía `PUT`/`DELETE /api/libros/:bookId` en el backend (`server/api/handlers/libros.ts` solo tiene `handler`, `handlerDetalle`, `handlerCrear`, `handlerCambiarUbicacion`) — hay que crearlos.

**Qué hacer (orden sugerido):**
1. Backend: `PUT /api/libros/:bookId` (nuevo handler en `libros.ts`) — edita `ubicacionId`, `cantidadTotal` (incluido bajar a 0), `pvp`, `porcentajeDescuentoEditorial`; recalcula `costo`/`utilidadCatalogo` igual que `handlerCrear` si cambia el descuento editorial; valida `ubicacionId` contra `babel-ubicaciones` (mismo criterio que `handlerCrear`). Exige `vendedor`/`administrador` (`CLAUDE.md` A01). Reemplaza a `handlerCambiarUbicacion` (que queda obsoleto: este endpoint ya cubre ese caso y más) — eliminar `handlerCambiarUbicacion`, la ruta `PATCH /api/libros/:bookId/ubicacion` y su rol IAM de `serverless.yml`.
2. Backend: `DELETE /api/libros/:bookId` (nuevo handler) — exige **exclusivamente `administrador`** (a diferencia de `PUT`, mismo criterio de la nota del documento). Sin salvaguarda especial de negocio más allá de que el `bookId` exista (`404` si no) — a diferencia de ADR-009 (usuarios), no hay "auto-eliminación" que proteger aquí.
3. Frontend: nueva ruta `/gestionar` (`RoleGuard(['vendedor','administrador'])`, `RenderMode.Client` como el resto de rutas autenticadas) con 2 pestañas:
   - **Catalogar:** panel "Ubicación del libro" (cascada Espacio→Mueble→Ubicación con `UbicacionFisicaService`) ANTES del formulario de `CatalogarLibroComponent`; a diferencia de hoy, **no se limpia al guardar** — solo se limpia el formulario de datos del libro (título/autor/ISBN/PVP/etc.), permitiendo catalogar varios libros seguidos de la misma ubicación sin repetir la selección. Autocompletar `porcentajeDescuentoEditorial` cuando el campo `editorial` coincida con una fila de `EditorialesDescuentosService.descuentos` (sin pisar si el vendedor ya lo modificó manualmente — mismo criterio "nunca pisa lo ya escrito" que el resto del formulario).
   - **Editar:** lista de libros catalogados con filtro por título/autor/ISBN (reutilizar el lector de código de barras ya construido en `CatalogarLibroComponent` para el filtro por ISBN) — fuente de datos: `LibrosService` (mismo `Signal` del catálogo público, ya carga todo) o un nuevo listado si hace falta incluir libros con `cantidadDisponible = 0` (el catálogo público los excluye — confirmar cuál lista debe usarse aquí, probablemente todos, ya que es la pantalla de administración del inventario, no del catálogo). Cada fila con botón "Editar" → formulario con Espacio/Mueble/Ubicación (misma cascada)/cantidad/PVP/descuento editorial. Botón "ELIMINAR LIBRO" visible **solo para `administrador`** (mismo patrón de guard visual que `GestionUsuariosComponent`/ADR-009), con `confirm()` antes de llamar `DELETE`.
4. Header (`App`): cambiar el texto del vínculo de "Mi cuenta" a "Gestionar" y su destino de `/libros` a `/gestionar` (`src/app/app.html`, línea del `<a routerLink="/libros">`).
5. Eliminar `ListaLibrosCatalogadosComponent`, la ruta `/libros`, `CambiarUbicacionComponent` y la ruta `/libros/:bookId/ubicacion` — todo reemplazado por lo anterior.
6. Cubrir con tests backend (`PUT`: válido/`ubicacionId` inválido/rol insuficiente; `DELETE`: válido/`404`/rol distinto de administrador) y frontend (cascada de ubicación persistente entre catalogaciones, autocompletado de descuento editorial, filtro de la pestaña Editar, guard visual de "ELIMINAR LIBRO").

**Definition of done:**
- [ ] `npm run build`, `npm run build:api`, `npm test -- --watch=false`, `npm run test:api` pasan sin errores
- [ ] El panel de ubicación persiste entre catalogaciones seguidas sin tener que volver a seleccionarlo
- [ ] El campo de descuento editorial se autocompleta al coincidir el nombre de la editorial ya configurada
- [ ] Un vendedor/administrador puede editar Espacio/Mueble/Ubicación/cantidad/PVP/descuento de un libro ya catalogado desde `/gestionar`
- [ ] Solo un administrador ve y puede usar "ELIMINAR LIBRO"
- [ ] El vínculo del header dice "Gestionar" y apunta a `/gestionar`; `/libros` y `/libros/:bookId/ubicacion` ya no existen
- [ ] Verificado en vivo contra `staging`

---

## Tarea 2 — [FEATURE]: filtrado público por ubicación (Espacio/Mueble)

**Origen:** `ajustes-finales.md` Tarea F. Depende solo de la Tarea B (ya fusionada, PR #54) — no depende de la Tarea 1 de arriba, así que no hay que esperarla.

**Qué ya existe y se puede reutilizar:**
- `GET /api/espacios`/`GET /api/muebles` ya son públicos (sin token) — sirven directamente para poblar los 2 selects de filtro sin crear ningún endpoint nuevo.
- `CatalogoPublicoComponent` ya resuelve el filtro de texto (título/autor/ISBN) en el **cliente**, sobre el `libros()` signal completo de `LibrosService` (decisión ya documentada en el propio componente) — el filtro por Espacio/Mueble debe seguir el mismo criterio (acumulativo con el texto, todo en el cliente, sin tocar `GET /api/libros`), ya que el catálogo completo ya viaja al cliente hoy sin paginación.
- `Libro` (tras la Tarea C) ya trae `ubicacionId` — para filtrar por Mueble/Espacio hace falta resolver `ubicacionId → muebleId → espacioId` en el cliente usando los listados de `UbicacionFisicaService` (`ubicaciones`/`muebles`, ya expuestos), no una llamada nueva por libro.

**Qué hacer (orden sugerido):**
1. Frontend: `CatalogoPublicoComponent` agrega 2 `<select>` (Espacio, Mueble — dependiente del Espacio elegido, mismo patrón de cascada que `UbicacionFisicaService` ya usa en `/admin/ubicaciones`), poblados con `GET /api/espacios`/`GET /api/muebles`. El filtro es acumulativo con la búsqueda de texto ya existente (todos los criterios activos deben cumplirse a la vez).
2. Soportar query params `?espacio=<espacioId>&mueble=<muebleId>` para pre-filtrar al entrar a `/` (habilita el caso de uso QR — confirmado en `ajustes-finales.md`: solo la URL filtrable, no la generación de la imagen del código). Sincronizar los selects con la URL en ambas direcciones (cambiar el select actualiza la URL; entrar con query params preselecciona los selects).
3. Cubrir con tests frontend (filtro acumulativo texto+espacio+mueble, cascada Mueble depende de Espacio, pre-filtrado vía query params).

**Definition of done:**
- [ ] `npm run build`, `npm test -- --watch=false` pasan sin errores
- [ ] Un visitante sin autenticar puede filtrar el catálogo por Espacio y por Mueble (acumulativo entre sí y con la búsqueda de texto)
- [ ] Entrar a `/?espacio=X&mueble=Y` pre-filtra el catálogo con esos valores
- [ ] Verificado en vivo contra `staging`

---

## Backlog restante de `ajustes-finales.md` (no activo todavía, ver detalle completo allá)

- **Tarea G** — Reporte de Inventario (XLSX): ISBN/Título/Autor/Editorial/PVP/Descuento editorial/Cantidad/Espacio/Mueble/Ubicación, junto al reporte de Ventas ya existente en `/admin/reportes`. Depende de B y C (ambas ya fusionadas) — sin bloqueo cuando se promueva.

Después de la Tarea G: retomar el plan de modo offline/cola de sincronización y evaluar la preparación del primer despliegue a producción.
