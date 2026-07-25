# TODO.md — Babel

Motor JIT: este documento mantiene **siempre exactamente 2 tareas atómicas** activas. Al completar cualquiera, se elimina, se mueve el resumen a `MEMORY.md` §2, y se calcula la siguiente tarea más prioritaria comparando `PRD.md` (roadmap) contra `MEMORY.md` (estado actual).

**Prioridad de selección aplicada (2026-07-24, revalidada tras sincronizar con `origin/main`):** la Tarea E (área "Gestionar") se completó y fusionó como PR #60 — `GestionarComponent` (`/gestionar`, 2 pestañas), `PUT`/`DELETE`/`GET /api/libros/inventario` nuevos en el backend, `ListaLibrosCatalogadosComponent`/`CambiarUbicacionComponent`/`/libros`/`AuthGuard` eliminados (ver `ajustes-finales.md`, Tarea E marcada `[x]`, y `MEMORY.md` §2/§9 para el detalle completo). Sube a **Tarea 1** la Tarea F (filtrado público por ubicación) — ya estaba en el TODO como Tarea 2, sin cambios de contenido, y sus dependencias (Tarea B) ya están fusionadas. Se agrega como **Tarea 2** la Tarea G (Reporte de Inventario XLSX) del backlog ordenado de `ajustes-finales.md` — depende de B y C, ambas ya fusionadas, sin bloqueo. Ambas tareas son independientes entre sí: una toca únicamente `CatalogoPublicoComponent` (frontend), la otra agrega un endpoint nuevo (`server/api/handlers/libros.ts` o uno dedicado) y extiende `ReportesVentasComponent`/`/admin/reportes`.

---

## Tarea 1 — [FEATURE]: filtrado público por ubicación (Espacio/Mueble)

**Origen:** `ajustes-finales.md` Tarea F. Depende solo de la Tarea B (ya fusionada, PR #54) — independiente de la Tarea 2 de abajo (Reporte de Inventario), así que no hay que esperarla.

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

## Tarea 2 — [FEATURE]: Reporte de Inventario (XLSX)

**Origen:** `ajustes-finales.md` Tarea G (última del backlog ordenado antes de retomar modo offline/producción). Depende de la Tarea B (Espacios/Muebles/Ubicaciones, PR #54) y la Tarea C (`Libro.ubicacionId`, PR #56) — ambas ya fusionadas, sin bloqueo.

**Qué ya existe y se puede reutilizar (confirmado en el código):**
- `GET /api/ventas/exportar` (`server/api/handlers/ventas.ts`, función `handlerExportar`) ya genera un `.xlsx` en memoria con la librería `xlsx` (`XLSX.utils.json_to_sheet` + `XLSX.write(..., { type: 'base64', bookType: 'xlsx' })`) y lo devuelve como `Content-Disposition: attachment` — mismo patrón exacto a replicar para el reporte de inventario, solo cambia la fuente de datos y las columnas.
- `ReportesVentasComponent` (`/admin/reportes`, `RoleGuard('administrador')`) ya existe como pantalla — esta tarea le agrega una segunda sección/botón para el reporte de inventario, no una ruta nueva.
- `escanearTodo<Libro>` (`server/api/services/dynamodb.ts`) y `resolverUbicacion` (`server/api/handlers/libros.ts`, ya usado por `handlerDetalle`) resuelven exactamente lo necesario: todos los libros + su Espacio/Mueble/Ubicación por nombre.

**Qué hacer (orden sugerido):**
1. Backend: nuevo handler `GET /api/libros/exportar` (mismo archivo `libros.ts` o uno dedicado, evaluar durante la implementación cuál mantiene el patrón ADR-008 más limpio) — exige `administrador` exclusivamente (mismo criterio que `GET /api/ventas/exportar`, es información de negocio sensible). Escanea todos los libros (`escanearTodo`), resuelve Espacio/Mueble/Ubicación por libro (reutilizar `resolverUbicacion`, cuidando el costo de un `GetItem` triple por fila — evaluar cachear Espacios/Muebles/Ubicaciones en memoria durante la misma invocación en vez de repetir la cadena completa por cada libro, ya que a este volumen de miles de libros son pocas decenas de ubicaciones distintas). Columnas: ISBN, Título, Autor, Editorial, PVP, Descuento editorial (%), Cantidad, Espacio, Mueble, Ubicación.
2. Nueva función Lambda dedicada en `serverless.yml` (ADR-008) con rol IAM de solo lectura sobre `babel-libros`/`babel-ubicaciones`/`babel-muebles`/`babel-espacios`/`babel-usuarios`.
3. Frontend: extender `ReportesVentasComponent` (o extraer un `ExportarInventarioComponent` si mezclar ambos reportes en el mismo componente lo hace confuso — decidir durante la implementación) con un botón "Exportar inventario" que dispara la descarga, mismo patrón de `exportar()`/manejo de Blob que ya usa el reporte de ventas.
4. Cubrir con tests backend (200 con datos/administrador, 403 con vendedor, formato de columnas) y frontend (botón dispara la descarga, error se muestra).

**Definition of done:**
- [ ] `npm run build`, `npm run build:api`, `npm test -- --watch=false`, `npm run test:api` pasan sin errores
- [ ] Solo un `administrador` puede exportar el reporte de inventario (`403` para `vendedor`/sin sesión)
- [ ] El `.xlsx` generado incluye las 10 columnas especificadas, con Espacio/Mueble/Ubicación resueltos por nombre (no IDs)
- [ ] Verificado en vivo contra `staging`

---

Después de la Tarea 2: retomar el plan de modo offline/cola de sincronización y evaluar la preparación del primer despliegue a producción (`ajustes-finales.md`).
