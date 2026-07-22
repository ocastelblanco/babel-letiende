# TODO.md — Babel

Motor JIT: este documento mantiene **siempre exactamente 2 tareas atómicas** activas. Al completar cualquiera, se elimina, se mueve el resumen a `MEMORY.md` §2, y se calcula la siguiente tarea más prioritaria comparando `PRD.md` (roadmap) contra `MEMORY.md` (estado actual).

**Prioridad de selección aplicada:** se completó el reordenamiento arrastrable en `/admin/sitios` (el campo `Prioridad` manual desapareció de los formularios; el orden del listado, arrastrable con `@angular/cdk`, es ahora la fuente de verdad). Su resumen está en `MEMORY.md` §2. Con esto, las dos tareas atómicas de arranque de la iniciativa **"obtención automatizada de info de libros"** (Task A: CRUD de sitios; Task B: motor de scraping + guardia SSRF) están completas y verificadas en vivo — la Task C (integrar la cadena en `/api/metadatos/:isbn`) queda **desbloqueada** y es prioridad Alta (`PRD.md` §6, "Flujo de catalogación completo"), así que sube a **Tarea 1**, por delante de `GestionUsuariosComponent` (Tarea 2, prioridad Media, sin cambios, sigue en cola — ambas tareas son independientes entre sí).

---

## Tarea 1 — [FEATURE]: integrar metadatos + PVP con fallback de scraping en `/api/metadatos/:isbn` (Task C)

**Origen:** `plan-obtencion-info-libros.md` §6 (Task C), última pieza de la iniciativa de obtención automatizada de info de libros (`PRD.md` §5.2, prioridad Alta). Conecta lo que ya existe y está verificado por separado: `obtenerMetadatosPorIsbn` (`api-letiende.ts`, ya en producción) y `scrapearSitio` (`scraping.ts`, PR #39, **sin ningún consumidor todavía** — confirmado con `grep`). Esta tarea es la que finalmente hace útil el motor de scraping.

**Contrato de salida nuevo:** `GET /api/metadatos/:isbn` debe devolver `{ titulo, autor, editorial, portadaUrl, pvp }` — el campo `pvp` es nuevo (`number | null`; hoy `MetadatosLibro` en `api-letiende.ts` y `metadatos.service.ts` no lo tienen, hay que agregarlo en ambos, backend y frontend). Sigue respondiendo siempre `200`, incluso con todos los campos en `null` (mismo criterio ya establecido: "no encontrado" es un resultado válido del flujo, `CLAUDE.md` A08).

**Orden de resolución (importante, no es solo "en cascada"):**
1. `obtenerMetadatosPorIsbn(isbn)` primero (`api.letiende.co`, con su reintento ya existente) — resuelve `titulo`/`autor`/`editorial`/`portadaUrl`. **Nunca resuelve `pvp`** (Google Books no maneja precios — confirmado leyendo `MetadatosLibro`, que no tiene ese campo).
2. Si falta algún campo de info, o si `pvp` sigue sin resolverse (que será casi siempre, ver punto anterior), leer los sitios de `babel-sitios-scraping` (`escanearTodo<SitioScraping>`, mismo patrón que `sitios-scraping.ts`) y llamar `scrapearSitio(sitio, isbn)` **para TODOS los sitios aplicables EN PARALELO** (`Promise.all`/`Promise.allSettled`) — **no secuencial por prioridad**. Un sitio es "aplicable" si tiene `info=true` (cuando aún falta algún campo de info) o `pvp=true` (cuando aún falta `pvp`); si un sitio no tiene ningún adaptador de código, `scrapearSitio` ya devuelve `{}` sin fallar (ADR-010), así que no hace falta filtrar por eso aquí.
3. Al tener todas las respuestas (o las que lleguen dentro de un timeout razonable), fusionar los resultados **respetando el orden de `prioridad` ascendente como criterio de desempate** — si dos sitios devuelven el mismo campo, gana el de menor `prioridad`, sin importar cuál respondió primero en la red. Nunca sobrescribir un campo que `api.letiende.co` ya resolvió.

**⚠️ Por qué NO puede ser secuencial (hallazgo importante, verificar antes de implementar):** cada llamada a `scrapearSitio` puede tardar hasta 8000ms (`TIMEOUT_MS` en `scraping.ts`) y Tornamesa hace 2 peticiones HTTP internas (hasta 16s en el peor caso). Con 4 sitios semilla, iterar secuencialmente por `prioridad` podría tardar **más de 30 segundos** en el peor caso — muy por encima del timeout de la función Lambda `metadatos` (`serverless.yml`, `provider.timeout: 10` a nivel global, sin override propio para esta función) y de cualquier expectativa razonable de UX para un autocompletado al perder el foco de un campo. Ejecutar los sitios aplicables en paralelo acota el peor caso a ~8-16s (el sitio más lento), no a la suma de todos. Aun así, **hay que subir el `timeout` de la función `metadatos` en `serverless.yml`** (ej. a 20-25s) para dar margen — evaluar también si conviene bajar `TIMEOUT_MS` en `scraping.ts` para este caso de uso específico (autocompletado interactivo, no un batch), documentando la decisión.

**Archivos:**
- `server/api/services/api-letiende.ts` — el tipo `MetadatosLibro` pierde su exclusividad de "solo info": puede quedar igual (sin `pvp`) si el handler combina los dos tipos por separado, o evaluar si conviene introducir un tipo compartido `MetadatosCompletos` en el handler. Decisión de diseño a tomar al implementar, no hay una única forma correcta.
- `server/api/handlers/metadatos.ts` — orquesta `obtenerMetadatosPorIsbn` + `scrapearSitio` (import nuevo desde `../services/scraping`) según el algoritmo de arriba. Necesita leer `babel-sitios-scraping` (`escanearTodo`).
- `server/api/handlers/metadatos.spec.ts` — cubrir: solo `api.letiende.co` resuelve todo (no llama a scraping en absoluto — importante para no gastar tiempo/red innecesariamente), `api.letiende.co` no resuelve nada y el scraping paralelo llena los campos, empate entre dos sitios resuelto por `prioridad`, ningún sitio resuelve nada (todo `null`, sigue `200`), y que la función nunca lanza aunque `scrapearSitio` rechace (ya nunca lanza por diseño, pero verificar el `Promise.all`/`allSettled` elegido no se salte ese contrato).
- `serverless.yml`, función `metadatos`: agregar `TABLA_SITIOS_SCRAPING` a `environment`, permiso IAM `dynamodb:Scan` sobre `TablaSitiosScraping` en `MetadatosLambdaRole` (mínimo privilegio, solo lectura — CLAUDE.md A05), agregar `dist-server/api/services/scraping.js` al `package.patterns`, y subir el `timeout` de la función (ver hallazgo de arriba). **No excluir `cheerio` del empaquetado** (ya se confirmó en PR #39 que no está en ninguna lista de exclusión; revisar que siga así tras editar el bloque).
- `src/app/core/api/metadatos.service.ts` — agregar `pvp: number | null` a `MetadatosLibro` (frontend).
- `src/app/features/catalogar/catalogar-libro.component.ts`/`.html` — pre-cargar `pvp` en el campo ya existente del formulario (`formulario.controls.pvp`) SOLO si está vacío/en su valor por defecto — nunca pisar un PVP que el vendedor ya haya escrito a mano (mismo criterio ya aplicado a `titulo`/`autor`/`editorial`/`portadaUrl` en `buscarYPrecargarMetadatos`, extenderlo ahí mismo).

**Qué hacer:**
1. Implementar el algoritmo de orquestación en `metadatos.ts` (paralelo + fusión por prioridad, ver arriba).
2. Agregar `pvp` al contrato de salida y a los tipos de frontend/backend.
3. Ajustar `serverless.yml` (permisos, `package.patterns`, timeout).
4. Extender `CatalogarLibroComponent` para pre-cargar `pvp` como sugerencia editable.
5. Cubrir con `npm run test:api` (orquestación, casos de empate, timeouts) y `npm test -- --watch=false` (pre-carga de `pvp` sin pisar entrada manual).
6. Verificar el tamaño del paquete de la función `metadatos` tras el cambio (`npx serverless package --stage staging`, sigue el gotcha de `MEMORY.md` §7).

**Definition of done:**
- [ ] `npm run build`, `npm run build:api`, `npm test -- --watch=false`, `npm run test:api` pasan sin errores
- [ ] Los sitios aplicables se consultan en paralelo, nunca secuencial por prioridad (verificar con un test que mida que no se espera a un sitio antes de lanzar el siguiente)
- [ ] Un empate de campo entre dos sitios se resuelve por `prioridad` ascendente, no por orden de llegada de red
- [ ] La función `metadatos` sigue bajo 250MB y su nuevo `timeout` da margen real al peor caso (documentar el valor elegido y por qué)
- [ ] Verificado en vivo contra `staging`: catalogar un libro con un ISBN real donde `api.letiende.co` no tenga el PVP, confirmar que se pre-carga desde alguno de los 4 sitios y que sigue siendo editable
- [ ] Un ISBN inexistente en todas las fuentes deja el formulario 100% editable sin errores ni demoras excesivas

---

## Tarea 2 — [FEATURE]: `GestionUsuariosComponent` — CRUD real de usuarios en `/admin/usuarios`

**Origen:** `PRD.md` §5.6 ("Gestión de usuarios: crear, editar, borrar vendedores y administradores"), prioridad Media (`PRD.md` §6). El backend (`CRUD /api/usuarios`, administrador exclusivo, con las salvaguardas de ADR-009 — un administrador no puede cambiar su propio rol ni eliminarse a sí mismo vía este endpoint) ya está implementado y verificado en vivo desde hace varias tareas — falta la pantalla real de administración que lo consume. Independiente de la Tarea 1 (Task C de metadatos/scraping): esta tarea es puramente CRUD de datos, sin ninguna relación con scraping/SSRF.

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
