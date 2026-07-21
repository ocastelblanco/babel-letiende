# TODO.md — Babel

Motor JIT: este documento mantiene **siempre exactamente 2 tareas atómicas** activas. Al completar cualquiera, se elimina, se mueve el resumen a `MEMORY.md` §2, y se calcula la siguiente tarea más prioritaria comparando `PRD.md` (roadmap) contra `MEMORY.md` (estado actual).

**Prioridad de selección aplicada:** el escaneo de ISBN con cámara se completó (PR #30, fusionado): botón "Escanear ISBN" en `CatalogarLibroComponent` con `@zxing/browser`, autocompleta el campo `isbn` al detectar un EAN-13, libera la cámara automáticamente. Verificado en vivo por el usuario contra `staging` en un celular real (cámara + `getUserMedia` en producción). El mismo PR corrigió de paso un incidente real de infraestructura: el deploy a `staging` falló porque las Lambdas de backend excedían el límite de AWS de 250MB descomprimidos (ver `MEMORY.md` §7). Se agrega como Tarea 1 el siguiente paso del mismo flujo crítico (`PRD.md` §5.2, prioridad Alta): autocompletar metadatos del libro (título/autor/portada/editorial) a partir del ISBN, vía la API externa `api.letiende.co` ya existente — desbloqueado ahora que el ISBN se puede obtener por escaneo o entrada manual. Se deja fuera de esta tarea, a propósito, la búsqueda automática de PVP por scraping/Google Custom Search (mismo paso del flujo en `PRD.md` §5.2): es una pieza con superficie de seguridad propia (SSRF, lista blanca — `CLAUDE.md` A10) que amerita su propia tarea y revisión dedicada, no mezclarla con el autocompletado de metadatos (sin riesgo de SSRF, solo consume una API interna de confianza). `GestionEstantesComponent` (Tarea 2, sin cambios de contenido) sube de posición: quedaba pendiente en el TODO anterior, prioridad Media, todavía sin empezar. Ambas tareas son independientes entre sí: una toca `server/api/handlers/metadatos.ts` (nuevo) + `CatalogarLibroComponent`, la otra agrega una pantalla nueva bajo `/admin/estantes`.

---

## Tarea 1 — [FEATURE]: `GET /api/metadatos/:isbn` — autocompletar metadatos del libro al catalogar

**Origen:** `PRD.md` §5.2 ("Flujo de catalogación completo": tras obtener el ISBN, "Sistema busca datos del libro (autor, portada, editorial, nombre)... Datos encontrados → se muestran pre-cargados... Datos no encontrados → el vendedor los completa manualmente"), prioridad Alta (`PRD.md` §6). `tech-specs.md` línea 251 ya documenta el endpoint (`GET /api/metadatos/:isbn`, caller Vendedor/Admin) y línea 82 la fuente (`api.letiende.co`, proxy sobre Google Books API, ya existente y compartido — `CLAUDE.md` §2). Independiente de la Tarea 2 (`GestionEstantesComponent`).

**Alcance de esta tarea (importante):** SOLO metadatos bibliográficos (título, autor, portada, editorial). La búsqueda automática de PVP (scraping en lista blanca + Google Custom Search de respaldo, mismo paso del flujo en `PRD.md` §5.2) queda fuera a propósito — es una superficie de seguridad distinta (SSRF, `CLAUDE.md` A10) que ya tiene sus propios secrets provisionados (`GOOGLE_CUSTOM_SEARCH_API_KEY`/`CX`) pero merece su propia tarea y revisión dedicada, no mezclarse con esta.

**Archivos:** `server/api/services/api-letiende.ts` (nuevo — cliente HTTP hacia `api.letiende.co`, usa la variable de entorno `API_LETIENDE_BASE_URL` ya declarada en `serverless.yml` pero sin consumidor todavía), `server/api/handlers/metadatos.ts` (nuevo, con su `.spec.ts`), `serverless.yml` (nueva función Lambda `metadatos`, rol IAM propio con `dynamodb:GetItem` sobre `babel-usuarios` — mismo patrón que `usuariosMe`/`estantes` para resolver el rol del token, más las exclusiones de `node_modules/**` ya establecidas en las otras 9 funciones para no repetir el incidente de tamaño de `MEMORY.md` §7), `src/app/core/api/metadatos.service.ts` (nuevo, cliente autenticado, mismo patrón que `EstantesService`), `src/app/features/catalogar/catalogar-libro.component.ts`/`.html` (consumir el servicio para pre-cargar `titulo`/`autor`/`editorial`/`portadaUrl` cuando hay un ISBN disponible).

**Qué hacer:**
1. **Investigar primero el contrato real de `api.letiende.co`** (no está documentado con detalle en este repo, solo que "resuelve ISBN → título/autor/portada/editorial vía Google Books API" — `tech-specs.md` línea 82): hacer una petición real con un ISBN válido conocido (`curl` o similar) para confirmar la ruta exacta y la forma de la respuesta antes de escribir el cliente. `API_LETIENDE_BASE_URL` ya existe como secret/variable de entorno (`serverless.yml`, sin consumidor todavía) — confirmar su valor con el usuario si hace falta.
2. Implementar `server/api/services/api-letiende.ts`: función que recibe un ISBN, llama a `api.letiende.co` y devuelve `{ titulo, autor, editorial, portadaUrl }` (o `null`/campos vacíos si no se encuentra) — manejar timeouts/errores de red sin tumbar el endpoint (degradar a "no encontrado", nunca un 500 por una API externa caída).
3. Implementar `server/api/handlers/metadatos.ts` (`handlerObtenerMetadatos` o similar): exige rol `vendedor` o `administrador` (mismo patrón `verificar-token` + `babel-usuarios` que el resto de endpoints autenticados), valida el `isbn` de la ruta, llama al servicio nuevo y responde `200` con los metadatos (o un objeto con campos vacíos/`null` si no se encontró — nunca `404` para este caso, es un resultado válido del flujo, ver `PRD.md` §5.2 "Datos no encontrados → el vendedor los completa manualmente").
4. Agregar la función Lambda `metadatos` a `serverless.yml`: rol IAM propio (mínimo privilegio, `CLAUDE.md` A05), `package.patterns` con las mismas exclusiones de `node_modules/**` ya aplicadas a las otras 9 funciones (copiar el bloque literal, ver comentario en la función `usuariosMe`).
5. `MetadatosService` (frontend, `core/api/`): método autenticado `obtenerMetadatos(isbn)` que llama `GET /api/metadatos/:isbn`, mismo patrón de manejo de error que `EstantesService`.
6. En `CatalogarLibroComponent`: al tener un ISBN disponible (por escaneo o al salir del campo si se ingresó manualmente), llamar a `MetadatosService` y pre-cargar `titulo`/`autor`/`editorial`/`portadaUrl` en el formulario reactivo — el vendedor SIEMPRE puede editar los valores pre-cargados antes de guardar (`CLAUDE.md` A08, no son de confianza ciega). Si la API no encuentra nada o falla, el formulario sigue siendo 100% editable manualmente, sin ningún mensaje bloqueante.
7. Cubrir con `npm run test:api` (backend: casos 401/403/200-encontrado/200-no-encontrado del handler, con el cliente de `api.letiende.co` mockeado) y `npm test -- --watch=false` (frontend: que un ISBN disponible dispara la búsqueda y pre-carga el formulario, que un fallo no bloquea la edición manual).

**Definition of done:**
- [ ] `npm run build`, `npm run build:api`, `npm test -- --watch=false` y `npm run test:api` pasan sin errores
- [ ] Tests unitarios cubren el handler (backend) y el pre-cargado/fallback manual (frontend)
- [ ] Verificado en vivo contra `staging` con un ISBN real de un libro existente (confirmar que los metadatos pre-cargan) y con un ISBN inventado/inexistente (confirmar que el formulario sigue siendo editable sin errores)
- [ ] Los campos pre-cargados siguen siendo editables manualmente antes de guardar
- [ ] La función Lambda nueva queda bajo el límite de 250MB descomprimidos (mismo chequeo que las otras 9, ver `MEMORY.md` §7)

---

## Tarea 2 — [FEATURE]: `GestionEstantesComponent` — CRUD real de estantes en `/admin/estantes`

**Origen:** `PRD.md` §6 ("Configuración de estantes (CRUD)", prioridad Media) y `tech-specs.md` §4.2 (ruta `/admin/estantes`, `AuthGuard` + `RoleGuard(admin)`). El backend (`CRUD /api/estantes`, administrador exclusivo para escritura) ya está implementado y verificado en vivo desde hace varias tareas — esta es la primera pantalla real de administración que lo consume, ahora que `/admin` existe como punto de entrada (`TODO.md` histórico, PR #29). Primer CRUD de los 3 pendientes (`estantes`, `usuarios`, `editoriales-descuentos`) — se elige `estantes` primero por ser el más simple (3 campos: `espacio`, `mueble`, `ubicacion`, sin relaciones con otras tablas) y porque `EstantesService` ya existe (hoy solo lectura).

**Archivos:** `src/app/core/api/estantes.service.ts` (extender con métodos autenticados `crearEstante`/`actualizarEstante`/`eliminarEstante`, mismo patrón que `cargarEstantes`), `src/app/features/admin/gestion-estantes.component.ts` (nuevo), ruta nueva `/admin/estantes` en `app.routes.ts` (guardada con `RoleGuard('administrador')`, mismo patrón que `/admin`), `src/app/features/admin/admin-inicio.component.html` (cambiar la card "Estantes" de placeholder deshabilitado a `routerLink="/admin/estantes"` real).

**Qué hacer:**
1. Extender `EstantesService` con `crearEstante(datos)`/`actualizarEstante(estanteId, datos)`/`eliminarEstante(estanteId)` — peticiones autenticadas (`Authorization: Bearer <idToken>`) a `POST`/`PUT`/`DELETE /api/estantes`, mismo patrón de manejo de error que el resto de servicios de `core/api`. Recargar `estantes` (Signal existente) tras cada operación exitosa.
2. Implementar `GestionEstantesComponent` (standalone, ruta `/admin/estantes`): lista los estantes existentes (reutilizando `cargarEstantes()`), formulario reactivo para crear uno nuevo, edición y borrado por fila, mensajes de éxito/error.
3. Agregar la ruta a `app.routes.ts` (`RoleGuard('administrador')`) y a `app.routes.server.ts` (`RenderMode.Client`, mismo motivo que `/admin`). Activar el enlace real desde `AdminInicioComponent`.
4. Cubrir con `npm test -- --watch=false`: los 3 métodos nuevos de `EstantesService` (éxito/error) y los casos principales de `GestionEstantesComponent` (lista, crea, edita, elimina, error).

**Definition of done:**
- [ ] `npm run build` y `npm test -- --watch=false` pasan sin errores
- [ ] Tests unitarios cubren los métodos nuevos del servicio y los casos principales del componente
- [ ] Verificado manualmente contra `staging` (misma decisión de verificación que las tareas de frontend anteriores: combinar evidencia o pedir verificación manual al usuario — ya existe una cuenta `administrador` real sembrada, `letiende.co@gmail.com`)
- [ ] Un `vendedor` no puede acceder a `/admin/estantes` (`RoleGuard`, misma protección ya usada en `/admin`)
