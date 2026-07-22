# TODO.md — Babel

Motor JIT: este documento mantiene **siempre exactamente 2 tareas atómicas** activas. Al completar cualquiera, se elimina, se mueve el resumen a `MEMORY.md` §2, y se calcula la siguiente tarea más prioritaria comparando `PRD.md` (roadmap) contra `MEMORY.md` (estado actual).

**Prioridad de selección aplicada:** se completó `GestionUsuariosComponent` (CRUD real de usuarios en `/admin/usuarios`, con la salvaguarda visual de ADR-009 — un administrador no puede eliminarse ni degradar su propio rol desde la UI, anticipando el `400` del backend). Su resumen está en `MEMORY.md` §2. `DescuentosEditorialesComponent` (antes Tarea 2, sin cambios de contenido) sube a **Tarea 1** — es el último CRUD de administración pendiente con backend ya listo. Se agrega como **Tarea 2** `GET /api/ventas/exportar` (XLSX) + `ReportesVentasComponent`, prioridad Media (`PRD.md` §5.5/§6): el listado/filtrado de ventas (`GET /api/ventas`) ya existe y está verificado en vivo, así que esta tarea reusa esa misma lógica de filtros para generar el archivo. Ambas tareas son independientes entre sí.

---

## Tarea 1 — [FEATURE]: `DescuentosEditorialesComponent` — CRUD real de descuentos por editorial en `/admin/editoriales`

**Origen:** `PRD.md` §5.6 ("Gestión de descuentos por editorial: definir, por editorial, el porcentaje por defecto y una lista de porcentajes alternativos disponibles"), prioridad Media (`PRD.md` §6). El backend (`CRUD /api/editoriales-descuentos`, administrador exclusivo) ya está implementado y verificado en vivo — falta la pantalla real de administración. Último CRUD de administración pendiente de los que ya tienen backend listo (`GestionEstantesComponent`, `GestionSitiosScrapingComponent` y `GestionUsuariosComponent` ya cubren los demás). Independiente de la Tarea 2.

**Plantillas de referencia (replicar de punta a punta):** backend ya existe, no tocar. Frontend = `sitios-scraping`/`usuarios` (`gestion-*.component` + `*.service`), con la particularidad de que `editorial` es la clave primaria (natural, suministrada por el administrador, no editable tras crear — mismo patrón que `dominio`/`email`, `POST` responde `409` si ya existe).

**Modelo** (`src/app/core/models/descuento-editorial.model.ts`, ya existe): `DescuentoEditorial { editorial: string; porcentajePorDefecto: number; porcentajesDisponibles: number[] }`. El campo `porcentajesDisponibles` es un array de números — el formulario necesita una forma de editar una lista de valores (ej. un input de texto con números separados por coma, parseado a `number[]`, o una lista dinámica de campos — decidir la UI más simple al implementar, no hay un patrón previo exacto en el proyecto para "array editable en un formulario reactivo").

**Archivos:**
- `src/app/core/api/editoriales-descuentos.service.ts` (nuevo, confirmar que no existe ya antes de crearlo): patrón `EstantesService`/`SitiosScrapingService`/`UsuariosService` — `DatosDescuentoEditorial`, `ResultadoOperacionDescuentoEditorial`, signals, `cargar`/`crear`/`actualizar`/`eliminar` autenticados.
- `src/app/features/admin/gestion-descuentos-editoriales.component.{ts,html,spec.ts}` (nuevo): lista + formulario único crear/editar (`editorial` no editable al editar) + eliminar con `confirm`. Recordar que el 100% (libro propio, sin consignación) es siempre una opción implícita al catalogar, independiente de lo que haya aquí — no hace falta modelarlo en este CRUD.
- Ruta `admin/editoriales` en `app.routes.ts` (`RoleGuard('administrador')`) y `app.routes.server.ts` (`RenderMode.Client`); activar la card "Editoriales" en `admin-inicio.component.html`.

**Qué hacer:**
1. Crear el servicio Angular autenticado (verificar primero si no existe ya un `editoriales-descuentos.service.ts` parcial).
2. Implementar `GestionDescuentosEditorialesComponent`: lista + formulario único crear/editar + eliminar, con manejo del array `porcentajesDisponibles`.
3. Registrar rutas y activar la card de admin.
4. Cubrir con `npm test -- --watch=false`: métodos del servicio (éxito/error, incluido `409` en duplicado) y casos principales del componente (lista, crea, edita, elimina, error).

**Definition of done:**
- [ ] `npm run build` y `npm test -- --watch=false` pasan sin errores
- [ ] Tests unitarios cubren el servicio nuevo y los casos principales del componente
- [ ] Verificado en vivo contra `staging` con la cuenta `administrador` real
- [ ] Un `vendedor` no puede acceder a `/admin/editoriales`

---

## Tarea 2 — [FEATURE]: `GET /api/ventas/exportar` (XLSX) + `ReportesVentasComponent`

**Origen:** `PRD.md` §5.5 ("Reportes de ventas (solo administrador)") y §6 (roadmap, prioridad Media). `GET /api/ventas` (listar/filtrar, PR #26) ya existe, está verificado en vivo y expone los filtros `desde`/`hasta`/`editorial`/`formaDePago` — esta tarea reusa exactamente esa misma lógica de filtrado para generar un archivo descargable en vez de JSON. Independiente de la Tarea 1.

**Archivos:**
- `server/api/handlers/ventas.ts` — agregar `handlerExportar` (nueva función exportada del mismo archivo, mismo patrón que `handler`/`handlerListar` ya conviviendo ahí — ADR-008 permite agrupar handlers muy relacionados en el mismo módulo). Reusa la función de filtrado/consulta que ya usa `handlerListar` (revisar el archivo para no duplicar esa lógica) y arma el archivo XLSX con la librería `xlsx` (**no está instalada todavía** — `npm ls xlsx` confirma vacío; instalarla como dependency de producción, ADR previsto en `tech-specs.md` §2).
- `serverless.yml`: nueva función Lambda `exportarVentas` (ADR-008, un handler = una función propia) con rol IAM de solo lectura (mismo alcance que `ListarVentasLambdaRole`: `GetItem`/`Scan` sobre `babel-ventas`, `GetItem` sobre `babel-libros` para resolver editorial por `bookId`, `GetItem` sobre `babel-usuarios` para el rol del token), ruta `GET /api/ventas/exportar`, y el bloque de exclusiones de `node_modules/**` ya establecido (copiarlo literal — revisar que `xlsx` no quede excluido, es runtime real de backend). Verificar tamaño del paquete tras agregar `xlsx` (`npx serverless package --stage staging`, gotcha de `MEMORY.md` §7).
- `src/app/core/api/ventas.service.ts` (revisar si ya existe algo para `GET /api/ventas`; si no, créalo) — método `exportarVentas(filtros)` que descarga el archivo (petición autenticada con `responseType: 'blob'`, y dispara la descarga en el navegador, ej. creando un `<a>` temporal con `URL.createObjectURL`).
- `src/app/features/admin/reportes-ventas.component.{ts,html,spec.ts}` (nuevo): formulario de filtros (`desde`, `hasta`, `editorial`, `formaDePago`, todos opcionales) + botón "Exportar a Excel" que dispara la descarga. No necesita listar las ventas en pantalla (eso ya lo cubre, si hiciera falta, un futuro dashboard — esta tarea es solo la exportación).
- Ruta `admin/reportes` en `app.routes.ts` (`RoleGuard('administrador')`) y `app.routes.server.ts` (`RenderMode.Client`); activar la card "Reportes" en `admin-inicio.component.html`.

**Qué hacer:**
1. Instalar `xlsx`, confirmar árbol de dependencias y que no queda excluida del empaquetado.
2. Implementar `handlerExportar` reusando el filtrado de `handlerListar`, generando el `.xlsx` en memoria (columnas: fecha de venta, libro/ISBN, editorial, PVP, costo, utilidad, forma de pago — revisar el modelo `Venta` en `src/app/core/models/venta.model.ts` para los campos exactos disponibles) y devolviéndolo como respuesta binaria (`isBase64Encoded: true`, `Content-Type` de Excel, `Content-Disposition: attachment`).
3. Agregar la función Lambda, rol IAM y ruta en `serverless.yml`.
4. Implementar el servicio y el componente de frontend.
5. Registrar rutas y activar la card de admin.
6. Cubrir con `npm run test:api` (el handler nuevo, incluidos los filtros) y `npm test -- --watch=false` (el componente/servicio de frontend).

**Definition of done:**
- [ ] `npm run build`, `npm run build:api`, `npm test -- --watch=false`, `npm run test:api` pasan sin errores
- [ ] `npx serverless package --stage staging` produce la función nueva < 250 MB descomprimido
- [ ] Verificado en vivo contra `staging` con la cuenta `administrador` real: exportar sin filtros y con al menos un filtro aplicado, confirmar que el archivo `.xlsx` descargado abre correctamente y tiene los datos esperados
- [ ] Un `vendedor` no puede acceder a `/admin/reportes` ni a `GET /api/ventas/exportar`
