# TODO.md — Babel

Motor JIT: este documento mantiene **siempre exactamente 2 tareas atómicas** activas. Al completar cualquiera, se elimina, se mueve el resumen a `MEMORY.md` §2, y se calcula la siguiente tarea más prioritaria comparando `PRD.md` (roadmap) contra `MEMORY.md` (estado actual).

**Prioridad de selección aplicada:** se completó y fusionó el motor de scraping + guardia SSRF (PR #39, `server/api/services/scraping.ts`, ADR-011) — el usuario reordenó las prioridades de los 4 sitios semilla desde `/admin/sitios` y confirmó que el panel funciona bien en `staging`. Su resumen está en `MEMORY.md` §2. Al probarlo, el usuario detectó una mejora de UX pendiente en el propio panel de administración de sitios (`GestionSitiosScrapingComponent`) — sube a **Tarea 1** por pedido explícito del usuario: reemplaza el campo `Prioridad` manual por reordenamiento arrastrable ("drag and drop"), evitando colisiones de prioridad y agilizando el ajuste que el usuario ya tuvo que hacer manualmente hoy. `GestionUsuariosComponent` (Tarea 2, sin cambios de contenido) sigue en cola. Ambas tareas son independientes entre sí.

**⚠️ Nota para quien retome esta tarea:** el usuario pidió explícitamente dejar SOLO la documentación lista — la implementación de la Tarea 1 **no debe iniciarse todavía** (se quedó sin créditos en la sesión donde se pidió). Confirmar con el usuario antes de empezar a escribir código, no asumir luz verde solo porque `TODO.md` la lista primero.

---

## Tarea 1 — [FEATURE]: reordenamiento arrastrable en el panel de sitios de scraping (`/admin/sitios`)

**Origen:** pedido explícito del usuario tras probar en vivo el reordenamiento manual de prioridades en `staging` (2026-07-22). Reemplaza la edición manual del campo `Prioridad` (un número que el administrador debía escribir a mano por cada sitio, con riesgo real de que dos sitios quedaran con la misma prioridad) por arrastrar y soltar las filas de la lista — el orden visual pasa a ser la fuente de verdad de `prioridad`.

**Estado actual verificado (sin este cambio):**
- El listado de `GestionSitiosScrapingComponent` (`src/app/features/admin/gestion-sitios-scraping.component.html`) **no está ordenado por `prioridad`** — `SitiosScrapingService.cargarSitios()` (`src/app/core/api/sitios-scraping.service.ts`) asigna directamente lo que devuelve `GET /api/sitios-scraping` (un `Scan` de DynamoDB sin orden garantizado, `escanearTodo` en `server/api/services/dynamodb.ts`). Hay que agregar el ordenamiento por `prioridad` ascendente en el frontend (ej. un `computed()` sobre `sitiosScrapingService.sitios()`), no asumir que ya existe.
- El formulario (`Nuevo sitio de scraping` / `Editar sitio de scraping`) es siempre visible en la página, ANTES del panel "Sitios registrados", y tiene un campo numérico `Prioridad` (`formulario` reactivo en `gestion-sitios-scraping.component.ts`, control `prioridad`).

**Qué cambiar (5 puntos, todos pedidos explícitamente por el usuario):**
1. El panel **Sitios registrados** ordena la lista por `prioridad` ascendente (ordenamiento real, no solo visual del array ya ordenado por el backend — ver "Estado actual" arriba).
2. Las filas de la lista se vuelven arrastrables ("drag and drop") para reordenar en caliente, sin pasar por "Editar". Al soltar, se recalculan las `prioridad` de todos los sitios cuyo orden cambió (ej. renumerar secuencial 1..N según la posición final) y se persisten con el método `actualizarSitio(dominio, datos)` ya existente en `SitiosScrapingService` — una llamada por sitio afectado (evaluar si conviene agregar un método nuevo tipo `guardarOrden(sitios)` que encapsule el loop, o dejarlo inline en el componente; no hay necesidad de un endpoint de "reordenar en lote" en el backend, el `PUT` individual ya existente alcanza).
3. El campo `Prioridad` **desaparece** de los formularios "Nuevo sitio de scraping" y "Editar sitio de scraping" — el administrador ya no lo edita a mano.
   - **Diseño sugerido (evita tocar el backend):** el campo `prioridad` sigue existiendo en el modelo/API (`DatosSitioScraping`, `validarDatosSitioScraping` en `server/api/handlers/sitios-scraping.ts` — **no quitarlo de ahí**, el backend sigue exigiéndolo). El frontend simplemente deja de exponer un control visible para él: al **crear** un sitio nuevo, calcular automáticamente `prioridad = max(prioridades existentes) + 1` (va al final de la lista) y enviarlo en el `POST` sin que el usuario lo vea; al **editar** un sitio (cambiar nombre/url/info/pvp), reenviar su `prioridad` actual sin modificarla. El único flujo que SÍ cambia `prioridad` es el arrastre (punto 2). Si al implementar se concluye que es más limpio quitar `prioridad` de la validación del backend y manejarlo como un campo aparte, evaluarlo en ese momento — pero empezar por la opción que no toca el backend.
4. El panel **Sitios registrados** debe aparecer **antes** que el formulario de creación/edición en el layout de la página (hoy el formulario está primero).
5. El formulario **no es visible por defecto** al entrar a `/admin/sitios` — se despliega únicamente cuando el usuario hace clic en **Editar** de una fila existente (ya existe ese flujo, `editar(sitio)`) o en un botón **Agregar** nuevo (agregarlo a la interfaz, junto al encabezado del panel "Sitios registrados" parece el lugar más natural). Se necesita un estado explícito de "formulario visible/oculto" en el componente — hoy el formulario siempre está montado y `sitioEditandoDominio() === null` solo distingue crear vs. editar, pero no oculta nada; con este cambio hace falta un signal adicional (ej. `formularioVisible`) o equivalente, y el botón "Agregar" debe también limpiar el formulario y salir de cualquier modo de edición previo.

**Archivos:**
- `src/app/features/admin/gestion-sitios-scraping.component.ts` — quitar `prioridad` del `FormGroup` reactivo, agregar el signal de visibilidad del formulario, el `computed()` de sitios ordenados por prioridad, el cálculo automático de `prioridad` al crear, y la lógica de guardar el nuevo orden tras arrastrar.
- `src/app/features/admin/gestion-sitios-scraping.component.html` — reordenar el layout (lista antes que formulario), envolver el formulario en un `@if` de visibilidad, agregar el botón "Agregar", quitar el campo `Prioridad` del formulario, agregar los atributos/directivas de arrastre a las filas de la lista.
- `src/app/features/admin/gestion-sitios-scraping.component.spec.ts` — cubrir: orden por prioridad, el formulario oculto por defecto y su apertura vía "Agregar"/"Editar", que crear un sitio nuevo asigna `prioridad` automáticamente sin campo visible, y que arrastrar reordena y persiste las prioridades recalculadas.
- Evaluar `@angular/cdk` (`DragDropModule`, `cdkDropList`/`cdkDrag`) para el arrastre — es la solución estándar de primera parte para Angular, probablemente no esté instalada todavía (confirmar con `npm ls @angular/cdk` antes de instalar); alternativa sin dependencia nueva sería implementar drag-and-drop nativo con los eventos HTML5 (`dragstart`/`dragover`/`drop`), más código propio pero cero dependencias nuevas — decidir al implementar, documentando la razón elegida en `MEMORY.md` si se opta por una dependencia nueva.

**Qué hacer:**
1. Confirmar con el usuario que hay luz verde para empezar (ver nota de créditos arriba) antes de escribir código.
2. Implementar el ordenamiento por `prioridad` en el listado (independiente de lo demás, se puede verificar primero).
3. Ocultar el formulario por defecto; agregar el botón "Agregar"; reordenar el layout (lista antes que formulario).
4. Quitar el campo `Prioridad` del formulario; implementar el cálculo automático al crear y la preservación al editar.
5. Implementar el arrastre (CDK o nativo) y la persistencia del nuevo orden vía `actualizarSitio`.
6. Cubrir con `npm test -- --watch=false`.

**Definition of done:**
- [ ] `npm run build` y `npm test -- --watch=false` pasan sin errores
- [ ] La lista de "Sitios registrados" aparece ordenada por `prioridad` y antes que el formulario
- [ ] El formulario está oculto por defecto; se abre con "Agregar" (vacío, modo crear) o "Editar" (precargado, modo edición)
- [ ] El campo `Prioridad` ya no aparece en ningún formulario; crear un sitio nuevo le asigna la prioridad siguiente automáticamente
- [ ] Arrastrar una fila a una nueva posición persiste el nuevo orden (verificable recargando la página o releyendo la tabla)
- [ ] Verificado en vivo contra `staging` con la cuenta `administrador` real

---

## Tarea 2 — [FEATURE]: `GestionUsuariosComponent` — CRUD real de usuarios en `/admin/usuarios`

**Origen:** `PRD.md` §5.6 ("Gestión de usuarios: crear, editar, borrar vendedores y administradores"), prioridad Media (`PRD.md` §6). El backend (`CRUD /api/usuarios`, administrador exclusivo, con las salvaguardas de ADR-009 — un administrador no puede cambiar su propio rol ni eliminarse a sí mismo vía este endpoint) ya está implementado y verificado en vivo desde hace varias tareas — falta la pantalla real de administración que lo consume. Independiente de la Tarea 1 (panel de sitios de scraping): esta tarea es puramente CRUD de datos, sin ninguna relación con scraping.

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
