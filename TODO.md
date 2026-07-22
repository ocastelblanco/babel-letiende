# TODO.md — Babel

Motor JIT: este documento mantiene **siempre exactamente 2 tareas atómicas** activas. Al completar cualquiera, se elimina, se mueve el resumen a `MEMORY.md` §2, y se calcula la siguiente tarea más prioritaria comparando `PRD.md` (roadmap) contra `MEMORY.md` (estado actual).

**Prioridad de selección aplicada:** se completó `DescuentosEditorialesComponent` (CRUD real de descuentos por editorial en `/admin/editoriales`) — con esto, los 4 CRUD de administración con backend ya listo quedan todos implementados (`GestionEstantesComponent`, `GestionSitiosScrapingComponent`, `GestionUsuariosComponent`, `DescuentosEditorialesComponent`). Su resumen está en `MEMORY.md` §2. `GET /api/ventas/exportar` (XLSX) + `ReportesVentasComponent` (antes Tarea 2, sin cambios de contenido) sube a **Tarea 1**. Se agrega como **Tarea 2** `DESIGN.md` propio de Babel — sugerido explícitamente en `CLAUDE.md` §4 ("adaptando estos tokens a los patrones específicos del catálogo de libros"), y ahora hay suficiente superficie construida (8+ componentes de administración, catálogo público, catalogación, login) como para documentar patrones reales en vez de solo tokens de marca heredados de Comandante. Ambas tareas son independientes entre sí (una es backend+frontend de reportes, la otra es solo documentación).

---

## Tarea 1 — [FEATURE]: `GET /api/ventas/exportar` (XLSX) + `ReportesVentasComponent`

**Origen:** `PRD.md` §5.5 ("Reportes de ventas (solo administrador)") y §6 (roadmap, prioridad Media). `GET /api/ventas` (listar/filtrar, PR #26) ya existe, está verificado en vivo y expone los filtros `desde`/`hasta`/`editorial`/`formaDePago` — esta tarea reusa exactamente esa misma lógica de filtrado para generar un archivo descargable en vez de JSON. Independiente de la Tarea 2.

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

---

## Tarea 2 — [DOCS]: `DESIGN.md` propio de Babel

**Origen:** `CLAUDE.md` §4 ("Se recomienda crear un `DESIGN.md` propio de Babel adaptando estos tokens a los patrones específicos del catálogo de libros"). La identidad visual hereda la paleta/tipografía de Comandante (`primary #230C00`, `secondary #E8630A`, `tertiary #00B7A3`, `neutral #FFE7B3`, Poppins — Angellya solo para el logo, decisión ya registrada en `MEMORY.md` §7), pero nunca se documentó cómo esos tokens se traducen en los patrones reales ya construidos (formularios de administración, tarjetas, estados de carga/error, etc.). Con 4 pantallas CRUD de administración + catálogo público + catalogación + login ya implementadas, hay suficiente superficie real para documentar patrones concretos en vez de solo tokens heredados. Tarea solo de documentación, sin cambios de código. Independiente de la Tarea 1.

**Qué hacer:**
1. Releer los componentes ya construidos (`gestion-estantes`, `gestion-sitios-scraping`, `gestion-usuarios`, `gestion-descuentos-editoriales`, `catalogar-libro`, `catalogo-publico`, `login`, `admin-inicio`, `cambiar-estante`) y extraer los patrones Tailwind que se repiten literalmente en todos (clases exactas, no reinventarlas): tarjetas (`rounded-2xl bg-white p-4/p-6 shadow-[0_4px_16px_rgba(35,12,0,0.08)]`), botones primarios/secundarios/de peligro, inputs de formulario reactivo, mensajes de éxito/error, estados vacío/carga, el patrón "formulario único crear/editar oculto por defecto" ya establecido en los últimos 3 componentes.
2. Documentar los tokens de marca ya confirmados (`CLAUDE.md` §4, `MEMORY.md` §7): paleta exacta, Poppins como única tipografía de interfaz (Angellya exclusiva del logo, con el razonamiento ya registrado), formato de precios colombiano (`$45.000`).
3. Escribir `DESIGN.md` en la raíz del repo (mismo nivel que `CLAUDE.md`/`PRD.md`/`tech-specs.md`) con estas secciones como mínimo: identidad de marca (colores/tipografía), componentes reutilizables documentados con su clase Tailwind exacta y un ejemplo de uso real (archivo:línea de un componente existente), el patrón de formulario único crear/editar, y cualquier convención de espaciado/tamaño que se repita (ej. `max-w-2xl`, `px-4 py-8`).
4. No inventar patrones nuevos ni proponer cambios de diseño — este documento describe lo que YA existe en el código, para que futuras tareas lo repliquen consistentemente en vez de reinventar estilos ligeramente distintos cada vez (ej. el pequeño desvío de tamaño de tarjeta que ya existe entre algunos componentes, si lo hay, documentarlo como está, no "corregirlo" silenciosamente).

**Definition of done:**
- [ ] `DESIGN.md` existe en la raíz del repo, con secciones de marca + componentes reutilizables + patrones de formulario, cada patrón citando al menos un archivo:línea real como ejemplo
- [ ] No se modificó ningún archivo de código (`.ts`/`.html`) — solo el nuevo `.md`
- [ ] Revisar y actualizar la referencia cruzada en `CLAUDE.md` §4 si hace falta (ej. quitar el "se recomienda crear" ahora que existe)
