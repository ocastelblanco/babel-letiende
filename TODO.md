# TODO.md — Babel

Motor JIT: este documento mantiene **siempre exactamente 2 tareas atómicas** activas. Al completar cualquiera, se elimina, se mueve el resumen a `MEMORY.md` §2, y se calcula la siguiente tarea más prioritaria comparando `PRD.md` (roadmap) contra `MEMORY.md` (estado actual).

**Prioridad de selección aplicada:** se completó la búsqueda por título/autor + selección de candidato al catalogar (PR #48) — con esto, la iniciativa de obtención automatizada de info de libros (`plan-obtencion-info-libros.md`) queda completa en su totalidad, incluida la pieza que había quedado diferida a propósito. La Tarea 2 anterior (búsqueda/filtro en el catálogo público) sube a **Tarea 1**, sin cambios de alcance. Se agrega como **Tarea 2** la ficha de libro (página de detalle público por libro): `tech-specs.md` describe el módulo `catalogo-publico/` como "Búsqueda **y ficha de libro** (SSR, sin auth)" y `PRD.md` §8 (requisitos no funcionales de SEO) exige SSR específicamente "para las páginas de catálogo y ficha de libro" — hoy no existe ninguna ruta de detalle por libro, solo el listado en `/`. Ambas tareas son parte del mismo ítem de roadmap ("Catálogo público de consulta", prioridad Alta) y se relacionan naturalmente (la ficha es el destino natural de un resultado de búsqueda), pero son atómicamente independientes: cualquiera puede implementarse primero sin bloquear a la otra.

---

## Tarea 1 — [FEATURE]: búsqueda y filtro en el catálogo público

**Origen:** `PRD.md` §5.7 ("Cualquier persona puede ver el catálogo completo y buscar/filtrar por nombre, autor, tema (si los metadatos lo permiten) o ISBN") y `tech-specs.md` (el módulo `catalogo-publico/` se describe como "Búsqueda y ficha de libro (SSR, sin auth)"). "Catálogo público de consulta (SSR, sin autenticación)" es prioridad Alta en el roadmap (`PRD.md` §6) y hoy solo está parcialmente implementado: `CatalogoPublicoComponent` lista **todo** el catálogo sin ningún filtro (comentario explícito en el propio código: `catalogo-publico.component.ts` — "Sin filtros de texto/autor/tema todavía (fuera de alcance, ver `TODO.md`)"), y `GET /api/libros` no acepta ningún parámetro de búsqueda. Con el caso de uso fundacional de 3.000+ libros, listar todo sin poder buscar hace que el catálogo público sea poco usable en la práctica.

**Qué investigar/decidir antes de implementar (no asumir, confirmar contra el código real):**
- Si el filtro debe resolverse **en el cliente** (sobre el `libros()` signal que `LibrosService` ya carga completo desde `GET /api/libros`, sin cambios de backend) o **en el backend** (nuevos parámetros de query en `GET /api/libros`, con `Scan` + filtro en memoria como ya se hace en `GET /api/ventas` — ver `MEMORY.md` §2, PR #26 — dado que DynamoDB no soporta bien búsqueda de texto libre). Con 3.000+ libros cargados de una vez hoy (sin paginación), evaluar si ese volumen ya es un problema de payload/rendimiento independiente del filtro, y si esta tarea debe resolverlo de paso o dejarlo para otra tarea.
- "Tema", mencionado en el PRD, no existe como campo en el modelo `Libro` actual (`isbn`, `titulo`, `autor`, `editorial`, `portadaUrl`, `pvp`, `estanteId`, etc. — ver `server/api/handlers/libros.ts`) — confirmar si "tema" ya no aplica (los metadatos de Google Books vía `api.letiende.co` no lo traen, según lo verificado en la tarea de autocompletado por ISBN) o si el alcance de esta tarea es solo nombre/autor/ISBN.

**Qué hacer (orden sugerido, ajustar tras la investigación del punto anterior):**
1. Decidir cliente vs. backend para el filtro (ver arriba) y, si aplica, extender `GET /api/libros` con los parámetros de búsqueda decididos.
2. Frontend: agregar un campo de búsqueda (y filtros si aplica) a `CatalogoPublicoComponent`, actualizando el listado según el texto ingresado — mismo criterio de UX mobile-first que el resto del catálogo público.
3. Cubrir con tests backend (si hay cambios de API) y frontend (búsqueda con resultados, sin resultados, término vacío).

**Definition of done (ajustar tras la investigación del punto anterior, este es el mínimo esperado):**
- [ ] Decisión cliente/backend para el filtro documentada (comentario en el código o `ADR`, según el impacto)
- [ ] `npm run build`, `npm run build:api` (si aplica), `npm test -- --watch=false`, `npm run test:api` (si aplica) pasan sin errores
- [ ] Un visitante público puede buscar un libro por nombre/autor/ISBN desde `/` y ver el resultado filtrado
- [ ] Verificado en vivo contra `staging`

---

## Tarea 2 — [FEATURE]: ficha de libro (página de detalle público)

**Origen:** `tech-specs.md` describe el módulo `catalogo-publico/` como "Búsqueda **y ficha de libro** (SSR, sin auth)" y `PRD.md` §8 (requisitos no funcionales) exige explícitamente SSR "para las páginas de catálogo **y ficha de libro**" por motivos de SEO. Hoy `CatalogoPublicoComponent` solo renderiza un listado en `/` — no existe ninguna ruta de detalle por libro (`/libro/:bookId` o similar). Sin esta pieza, un buscador no puede indexar ni enlazar directamente a un libro específico del catálogo, y un visitante no tiene una URL propia para compartir un libro puntual.

**Qué ya existe y se puede reutilizar (confirmado leyendo el código, no adivinado):**
- El backend ya resuelve un libro por `bookId` con `obtenerPorClave<Libro>(nombreTablaLibros(), { bookId })` (usado hoy en `handlerCambiarEstante`, `server/api/handlers/libros.ts`) — falta exponerlo como endpoint público de solo lectura (`GET /api/libros/:bookId`, sin autenticación, mismo criterio que `GET /api/libros`).
- `LibrosService` (frontend) hoy solo expone `cargarCatalogo()` (todo el listado) — necesita un método nuevo para pedir un libro puntual, o evaluar si conviene reutilizar `libros()` (el catálogo ya cargado) con un `computed()` cuando ya está en memoria, con fallback a la petición puntual si se entra directo por URL (mismo patrón ya usado en `CambiarEstanteComponent`, ver `MEMORY.md` §2, PR #28 — aunque ahí es una ruta protegida con catálogo ya cargado por sesión, acá es pública y puede ser la primera carga de la página).

**Qué hacer (orden sugerido):**
1. Backend: `GET /api/libros/:bookId` — endpoint público (sin auth, mismo criterio que `GET /api/libros`), `404` si el `bookId` no existe.
2. Frontend: nueva ruta pública `/libro/:bookId` con `RenderMode.Server` en `app.routes.server.ts` (a diferencia de las rutas protegidas por `AuthGuard`/`RoleGuard`, que son `RenderMode.Client` — ver el comentario ya existente en ese archivo sobre por qué; una ficha pública sin guard sí puede prerenderizarse/servirse en el servidor para SEO, tal como ya anticipa ese mismo comentario).
3. Enlazar cada tarjeta de `CatalogoPublicoComponent` a su ficha (`/libro/:bookId`).
4. Metadatos SEO básicos de la ficha (título de página, posiblemente `<meta>` description/Open Graph con portada) — evaluar alcance mínimo razonable, sin sobre-construir.
5. Cubrir con tests backend y frontend (libro encontrado, no encontrado/404).

**Definition of done:**
- [ ] `npm run build`, `npm run build:api`, `npm test -- --watch=false`, `npm run test:api` pasan sin errores
- [ ] Un visitante puede entrar directo a `/libro/:bookId` (sin pasar por el listado) y ver los datos del libro, incluida su ubicación física si está disponible
- [ ] `/libro/:bookId` con un `bookId` inexistente responde con un estado manejado (404 visible, no un error crudo)
- [ ] Verificado en vivo contra `staging`
