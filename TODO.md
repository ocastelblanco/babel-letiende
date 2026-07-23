# TODO.md — Babel

Motor JIT: este documento mantiene **siempre exactamente 2 tareas atómicas** activas. Al completar cualquiera, se elimina, se mueve el resumen a `MEMORY.md` §2, y se calcula la siguiente tarea más prioritaria comparando `PRD.md` (roadmap) contra `MEMORY.md` (estado actual).

**Prioridad de selección aplicada:** se completó `GET /api/ventas/exportar` (XLSX) + `ReportesVentasComponent` — con esto, todos los ítems de prioridad Media del roadmap con backend ya disponible quedan cubiertos. Su resumen está en `MEMORY.md` §2. `DESIGN.md` propio de Babel (antes Tarea 2, sin cambios de contenido) sube a **Tarea 1**. Se agrega como **Tarea 2** la búsqueda por título/autor + UI de selección de candidato en el flujo de catalogación — quedó **explícitamente diferida** de la iniciativa de obtención automatizada de info de libros (`plan-obtencion-info-libros.md`, ver `MEMORY.md` §2, "queda diferida, a propósito"), prioridad Alta (`PRD.md` §5.2, mismo paso del flujo crítico que ya se automatizó por ISBN). Es la última pieza pendiente de esa iniciativa. Ambas tareas son independientes entre sí (una es solo documentación, la otra backend+frontend).

---

## Tarea 1 — [DOCS]: `DESIGN.md` propio de Babel

**Origen:** `CLAUDE.md` §4 ("Se recomienda crear un `DESIGN.md` propio de Babel adaptando estos tokens a los patrones específicos del catálogo de libros"). La identidad visual hereda la paleta/tipografía de Comandante (`primary #230C00`, `secondary #E8630A`, `tertiary #00B7A3`, `neutral #FFE7B3`, Poppins — Angellya solo para el logo, decisión ya registrada en `MEMORY.md` §7), pero nunca se documentó cómo esos tokens se traducen en los patrones reales ya construidos (formularios de administración, tarjetas, estados de carga/error, etc.). Con 5 pantallas CRUD/reportes de administración + catálogo público + catalogación + login ya implementadas, hay suficiente superficie real para documentar patrones concretos en vez de solo tokens heredados. Tarea solo de documentación, sin cambios de código. Independiente de la Tarea 2.

**Qué hacer:**
1. Releer los componentes ya construidos (`gestion-estantes`, `gestion-sitios-scraping`, `gestion-usuarios`, `gestion-descuentos-editoriales`, `reportes-ventas`, `catalogar-libro`, `catalogo-publico`, `login`, `admin-inicio`, `cambiar-estante`) y extraer los patrones Tailwind que se repiten literalmente en todos (clases exactas, no reinventarlas): tarjetas (`rounded-2xl bg-white p-4/p-6 shadow-[0_4px_16px_rgba(35,12,0,0.08)]`), botones primarios/secundarios/de peligro, inputs de formulario reactivo, mensajes de éxito/error, estados vacío/carga, el patrón "formulario único crear/editar oculto por defecto" ya establecido en los últimos componentes de administración.
2. Documentar los tokens de marca ya confirmados (`CLAUDE.md` §4, `MEMORY.md` §7): paleta exacta, Poppins como única tipografía de interfaz (Angellya exclusiva del logo, con el razonamiento ya registrado), formato de precios colombiano (`$45.000`).
3. Escribir `DESIGN.md` en la raíz del repo (mismo nivel que `CLAUDE.md`/`PRD.md`/`tech-specs.md`) con estas secciones como mínimo: identidad de marca (colores/tipografía), componentes reutilizables documentados con su clase Tailwind exacta y un ejemplo de uso real (archivo:línea de un componente existente), el patrón de formulario único crear/editar, y cualquier convención de espaciado/tamaño que se repita (ej. `max-w-2xl`, `px-4 py-8`).
4. No inventar patrones nuevos ni proponer cambios de diseño — este documento describe lo que YA existe en el código, para que futuras tareas lo repliquen consistentemente en vez de reinventar estilos ligeramente distintos cada vez (ej. el pequeño desvío de tamaño de tarjeta que ya existe entre algunos componentes, si lo hay, documentarlo como está, no "corregirlo" silenciosamente).

**Definition of done:**
- [ ] `DESIGN.md` existe en la raíz del repo, con secciones de marca + componentes reutilizables + patrones de formulario, cada patrón citando al menos un archivo:línea real como ejemplo
- [ ] No se modificó ningún archivo de código (`.ts`/`.html`) — solo el nuevo `.md`
- [ ] Revisar y actualizar la referencia cruzada en `CLAUDE.md` §4 si hace falta (ej. quitar el "se recomienda crear" ahora que existe)

---

## Tarea 2 — [FEATURE]: búsqueda por título/autor + UI de selección de candidato al catalogar

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
