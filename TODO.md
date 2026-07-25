# TODO.md — Babel

Motor JIT: este documento mantiene **siempre exactamente 2 tareas atómicas** activas. Al completar cualquiera, se elimina, se mueve el resumen a `MEMORY.md` §2, y se calcula la siguiente tarea más prioritaria comparando `PRD.md` (roadmap) contra `MEMORY.md` (estado actual).

**Prioridad de selección aplicada (2026-07-25):** la Tarea F (filtrado público por ubicación) se completó (PR #62) — 2 `<select>` (Espacio/Mueble) acumulativos con la búsqueda de texto, query params `?espacio=&mueble=` en ambas direcciones, y un bug real de Angular corregido de paso (`[value]` en un `<select>` nativo sin Reactive Forms no selecciona la opción si las `<option>` del `@for` aún no existían en el DOM — reemplazado por `[selected]` por opción). 8 tests unitarios nuevos. Verificado en vivo por el usuario en `staging` tras resolver un conflicto real de fusión con el PR #61 (ambos tocaban `Hitos desarrollo - detail.csv`), resuelto con un merge normal (no rebase) conservando ambas filas. Sube a **Tarea 1** la Tarea G (Reporte de Inventario XLSX) — ya estaba en el TODO como Tarea 2, sin cambios de contenido. **No se agrega una Tarea 2 nueva:** revisando `PRD.md` §6 (roadmap) y `ajustes-finales.md` §"Backlog ordenado de implementación" completos, la Tarea G es el único ítem Alta/Media pendiente en todo el proyecto — no hay ningún gap de seguridad abierto en `MEMORY.md` §7 (los únicos `⚠️` sin "RESUELTO" son una lección de proceso ya aplicada y un incidente ya remediado, ninguno requiere código nuevo) ni otro ítem de roadmap independiente de la Tarea G. Lo único que sigue tras la Tarea G (modo offline/cola de sincronización, primer despliegue a producción) está **explícitamente bloqueado hasta cerrarla** (decisión del usuario, `ajustes-finales.md`) — no puede correr en paralelo, así que no califica como "independiente" para ocupar el segundo slot. El motor JIT queda deliberadamente con 1 sola tarea activa hasta que la Tarea G cierre y desbloquee el siguiente bloque de trabajo.

---

## Tarea 1 — [FEATURE]: Reporte de Inventario (XLSX)

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

Después de la Tarea 1: retomar el plan de modo offline/cola de sincronización y evaluar la preparación del primer despliegue a producción (`ajustes-finales.md`) — ahí se recalculará también la siguiente Tarea 2.
