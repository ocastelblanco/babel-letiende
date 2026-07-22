# TODO.md — Babel

Motor JIT: este documento mantiene **siempre exactamente 2 tareas atómicas** activas. Al completar cualquiera, se elimina, se mueve el resumen a `MEMORY.md` §2, y se calcula la siguiente tarea más prioritaria comparando `PRD.md` (roadmap) contra `MEMORY.md` (estado actual).

**Prioridad de selección aplicada:** se completó la Task C (`GET /api/metadatos/:isbn` ahora combina `api.letiende.co` con el fallback de scraping en paralelo, respetando `prioridad` como desempate, e incluye `pvp`) — con esto, la iniciativa **"obtención automatizada de info de libros"** (`plan-obtencion-info-libros.md`) queda completa en su alcance acordado (Task A + B + C, hasta scraping por ISBN; la búsqueda por título/autor sigue diferida). Su resumen está en `MEMORY.md` §2. `GestionUsuariosComponent` (antes Tarea 2, sin cambios de contenido) sube a **Tarea 1**. Se agrega como **Tarea 2** `DescuentosEditorialesComponent` — CRUD real de descuentos por editorial en `/admin/editoriales`, prioridad Media (`PRD.md` §6): el backend (`CRUD /api/editoriales-descuentos`) ya existe y está verificado en vivo, sin frontend todavía — mismo patrón que `GestionEstantesComponent`/`GestionSitiosScrapingComponent`, y el último CRUD de administración pendiente de los que ya tienen backend listo. Ambas tareas son independientes entre sí.

---

## Tarea 1 — [FEATURE]: `GestionUsuariosComponent` — CRUD real de usuarios en `/admin/usuarios`

**Origen:** `PRD.md` §5.6 ("Gestión de usuarios: crear, editar, borrar vendedores y administradores"), prioridad Media (`PRD.md` §6). El backend (`CRUD /api/usuarios`, administrador exclusivo, con las salvaguardas de ADR-009 — un administrador no puede cambiar su propio rol ni eliminarse a sí mismo vía este endpoint) ya está implementado y verificado en vivo desde hace varias tareas — falta la pantalla real de administración que lo consume. Independiente de la Tarea 2 (descuentos editoriales): esta tarea es puramente CRUD de datos.

**Plantillas de referencia (replicar de punta a punta):** backend ya existe, no tocar. Frontend = `estantes`/`sitios-scraping` (`gestion-*.component` + `*.service`), con la particularidad de que `email` es la clave primaria (no editable tras crear, igual que `dominio` en sitios-scraping) y que hay que reflejar en la UI las dos salvaguardas de ADR-009 (deshabilitar o advertir cuando el administrador autenticado intente editar su propio rol o eliminarse a sí mismo, para no depender solo del `400` del backend).

**Archivos:**
- `src/app/core/api/usuarios.service.ts` — **ya existe** (`obtenerUsuarioActual`, Signal de solo lectura, usado por `RoleGuard`); extenderlo con métodos autenticados `listarUsuarios`/`crearUsuario`/`actualizarUsuario`/`eliminarUsuario`, mismo patrón que `EstantesService`/`SitiosScrapingService`.
- `src/app/features/admin/gestion-usuarios.component.{ts,html,spec.ts}` (nuevo): lista de usuarios (email, nombre, rol), formulario único crear/editar (`email` no editable al editar), selector de rol (`vendedor`/`administrador`), eliminar con `confirm`.
- Ruta `admin/usuarios` en `app.routes.ts` (`RoleGuard('administrador')`) y `app.routes.server.ts` (`RenderMode.Client`); activar la card "Usuarios" en `admin-inicio.component.html`.

**Qué hacer:**
1. Extender `UsuariosService` con los 4 métodos de escritura/lectura autenticados (reusa el patrón `ResultadoOperacion*` que nunca lanza).
2. Implementar `GestionUsuariosComponent`: lista + formulario único crear/editar + eliminar. Al editar/eliminar la propia fila del administrador autenticado (comparar contra `authService.usuario()?.email`), mostrar una advertencia o deshabilitar el cambio de rol/el botón eliminar en esa fila específica — anticipa el `400` de ADR-009 en vez de dejar que el usuario lo descubra por un error del backend.
3. Registrar rutas y activar la card de admin.
4. Cubrir con `npm test -- --watch=false`: los métodos nuevos del servicio (éxito/error) y los casos principales del componente (lista, crea, edita, elimina, error, salvaguarda visual sobre la propia fila).

**Definition of done:**
- [ ] `npm run build` y `npm test -- --watch=false` pasan sin errores
- [ ] Tests unitarios cubren los métodos nuevos del servicio y los casos principales del componente, incluida la salvaguarda visual sobre la propia fila del administrador
- [ ] Verificado en vivo contra `staging` con la cuenta `administrador` real: alta/edición/baja de un usuario; confirmar que intentar cambiar el propio rol o eliminarse a sí mismo se bloquea (visual y/o por el `400` del backend)
- [ ] Un `vendedor` no puede acceder a `/admin/usuarios`

---

## Tarea 2 — [FEATURE]: `DescuentosEditorialesComponent` — CRUD real de descuentos por editorial en `/admin/editoriales`

**Origen:** `PRD.md` §5.6 ("Gestión de descuentos por editorial: definir, por editorial, el porcentaje por defecto y una lista de porcentajes alternativos disponibles"), prioridad Media (`PRD.md` §6). El backend (`CRUD /api/editoriales-descuentos`, administrador exclusivo) ya está implementado y verificado en vivo — falta la pantalla real de administración. Último CRUD de administración pendiente de los que ya tienen backend listo (`GestionEstantesComponent`, `GestionSitiosScrapingComponent` y `GestionUsuariosComponent` — Tarea 1 de este mismo documento — ya cubren los demás). Independiente de la Tarea 1.

**Plantillas de referencia (replicar de punta a punta):** backend ya existe, no tocar. Frontend = `editoriales-descuentos` no tiene servicio Angular todavía (revisar si `src/app/core/api/` ya tiene algo, si no, crear `editoriales-descuentos.service.ts`); patrón = `EstantesService`/`SitiosScrapingService`, con la particularidad de que `editorial` es la clave primaria (natural, suministrada por el administrador, no editable tras crear — mismo patrón que `dominio` en sitios-scraping, `POST` responde `409` si ya existe).

**Modelo** (`src/app/core/models/descuento-editorial.model.ts`, ya existe): `DescuentoEditorial { editorial: string; porcentajePorDefecto: number; porcentajesDisponibles: number[] }`. El campo `porcentajesDisponibles` es un array de números — el formulario necesita una forma de editar una lista de valores (ej. un input de texto con números separados por coma, parseado a `number[]`, o una lista dinámica de campos — decidir la UI más simple al implementar, no hay un patrón previo exacto en el proyecto para "array editable en un formulario reactivo").

**Archivos:**
- `src/app/core/api/editoriales-descuentos.service.ts` (nuevo, confirmar que no existe ya antes de crearlo): patrón `EstantesService`/`SitiosScrapingService` — `DatosDescuentoEditorial`, `ResultadoOperacionDescuentoEditorial`, signals, `cargar`/`crear`/`actualizar`/`eliminar` autenticados.
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
