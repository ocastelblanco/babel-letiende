# TODO.md — Babel

Motor JIT: este documento mantiene **siempre exactamente 2 tareas atómicas** activas. Al completar cualquiera, se elimina, se mueve el resumen a `MEMORY.md` §2, y se calcula la siguiente tarea más prioritaria comparando `PRD.md` (roadmap) contra `MEMORY.md` (estado actual).

**Prioridad de selección aplicada (2026-07-23):** el usuario entregó `ajustes-finales.md` con un conjunto extenso de ajustes de producto (ubicación física jerárquica Espacio→Mueble→Ubicación reemplazando "Estante", edición de libros catalogados, venta desde la ficha del libro, área "Gestionar", filtrado público por ubicación con soporte QR, reporte de inventario, y varios fixes de copy/bugs) — **decisión explícita: no se retoma el plan de modo offline ni la preparación del primer despliegue a producción hasta cerrar TODO este conjunto.** `PRD.md` ya se actualizó con el alcance acordado (tras resolver 5 ambigüedades reales con el usuario, ver `ajustes-finales.md` §"Decisiones técnicas confirmadas"). El conjunto se rompió en 7 tareas atómicas ordenadas por dependencia (Tarea A–G, detalle completo en `ajustes-finales.md` §"Backlog ordenado de implementación") — las primeras 2 quedan activas aquí; al cerrar cualquiera, se promueve la siguiente de esa lista.

---

## Tarea 1 — [FIX]: fixes rápidos del catálogo público

**Origen:** `ajustes-finales.md` §"Usuarios no autenticados (clientes)" → "Inicio - Catálogo público" y "Autenticación". Sin dependencias de las demás tareas — quick win, incluye un bug real (no solo una inconsistencia de copy).

**Qué hacer:**
1. **Bug real:** el título de la pestaña del navegador en `/` queda "pegado" al último libro visitado. Causa confirmada: `Title` de Angular es un servicio singleton; `LibroDetalleComponent` (PR #51) lo sobreescribe con el título del libro (`{{ libro.titulo }} — Catálogo Le Tiende`) pero `CatalogoPublicoComponent` nunca lo resetea al montar. Corregir: `CatalogoPublicoComponent` debe llamar `Title.setTitle(...)` en su propio `ngOnInit` con un título fijo del catálogo (ver punto 2 para el texto exacto a usar como base).
2. Definir y aplicar un título de página consistente para `/` (el usuario reportó ver "Inicio - Catálogo público" en un lugar y el título de un libro en la pestaña — unificar en un solo texto real, ej. `Catálogo — Le Tiende`, ajustable).
3. Cambiar el texto que aparece después del logo en `/` de "Catálogo" a **"Catálogo Librería"**.
4. En `/login`, agregar un vínculo visible para volver al catálogo público (`/`) — para cuando un cliente sin cuenta haga clic en "Ingresar" por error.

**Definition of done:**
- [ ] El título de la pestaña del navegador en `/` es siempre el del catálogo, incluso después de haber visitado una ficha de libro y volver
- [ ] El texto tras el logo en `/` dice "Catálogo Librería"
- [ ] `/login` tiene un vínculo funcional de regreso a `/`
- [ ] `npm run build`, `npm test -- --watch=false` pasan sin errores
- [ ] Verificado en vivo contra `staging`

---

## Tarea 2 — [FEATURE]: Espacios, Muebles y Ubicaciones (reemplaza Estantes)

**Origen:** `ajustes-finales.md` §"Generales" y §"Administrador → Administración → Estantes". Pieza fundacional de todo el resto del backlog (Tareas C–G dependen de que esta exista) — el resto de la iniciativa no puede avanzar sin este modelo de datos.

**Qué hacer:**
1. Diseñar y crear 3 tablas DynamoDB nuevas: `babel-espacios` (`espacioId` PK, `nombre`), `babel-muebles` (`muebleId` PK, `espacioId`, `nombre`), `babel-ubicaciones` (`ubicacionId` PK, `muebleId`, `nombre`) — reemplazan `babel-estantes` (que se elimina de `serverless.yml`; los ~4 registros de prueba en `staging` se pierden sin problema, decisión confirmada con el usuario, no hay datos de producción todavía).
2. Backend: CRUD para cada una (mismo patrón ya usado en `estantes.ts`/`editoriales-descuentos.ts`: un handler por entidad, escritura exclusiva `administrador`). **Lectura debe ser pública** (sin autenticación) — a diferencia del `GET /api/estantes` actual (que exige `vendedor`/`administrador`), el catálogo público (Tarea F) necesita leer Espacios/Muebles para armar su filtro. Definir reglas de borrado: se sugiere no permitir borrar un Espacio/Mueble que todavía tenga Muebles/Ubicaciones hijos (mismo criterio conservador que otras validaciones del proyecto, ej. ADR-009).
3. Frontend: reestructurar `/admin/estantes` (misma ruta, contenido nuevo) en 3 pestañas: **Espacios** (campo nombre + botón crear + lista con Editar), **Muebles** (desplegable de Espacio + campo nombre + botón crear + lista), **Ubicaciones** (desplegable de Mueble, dependiente del Espacio elegido, + campo nombre + botón crear + lista). Edición de cada uno permite cambiar su nombre y, para Mueble/Ubicación, reasignar el padre desde un desplegable.
4. Eliminar `EstantesService`, `GestionEstantesComponent`, `estantes.ts` (handler) y el CRUD `/api/estantes` — reemplazados por lo anterior.
5. Cubrir con tests backend y frontend (CRUD de las 3 entidades, incluida la relación jerárquica en los desplegables).

**Definition of done:**
- [ ] `npm run build`, `npm run build:api`, `npm test -- --watch=false`, `npm run test:api` pasan sin errores
- [ ] Un administrador puede crear un Espacio, luego un Mueble dentro de ese Espacio, luego una Ubicación dentro de ese Mueble, desde `/admin/estantes`
- [ ] Renombrar un Espacio o Mueble no rompe la pertenencia de sus hijos ya creados
- [ ] `GET` de las 3 entidades funciona sin autenticación (lectura pública)
- [ ] Verificado en vivo contra `staging`

---

## Backlog restante de `ajustes-finales.md` (no activo todavía, ver detalle completo allá)

Se promueven a Tarea 1/2 en este orden, una vez se cierren las actuales — **no se retoma el plan de modo offline ni producción hasta agotar esta lista**:

- **Tarea C** — Migrar `Libro.estanteId` → `Libro.ubicacionId`; ficha de libro muestra Espacio/Mueble/Ubicación como campos independientes (no concatenados). Depende de Tarea 2.
- **Tarea D** — Vender desde la ficha: `POST /api/ventas` acepta `cantidad`; botón "Vender" + diálogo (cantidad, descuento, forma de pago). Depende de Tarea C.
- **Tarea E** — Área "Gestionar" (Catalogar rediseñado con panel de ubicación persistente + autocompletado de descuento editorial; Editar reemplaza Cambiar estante, con eliminar libro para administrador). Depende de Tarea 2 y Tarea C.
- **Tarea F** — Filtrado público por Espacio/Mueble, acumulativo, navegable por URL (listo para QR). Depende de Tarea 2.
- **Tarea G** — Reporte de Inventario (XLSX). Depende de Tarea 2 y Tarea C.

Después de la Tarea G: retomar el plan de modo offline/cola de sincronización (ya investigado, ver historial de `MEMORY.md`) y evaluar la preparación del primer despliegue a producción.
