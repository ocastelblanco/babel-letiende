# TODO.md — Babel

Motor JIT: este documento mantiene **siempre exactamente 2 tareas atómicas** activas. Al completar cualquiera, se elimina, se mueve el resumen a `MEMORY.md` §2, y se calcula la siguiente tarea más prioritaria comparando `PRD.md` (roadmap) contra `MEMORY.md` (estado actual).

**Prioridad de selección aplicada:** el CRUD de `/api/editoriales-descuentos` se completó y se verificó **en vivo contra `staging`** con un ID Token real: `403` con un correo sin fila en `babel-usuarios-staging` (el script se detiene ahí), y con ese mismo correo sembrado como `administrador`: ciclo completo `GET`(200 `[]`)→`POST`(201)→`PUT`(200)→`GET`(200, `porcentajePorDefecto` actualizado a 40)→`DELETE`(204), sin dejar filas de prueba (ver `MEMORY.md` §2 y §9). Sube a Tarea 1 el cambio de estante de un libro (ya estaba en el TODO como Tarea 2, sin cambios de contenido). Se agrega como Tarea 2 `GET /api/ventas` (`PRD.md` §5.5/§6, roadmap Media; `tech-specs.md` §5 ya lo documenta separado de `GET /api/ventas/exportar`) — primer recorte del reporte de ventas: solo listar/filtrar, sin XLSX ni frontend todavía (mismo patrón atómico backend-primero ya probado). Ambas tareas son independientes entre sí: una opera sobre `babel-libros`/`babel-estantes`, la otra sobre `babel-ventas` exclusivamente (sin escritura).

---

## Tarea 1 — [FEATURE]: `PATCH /api/libros/:bookId/estante` — cambio de estante de un libro catalogado (backend)

**Origen:** `PRD.md` §5.3/§6 (roadmap, Media) — "Cambio de estante de un libro ya catalogado". `tech-specs.md` §5 ya documenta este endpoint, pero con el path `PATCH /api/libros/:isbn/estante` — un error a corregir en esta misma tarea: la clave primaria real de `babel-libros` es `bookId` (§5.1 de `tech-specs.md`, GSI aparte por `isbn`), y `isbn` puede ser `null` (libros sin código de barras, `Libro.isbn: string | null`), así que no sirve como identificador confiable en la ruta — mismo criterio ya usado en `PUT`/`DELETE /api/estantes/:estanteId` y `PUT`/`DELETE /api/usuarios/:email`, que siempre usan la clave primaria real de la tabla. Esta tarea cubre solo el backend (handler + Lambda); la pantalla `CambiarEstanteComponent` (`tech-specs.md` §4.2, ruta `/libros/:isbn/estante` — su path también debe corregirse a `:bookId` cuando se implemente) queda para una tarea futura, mismo patrón ya usado con `POST /api/ventas`/CRUD de estantes/usuarios/editoriales-descuentos (backend primero, verificado en vivo con `curl`, frontend de consumo después).

**Archivos:** `server/api/handlers/libros.ts` (agrega un handler nuevo, `handlerCambiarEstante`, al mismo archivo que ya exporta `handler`/`handlerCrear` — **atención al gotcha crítico de `MEMORY.md` §7**: cualquier `import` nuevo a nivel superior de este archivo afecta el `package.patterns` de las 3 funciones Lambda que lo usan, no solo la nueva), `serverless.yml` (nueva función Lambda `cambiarEstanteLibro`, ADR-008), `tech-specs.md` (corregir `:isbn` → `:bookId` en la tabla de endpoints y en la ruta del frontend §4.2).

**Qué hacer:**
1. Implementar `handlerCambiarEstante` en `server/api/handlers/libros.ts`: verifica el ID Token, exige rol `vendedor` **o** `administrador` (mismo criterio que `POST /api/libros`/`POST /api/ventas` — mover un libro de estante es parte de la operación diaria de venta, no solo de administración). Recibe únicamente `{ estanteId }` en el body.
2. Validar: el `bookId` del path debe existir en `babel-libros` (`obtenerPorClave`) — `404` si no. El `estanteId` recibido debe existir en `babel-estantes` (`obtenerPorClave`, mismo servicio ya usado por `estantes.ts`) — `400` si no (evita guardar una referencia a un estante inexistente; nota: los libros de `sembrar-libros-demo.mjs` ya referenciaban `estante-1`/`estante-2` sin que existiera ninguna validación así — ver `MEMORY.md` §9, corregido de facto al sembrar esos estantes, pero el bug de fondo — nada validaba la referencia — seguía sin corregirse hasta esta tarea). Si ambos existen, actualiza solo `estanteId`/`actualizadoEn` del libro (`guardar`, no reemplaza el resto de campos).
3. Actualizar `serverless.yml` (ADR-008): nueva función Lambda `cambiarEstanteLibro` con rol IAM propio — `GetItem`+`PutItem` sobre `babel-libros`, `GetItem` sobre `babel-estantes` (validar existencia) y `GetItem` sobre `babel-usuarios` (resolver rol del token). Incluir `verificar-token.js` en `package.patterns` desde el primer commit (lección de `MEMORY.md` §7) y revisar que el `package.patterns` de `libros`/`catalogarLibro` (las otras dos funciones que ya comparten `libros.ts`) siga íntegro tras agregar el `import` nuevo, si lo hay.
4. Cubrir con `npm run test:api`: sin token → `401`; rol `vendedor`-o-superior correcto pero `bookId` inexistente → `404`; `estanteId` inexistente → `400`; caso feliz → `200` con el libro actualizado.
5. Corregir `tech-specs.md` §5 (tabla de endpoints) y §4.2 (ruta `/libros/:isbn/estante` → `/libros/:bookId/estante`) para reflejar `:bookId` en vez de `:isbn`.

**Definition of done:**
- [ ] `npm run build:api` y `npm run test:api` pasan sin errores (sin regresión en `libros.spec.ts` existente — `handler`/`handlerCrear` siguen íntegros)
- [ ] Tests unitarios cubren 401/404 (bookId)/400 (estanteId)/200
- [ ] Verificado manualmente contra `staging` con `curl` + un ID Token real (nueva operación `probar-cambiar-estante` en `operaciones-staging.yml`: cataloga un libro y siembra un estante de prueba, cambia el estante del libro, confirma el cambio con `GET /api/libros`, limpia todo al terminar)
- [ ] `tech-specs.md` corregido (`:isbn` → `:bookId` en ambos lugares)
- [ ] El rol IAM de la función `cambiarEstanteLibro` sigue el principio de mínimo privilegio (`CLAUDE.md` A05, ADR-008)

---

## Tarea 2 — [FEATURE]: `GET /api/ventas` (administrador) — listar/filtrar ventas para reportes (backend)

**Origen:** `PRD.md` §5.5/§6 (roadmap, Media) — "Reportes de ventas (solo administrador)". `tech-specs.md` §5 documenta `GET /api/ventas` (listar/filtrar) separado de `GET /api/ventas/exportar` (generación del XLSX) — esta tarea cubre solo el primero: la consulta base que necesitará el exportador y, más adelante, el frontend de reportes (`ReportesVentasComponent`, fuera de alcance). Mismo patrón atómico backend-primero ya usado en cada endpoint anterior del proyecto.

**Archivos:** `server/api/handlers/ventas.ts` (agrega un handler nuevo, `handlerListar`, al mismo archivo que ya exporta `handler` de `POST /api/ventas` — mismo cuidado con `package.patterns` que en la Tarea 1, ver `MEMORY.md` §7), `serverless.yml` (nueva función Lambda `listarVentas`, ADR-008), `server/api/services/dynamodb.ts` (posible función nueva de consulta por rango si `consultarPorIndice` no alcanza para filtrar por fecha — evaluar durante la implementación).

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
