# TODO.md — Babel

Motor JIT: este documento mantiene **siempre exactamente 2 tareas atómicas** activas. Al completar cualquiera, se elimina, se mueve el resumen a `MEMORY.md` §2, y se calcula la siguiente tarea más prioritaria comparando `PRD.md` (roadmap) contra `MEMORY.md` (estado actual).

**Prioridad de selección aplicada:** `PATCH /api/libros/:bookId/estante` se completó y se verificó **en vivo contra `staging`** con un ID Token real: primero `403` con un correo sin fila en `babel-usuarios-staging` (el script sembró y limpió sus dos estantes desechables sin llegar a tocar ningún libro, confirmando que la limpieza funciona incluso cuando el ciclo se corta temprano); luego, con ese mismo correo sembrado como `vendedor`, ciclo completo `POST`(201, libro creado en el estante origen)→`PATCH`(200, estanteId actualizado al destino)→`GET`(200, confirma el estanteId nuevo), sin dejar datos de prueba (ver `MEMORY.md` §2 y §9). Sube a Tarea 1 `GET /api/ventas` (ya estaba en el TODO como Tarea 2, sin cambios de contenido). Se agrega como Tarea 2 `CambiarEstanteComponent` (`tech-specs.md` §4.2, ruta `/libros/:bookId/estante`) — primer consumo desde el frontend del endpoint recién cerrado, mismo patrón backend-luego-frontend ya usado (`RoleGuard`/`CatalogarLibroComponent` tras `POST /api/libros`). Ambas tareas son independientes entre sí: una opera sobre `babel-ventas` (backend puro), la otra es frontend puro sobre un endpoint (`PATCH /api/libros/:bookId/estante`) ya desplegado y verificado.

---

## Tarea 1 — [FEATURE]: `GET /api/ventas` (administrador) — listar/filtrar ventas para reportes (backend)

**Origen:** `PRD.md` §5.5/§6 (roadmap, Media) — "Reportes de ventas (solo administrador)". `tech-specs.md` §5 documenta `GET /api/ventas` (listar/filtrar) separado de `GET /api/ventas/exportar` (generación del XLSX) — esta tarea cubre solo el primero: la consulta base que necesitará el exportador y, más adelante, el frontend de reportes (`ReportesVentasComponent`, fuera de alcance). Mismo patrón atómico backend-primero ya usado en cada endpoint anterior del proyecto.

**Archivos:** `server/api/handlers/ventas.ts` (agrega un handler nuevo, `handlerListar`, al mismo archivo que ya exporta `handler` de `POST /api/ventas` — mismo cuidado con `package.patterns` que en tareas anteriores, ver `MEMORY.md` §7), `serverless.yml` (nueva función Lambda `listarVentas`, ADR-008), `server/api/services/dynamodb.ts` (posible función nueva de consulta por rango si `consultarPorIndice` no alcanza para filtrar por fecha — evaluar durante la implementación).

**Qué hacer:**
1. Implementar `handlerListar` en `server/api/handlers/ventas.ts`: verifica el ID Token, exige rol `administrador` exclusivamente (a diferencia de `POST /api/ventas`, que acepta `vendedor` — un reporte de ventas con costos/utilidades es información sensible de negocio, `CLAUDE.md` A01). Acepta query params opcionales: `desde`/`hasta` (rango ISO sobre `vendidoEn`, usa el GSI ya existente en `babel-ventas` — `tech-specs.md` §5.1), `editorial`, `formaDePago` (filtros adicionales en memoria sobre el resultado, dado el volumen esperado — mismo criterio de "aceptable para tablas pequeñas" que `escanearTodo`/`escanearMayorQue`, ver `MEMORY.md` §6).
2. Validar los query params: `desde`/`hasta` (si vienen) deben ser fechas ISO válidas y `desde <= hasta`; `formaDePago` (si viene) debe ser uno de los 5 valores válidos de `FormaDePago` — `400` si no. Todos los filtros son opcionales; sin ninguno, devuelve todas las ventas.
3. Actualizar `serverless.yml` (ADR-008): nueva función Lambda `listarVentas` con rol IAM propio — `Query`/`Scan` de solo lectura sobre `babel-ventas` (+ su GSI de `vendidoEn`) y `GetItem` sobre `babel-usuarios` para resolver el rol del token. Sin acceso de escritura a ninguna tabla. `verificar-token.js` en `package.patterns` desde el primer commit.
4. Cubrir con `npm run test:api`: sin token → `401`; rol `vendedor` → `403`; `desde`/`hasta` inválidos → `400`; `formaDePago` inválida → `400`; caso feliz sin filtros (devuelve todas); caso feliz con filtros (devuelve el subconjunto esperado).

**Definition of done:**
- [ ] `npm run build:api` y `npm run test:api` pasan sin errores (sin regresión en `ventas.spec.ts` existente — `handler` de `POST /api/ventas` sigue íntegro)
- [ ] Tests unitarios cubren 401/403/400 (ambos casos)/200 (con y sin filtros)
- [ ] Verificado manualmente contra `staging` con `curl` + un ID Token real (nueva operación `probar-listar-ventas` en `operaciones-staging.yml`: registra 1-2 ventas de prueba reales, las lista sin filtro y con filtro, limpia todo al terminar)
- [ ] El rol IAM de la función `listarVentas` sigue el principio de mínimo privilegio (`CLAUDE.md` A05, ADR-008) — solo lectura, sin `PutItem`/`UpdateItem`/`DeleteItem`

---

## Tarea 2 — [FEATURE]: `CambiarEstanteComponent` — frontend de consumo de `PATCH /api/libros/:bookId/estante`

**Origen:** `tech-specs.md` §4.2 (ruta `/libros/:bookId/estante`, guard `AuthGuard`) y §5.3 del `PRD.md` — primer consumo desde el frontend del endpoint backend ya cerrado y verificado en vivo (`PATCH /api/libros/:bookId/estante`, `TODO.md` histórico). Mismo patrón backend-luego-frontend ya usado (`RoleGuard`/`CatalogarLibroComponent` tras `POST /api/libros`/`GET /api/estantes`).

**Archivos:** `src/app/core/api/libros.service.ts` (extender con un método `cambiarEstante(bookId, estanteId)`, mismo patrón autenticado que `EstantesService`), `src/app/features/libros/cambiar-estante.component.ts` (nuevo), ruta nueva `/libros/:bookId/estante` en `app.routes.ts` (guardada con `AuthGuard` — no `RoleGuard`, ya que tanto `vendedor` como `administrador` pueden usarla, igual que `/libros`, ver `tech-specs.md` §4.2), enlace desde `ListaLibrosCatalogadosComponent` (o el punto de navegación mínimo necesario, sin rediseñar la lista completa — evaluar durante la implementación si ya existe una lista real de libros catalogados o solo el placeholder actual).

**Qué hacer:**
1. Extender `LibrosService` (o crear un servicio dedicado si `LibrosService` hoy es específico del catálogo público sin autenticación — revisar antes de decidir) con un método autenticado `PATCH /api/libros/:bookId/estante` (`Authorization: Bearer <idToken>`, mismo patrón que `CatalogarLibroComponent`/`EstantesService`).
2. Implementar `CambiarEstanteComponent` (standalone, ruta `/libros/:bookId/estante`, `bookId` desde el route param): muestra los datos actuales del libro (título, autor, estante actual) y un `<select>` de estante poblado por `EstantesService` (ya existente), envía el cambio con el ID Token real, mensaje de éxito/error, redirige o confirma visualmente tras guardar.
3. Agregar el enlace/acción "Cambiar estante" desde el punto de navegación mínimo necesario (revisar el estado real de `ListaLibrosCatalogadosComponent` — hoy puede seguir siendo el placeholder del scaffold, en cuyo caso decidir el alcance mínimo junto con esta tarea, sin construir una lista completa de libros catalogados si esa es una tarea de roadmap separada).
4. Cubrir con `npm test -- --watch=false`: el método nuevo del servicio (éxito/error, mismo patrón que el resto de servicios de `core/api`) y los casos principales del componente (carga el estante actual, envío válido llama al `PATCH`, error se muestra, éxito confirma visualmente).

**Definition of done:**
- [ ] `npm run build` y `npm test -- --watch=false` pasan sin errores
- [ ] Tests unitarios cubren el método nuevo del servicio y los casos principales del componente
- [ ] Verificado manualmente contra `staging`: dado que requiere un login real de Google, decidir con el usuario cómo verificar (combinar evidencia ya verificada en vivo del backend + tests unitarios, o pedir al usuario una verificación manual puntual — mismas dos opciones ya usadas antes en el proyecto)
- [ ] Ningún dato sensible se calcula ni se confía desde el cliente — el componente solo envía `estanteId`, que el backend ya valida (`CLAUDE.md` A08)
