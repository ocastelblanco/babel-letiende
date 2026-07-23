# TODO.md — Babel

Motor JIT: este documento mantiene **siempre exactamente 2 tareas atómicas** activas. Al completar cualquiera, se elimina, se mueve el resumen a `MEMORY.md` §2, y se calcula la siguiente tarea más prioritaria comparando `PRD.md` (roadmap) contra `MEMORY.md` (estado actual).

**Prioridad de selección aplicada:** se completó `DESIGN.md` propio de Babel (PR #46) — con esto, la Tarea 1 anterior queda cerrada. La Tarea 2 anterior (búsqueda por título/autor + selección de candidato al catalogar) sube a **Tarea 1**, sin cambios de alcance. Se agrega como **Tarea 2** la búsqueda/filtro en el catálogo público (`PRD.md` §5.7, prioridad Alta, parte de "Catálogo público de consulta" — la única pieza de ese ítem del roadmap que sigue sin implementar): `CatalogoPublicoComponent` hoy solo lista todo el catálogo sin filtro (comentario explícito en `catalogo-publico.component.ts`: "Sin filtros de texto/autor/tema todavía"), y `GET /api/libros` no acepta ningún parámetro de búsqueda. Ambas tareas son independientes entre sí (una es el flujo de catalogación para el vendedor, la otra es el catálogo público para cualquier visitante).

---

## Tarea 1 — [FEATURE]: búsqueda por título/autor + UI de selección de candidato al catalogar

**Origen:** `PRD.md` §5.2 (mismo paso del flujo de catalogación ya automatizado por ISBN), pieza final —**diferida a propósito**— de la iniciativa de obtención automatizada de info de libros (ver nota en `plan-obtencion-info-libros.md` y `MEMORY.md` §2: "queda diferida, a propósito, la búsqueda por título/autor + UI de selección de candidato"). Hoy, si el vendedor no tiene el ISBN (libro sin código de barras legible, o directamente sin ISBN), no hay ningún camino automático — debe llenar todo a mano. Esta tarea cierra ese hueco.

**⚠️ Alcance genuinamente nuevo — requiere más investigación previa que las tareas anteriores de esta iniciativa (no asumir nada de lo siguiente sin confirmarlo primero, mismo criterio ya aplicado a `api.letiende.co`/los 4 sitios de scraping):**
- `api.letiende.co/libros?titulo=<texto>&autor=<texto>` **ya soporta búsqueda por título/autor** (confirmado leyendo el código fuente real de la Lambda `letiende-api` durante la tarea de metadatos por ISBN — ver `server/api/services/api-letiende.ts`, que hoy SOLO usa el parámetro `barcode`). Falta confirmar en vivo qué forma tiene la respuesta cuando hay **múltiples resultados** (a diferencia de la búsqueda por ISBN, que normalmente resuelve a un único libro) — probablemente un array de `items` con varios `volumeInfo`, pero HAY QUE VERIFICARLO con una búsqueda real antes de diseñar el contrato de respuesta.
- Los 4 adaptadores de `server/api/services/scraping.ts` (Lerner, Nacional, Tornamesa, Busca Libre) hoy **solo buscan por ISBN** (`scrapearSitio(sitio, isbn)`) — buscar por título/autor en cada sitio (Lerner/Nacional vía su API VTEX ya soportan `ft=<texto libre>`, debería funcionar igual con texto que con ISBN; Tornamesa/Busca Libre habría que confirmar si sus endpoints de búsqueda aceptan texto libre de la misma forma) casi con certeza devuelve **múltiples resultados**, no uno solo — a diferencia del caso por ISBN, donde normalmente hay cero o un match claro.
- **Por eso hace falta una UI de selección de candidato** (a diferencia de todo lo construido hasta ahora, que pre-carga campos automáticamente sin intervención): el vendedor ve una lista de resultados (portada + título + autor de cada uno) y elige el libro exacto antes de que se pre-carguen los campos — evita catalogar el libro equivocado por una coincidencia parcial de texto.

**Qué hacer (orden sugerido, ajustar tras la investigación del punto anterior):**
1. Investigar en vivo el contrato real de `api.letiende.co` para búsqueda por título/autor (mismo método que se usó para `barcode`: `curl`/petición directa con datos reales, no adivinar) y de al menos 2-3 de los 4 sitios de scraping para búsqueda por texto libre.
2. Backend: nuevo endpoint o extensión de `GET /api/metadatos/:isbn` (evaluar si conviene una ruta nueva tipo `GET /api/metadatos/buscar?titulo=&autor=` en vez de forzarlo en la ruta existente, que está pensada para un ISBN único) que devuelva una LISTA de candidatos (`{ titulo, autor, editorial, portadaUrl }[]`, sin `pvp` todavía — el PVP se resuelve recién cuando el vendedor elige un candidato y, si hace falta, se dispara una búsqueda por ISBN normal con el ISBN de ese candidato específico, reusando todo lo ya construido).
3. Frontend: en `CatalogarLibroComponent`, cuando el vendedor no tiene ISBN (campo vacío) e ingresa título/autor manualmente, disparar la búsqueda y mostrar una lista/modal de candidatos (portada + título + autor) para elegir — al seleccionar uno, pre-cargar el formulario igual que ya hace `buscarYPrecargarMetadatos` hoy con el ISBN.
4. Definir la guardia SSRF para las nuevas peticiones de búsqueda por texto en los sitios de scraping — reusar `esUrlSegura`/`fetchSeguro` de `scraping.ts`, no reimplementar nada nuevo.
5. Cubrir con tests backend y frontend, incluida la UI de selección de candidato (varios resultados, un resultado, cero resultados).

**Definition of done (ajustar tras el paso 1 de investigación, este es el mínimo esperado):**
- [ ] Contrato real de búsqueda por texto de `api.letiende.co` y de al menos 2 sitios de scraping confirmado en vivo, no adivinado
- [ ] `npm run build`, `npm run build:api`, `npm test -- --watch=false`, `npm run test:api` pasan sin errores
- [ ] El vendedor puede buscar por título/autor sin ISBN, ver una lista de candidatos con portada, y elegir uno para pre-cargar el formulario
- [ ] Verificado en vivo contra `staging` con un libro real sin ISBN a mano

---

## Tarea 2 — [FEATURE]: búsqueda y filtro en el catálogo público

**Origen:** `PRD.md` §5.7 ("Cualquier persona puede ver el catálogo completo y buscar/filtrar por nombre, autor, tema (si los metadatos lo permiten) o ISBN") y `tech-specs.md` (el módulo `catalogo-publico/` se describe como "Búsqueda y ficha de libro (SSR, sin auth)"). "Catálogo público de consulta (SSR, sin autenticación)" es prioridad Alta en el roadmap (`PRD.md` §6) y hoy solo está parcialmente implementado: `CatalogoPublicoComponent` lista **todo** el catálogo sin ningún filtro (comentario explícito en el propio código: `catalogo-publico.component.ts` — "Sin filtros de texto/autor/tema todavía (fuera de alcance, ver `TODO.md`)"), y `GET /api/libros` no acepta ningún parámetro de búsqueda. Con el caso de uso fundacional de 3.000+ libros, listar todo sin poder buscar hace que el catálogo público sea poco usable en la práctica.

**Qué investigar/decidir antes de implementar (no asumir, confirmar contra el código real):**
- Si el filtro debe resolverse **en el cliente** (sobre el `libros()` signal que `LibrosService` ya carga completo desde `GET /api/libros`, sin cambios de backend) o **en el backend** (nuevos parámetros de query en `GET /api/libros`, con `Scan` + filtro en memoria como ya se hace en `GET /api/ventas` — ver `MEMORY.md` §2, PR #26 — dado que DynamoDB no soporta bien búsqueda de texto libre). Con 3.000+ libros cargados de una vez hoy (sin paginación), evaluar si ese volumen ya es un problema de payload/rendimiento independiente del filtro, y si esta tarea debe resolverlo de paso o dejarlo para otra tarea.
- "Tema", mencionado en el PRD, no existe como campo en el modelo `Libro` actual (`isbn`, `titulo`, `autor`, `editorial`, `portadaUrl`, `pvp`, `estanteId`, etc. — ver `server/api/handlers/libros.ts`) — confirmar si "tema" ya no aplica (los metadatos de Google Books vía `api.letiende.co` no lo traen, según lo verificado en la tarea de autocompletado por ISBN) o si el alcance de esta tarea es solo nombre/autor/ISBN.
- Si la "ficha de libro" (página de detalle por libro, mencionada en `tech-specs.md` y en el requisito de SEO de `PRD.md` §8) es parte de esta misma tarea o una tarea aparte — hoy no existe ninguna ruta de detalle por libro, solo el listado en `/`.

**Qué hacer (orden sugerido, ajustar tras la investigación del punto anterior):**
1. Decidir cliente vs. backend para el filtro (ver arriba) y, si aplica, extender `GET /api/libros` con los parámetros de búsqueda decididos.
2. Frontend: agregar un campo de búsqueda (y filtros si aplica) a `CatalogoPublicoComponent`, actualizando el listado según el texto ingresado — mismo criterio de UX mobile-first que el resto del catálogo público.
3. Cubrir con tests backend (si hay cambios de API) y frontend (búsqueda con resultados, sin resultados, término vacío).

**Definition of done (ajustar tras la investigación del punto anterior, este es el mínimo esperado):**
- [ ] Decisión cliente/backend para el filtro documentada (comentario en el código o `ADR`, según el impacto)
- [ ] `npm run build`, `npm run build:api` (si aplica), `npm test -- --watch=false`, `npm run test:api` (si aplica) pasan sin errores
- [ ] Un visitante público puede buscar un libro por nombre/autor/ISBN desde `/` y ver el resultado filtrado
- [ ] Verificado en vivo contra `staging`
