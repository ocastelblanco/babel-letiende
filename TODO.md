# TODO.md — Babel

Motor JIT: este documento mantiene **siempre exactamente 2 tareas atómicas** activas. Al completar cualquiera, se elimina, se mueve el resumen a `MEMORY.md` §2, y se calcula la siguiente tarea más prioritaria comparando `PRD.md` (roadmap) contra `MEMORY.md` (estado actual).

**Prioridad de selección aplicada:** se completó la búsqueda/filtro del catálogo público (PR #49) — con esto, todos los ítems de prioridad Alta/Media del roadmap (`PRD.md` §6) quedan cubiertos salvo la ficha de libro, la última pieza pendiente de "Catálogo público de consulta". La Tarea 2 anterior (ficha de libro) sube a **Tarea 1**, sin cambios de alcance. Tras ella, los únicos ítems de roadmap que quedan son de prioridad Baja: "Modo offline / cola de sincronización" y "Empaquetado nativo" (este último explícitamente fuera del alcance actual, `CLAUDE.md` §2). Se agrega como **Tarea 2** el **plan** (solo documentación, sin código) del modo offline/cola de sincronización — mismo criterio ya usado para iniciativas grandes de este proyecto (`plan-obtencion-info-libros.md`, Step 0 = documentación antes de implementar): es una iniciativa genuinamente compleja (Service Worker, cola persistente, resolución de conflictos entre catalogaciones concurrentes sin señal) que merece diseño explícito antes de tocar código. Ambas tareas son independientes entre sí.

---

## Tarea 1 — [FEATURE]: ficha de libro (página de detalle público)

**Origen:** `tech-specs.md` describe el módulo `catalogo-publico/` como "Búsqueda **y ficha de libro** (SSR, sin auth)" y `PRD.md` §8 (requisitos no funcionales) exige explícitamente SSR "para las páginas de catálogo **y ficha de libro**" por motivos de SEO. Hoy `CatalogoPublicoComponent` solo renderiza un listado en `/` (con búsqueda, ya completada) — no existe ninguna ruta de detalle por libro (`/libro/:bookId` o similar). Sin esta pieza, un buscador no puede indexar ni enlazar directamente a un libro específico del catálogo, y un visitante no tiene una URL propia para compartir un libro puntual. Además, `PRD.md` §7 (casos de uso) exige mostrarle al visitante público "el PVP y la ubicación física dentro de la librería, si está disponible" — hoy el listado NO muestra ubicación física (solo título/autor/PVP); la ficha es el lugar natural para esa información, que no cabe bien en una tarjeta de grilla compacta.

**Qué ya existe y se puede reutilizar (confirmado leyendo el código, no adivinado):**
- El backend ya resuelve un libro por `bookId` con `obtenerPorClave<Libro>(nombreTablaLibros(), { bookId })` (usado hoy en `handlerCambiarEstante`, `server/api/handlers/libros.ts`) — falta exponerlo como endpoint público de solo lectura (`GET /api/libros/:bookId`, sin autenticación, mismo criterio que `GET /api/libros`).
- `LibrosService` (frontend) hoy solo expone `cargarCatalogo()` (todo el listado) — necesita un método nuevo para pedir un libro puntual, o evaluar si conviene reutilizar `libros()` (el catálogo ya cargado) con un `computed()` cuando ya está en memoria, con fallback a la petición puntual si se entra directo por URL (mismo patrón ya usado en `CambiarEstanteComponent`, ver `MEMORY.md` §2, PR #28 — aunque ahí es una ruta protegida con catálogo ya cargado por sesión, acá es pública y puede ser la primera carga de la página).
- Para la ubicación física: el `Libro` solo trae `estanteId` (no el nombre del espacio/mueble/ubicación) — hace falta resolver contra `babel-estantes` (mismo patrón de `EstantesService`, pero sin autenticación en este caso al ser una ruta pública) o incluir esos datos ya resueltos en la respuesta del nuevo endpoint de detalle (evaluar cuál conviene más, el endpoint puntual es una sola consulta adicional, no un `Scan`).

**Qué hacer (orden sugerido):**
1. Backend: `GET /api/libros/:bookId` — endpoint público (sin auth, mismo criterio que `GET /api/libros`), `404` si el `bookId` no existe. Evaluar si conviene resolver `estanteId` → datos del estante en el mismo endpoint (para evitar una segunda petición pública desde el frontend) o dejarlo para un endpoint de estantes público aparte.
2. Frontend: nueva ruta pública `/libro/:bookId` con `RenderMode.Server` en `app.routes.server.ts` (a diferencia de las rutas protegidas por `AuthGuard`/`RoleGuard`, que son `RenderMode.Client` — ver el comentario ya existente en ese archivo sobre por qué; una ficha pública sin guard sí puede prerenderizarse/servirse en el servidor para SEO, tal como ya anticipa ese mismo comentario).
3. Enlazar cada tarjeta de `CatalogoPublicoComponent` a su ficha (`/libro/:bookId`).
4. Mostrar la ubicación física (espacio/mueble/ubicación del estante) en la ficha, cuando esté disponible — cierra el requisito de `PRD.md` §7 que hoy no cumple ni el listado ni ninguna otra pantalla pública.
5. Metadatos SEO básicos de la ficha (título de página, posiblemente `<meta>` description/Open Graph con portada) — evaluar alcance mínimo razonable, sin sobre-construir.
6. Cubrir con tests backend y frontend (libro encontrado, no encontrado/404, con y sin estante resuelto).

**Definition of done:**
- [ ] `npm run build`, `npm run build:api`, `npm test -- --watch=false`, `npm run test:api` pasan sin errores
- [ ] Un visitante puede entrar directo a `/libro/:bookId` (sin pasar por el listado) y ver los datos del libro, incluida su ubicación física si está disponible
- [ ] `/libro/:bookId` con un `bookId` inexistente responde con un estado manejado (404 visible, no un error crudo)
- [ ] Verificado en vivo contra `staging`

---

## Tarea 2 — [DOCS]: plan de modo offline / cola de sincronización para catalogación sin señal

**Origen:** `PRD.md` §6 (roadmap, prioridad Baja): "Modo offline / cola de sincronización para catalogación sin señal". Con la ficha de libro (Tarea 1) cerrando el último ítem de prioridad Alta/Media del roadmap, este es el siguiente ítem real pendiente (el otro ítem Baja, empaquetado nativo, está explícitamente fuera del alcance actual — `CLAUDE.md` §2). Es una iniciativa genuinamente compleja — a diferencia de las tareas atómicas recientes, toca la arquitectura del cliente (Service Worker, almacenamiento persistente en el navegador, sincronización en segundo plano) y decisiones de producto no triviales (qué pasa si dos vendedores catalogan el mismo estante sin señal y sincronizan después, cómo se le informa al vendedor que una catalogación quedó en cola vs. confirmada) — amerita diseño explícito antes de escribir código, mismo criterio ya aplicado a la iniciativa de obtención automatizada de info de libros (`plan-obtencion-info-libros.md`, Step 0 = documentación).

**Qué investigar/decidir antes de escribir el plan (no asumir, confirmar contra el código real):**
- Alcance real del "modo offline": ¿solo el flujo de catalogación (`POST /api/libros`), o también venta (`POST /api/ventas`) y cambio de estante? El roadmap lo menciona solo para "catalogación", pero conviene confirmar si el usuario quiere ampliarlo.
- Mecanismo de cola: IndexedDB (vía alguna librería, ej. Workbox Background Sync) vs. una implementación propia más simple dado el volumen esperado (un vendedor cataloga, no cientos de operaciones en paralelo).
- Qué pasa con la resolución automática de metadatos/PVP (`GET /api/metadatos/...`, que SÍ requiere red) cuando no hay señal — probablemente el vendedor completa todo a mano en modo offline, sin autocompletado, y el enriquecimiento automático solo aplica si hay señal al momento de escanear.
- Cómo se comunica al vendedor visualmente que una catalogación está "en cola, pendiente de sincronizar" vs. "confirmada en el servidor" — no es un detalle menor dado que el vendedor podría catalogar el mismo libro dos veces si no le queda claro que ya quedó en cola.
- Requiere revisar si Angular SSR + PWA (`@angular/service-worker` ya viene con el scaffold, confirmar si está configurado) ya trae algo de esto de fábrica o si hay que construirlo desde cero.

**Qué hacer:**
1. Investigar los puntos de arriba contra el código y configuración real del proyecto (no adivinar el estado de `@angular/service-worker`, confirmarlo).
2. Escribir `plan-modo-offline.md` en la raíz del repo (mismo nivel que `plan-obtencion-info-libros.md`), con alcance acordado, decisión de mecanismo de cola, manejo de conflictos, y UX de estados (en cola/sincronizado/error).
3. Actualizar `PRD.md`/`tech-specs.md`/`MEMORY.md`/`TODO.md` según haga falta para reflejar el plan.
4. Abrir un PR **solo de documentación** (`docs/plan-modo-offline`) — sin tocar código. La implementación queda como tarea(s) atómica(s) futuras, una vez el usuario apruebe el plan.

**Definition of done:**
- [ ] `plan-modo-offline.md` existe en la raíz del repo con alcance, mecanismo de cola, manejo de conflictos y UX de estados definidos
- [ ] No se modificó ningún archivo de código (`.ts`/`.html`) — solo documentación
- [ ] El usuario revisó y aprobó el plan antes de que se cree cualquier tarea de implementación en este documento
