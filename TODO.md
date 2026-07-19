# TODO.md — Babel

Motor JIT: este documento mantiene **siempre exactamente 2 tareas atómicas** activas. Al completar cualquiera, se elimina, se mueve el resumen a `MEMORY.md` §2, y se calcula la siguiente tarea más prioritaria comparando `PRD.md` (roadmap) contra `MEMORY.md` (estado actual).

**Prioridad de selección aplicada:** `POST /api/libros` se completó y se verificó **en vivo contra `staging`** con `curl` + un ID Token real (`401` sin token, `403` con un correo sin fila en `babel-usuarios`, `201` con un usuario `vendedor` sembrado, libro y usuarios de prueba limpiados al terminar — ver `MEMORY.md` §2 y §9). Sube a Tarea 1 el CRUD de `/api/estantes` (ya estaba en el TODO, sin cambios). Se agrega como Tarea 2 `POST /api/ventas` (`PRD.md` §6, Alta prioridad) — ahora que `POST /api/libros` existe, hay una forma real de tener libros que vender en `staging`. Ambas tareas son independientes entre sí: una escribe en `babel-estantes`, la otra en `babel-ventas` (leyendo `babel-libros` solo para el snapshot de costo/PVP, sin escribirlo).

---

## Tarea 1 — [FEATURE]: CRUD `/api/estantes` (administrador)

**Origen:** `PRD.md` §6 (roadmap, Media prioridad) — "Configuración de estantes (CRUD)"; `tech-specs.md` §5 (`GET`/`POST`/`PUT`/`DELETE` `/api/estantes`, todos `Admin`) y §4.2 (`/admin/estantes`, `GestionEstantesComponent`, fuera de alcance de esta tarea — solo backend). `Estante` (`src/app/core/models/estante.model.ts`) es la entidad más simple del dominio (`estanteId`, `espacio`, `mueble`, `ubicacion`, sin cálculos ni relaciones con otras tablas), y es un prerrequisito de datos para el futuro flujo de catalogación (elegir estante) y el futuro cambio de estante — pero implementarlo no depende de que esas tareas existan todavía.

**Archivos:** `server/api/handlers/estantes.ts` (nuevo, los 4 verbos), `serverless.yml` (nueva función Lambda `estantes` con su propio rol IAM, ADR-008).

**Qué hacer:**
1. Implementar los 4 handlers en `server/api/handlers/estantes.ts` (o separarlos si el archivo crece demasiado): `GET /api/estantes` (lista todos), `POST /api/estantes` (crea, genera `estanteId`), `PUT /api/estantes/:estanteId` (actualiza), `DELETE /api/estantes/:estanteId` (elimina). Los 4 exigen rol `administrador` exclusivamente (a diferencia de `POST /api/libros`, aquí NO basta con `vendedor`) — reutilizar el mismo patrón de `verificarTokenDesdeHeader` + consulta a `babel-usuarios` (ya usado en `libros.ts`/`usuarios-me.ts`).
2. Usar las funciones genéricas ya existentes en `server/api/services/dynamodb.ts` (`obtenerPorClave`, `guardar`, `eliminar`) — no debería hacer falta ninguna función nueva en ese servicio, ya que `babel-estantes` no necesita `Scan`/`Query` (el `GET` de listado puede usar una nueva función `escanearTodo<T>` genérica, o evaluar si conviene ampliar `escanearMayorQue` con un parámetro opcional — decidir al implementar).
3. Validar el body en `POST`/`PUT`: los 3 campos de texto (`espacio`, `mueble`, `ubicacion`) son requeridos y no vacíos. Responder `400` con un mensaje genérico si falla. Seguir el patrón de `validarDatosNuevoLibro` en `libros.ts` (función pura exportada, testeable sin invocar el handler completo).
4. Actualizar `serverless.yml` (ADR-008): nueva función Lambda `estantes` con rol IAM propio — `dynamodb:GetItem`/`PutItem`/`DeleteItem`/`Scan` (según lo que use el punto 2) sobre `babel-estantes` únicamente, más `dynamodb:GetItem` sobre `babel-usuarios` (para resolver el rol). Recordar el límite de 256 caracteres en `description`.
5. Cubrir con `npm run test:api` (Vitest, ver `vitest.config.ts`) los 4 handlers: sin token → `401`; token válido pero rol `vendedor` (no `administrador`) → `403`; body inválido en `POST`/`PUT` → `400`; casos felices de cada verbo.

**Definition of done:**
- [ ] `npm run build`, `npm run build:api`, `npm test -- --watch=false` y `npm run test:api` pasan sin errores
- [ ] Tests unitarios cubren los 4 verbos y sus casos de error (401/403/400)
- [ ] Verificado manualmente contra `staging` con `curl` + un ID Token real (ampliar `operaciones-staging.yml` con una operación `probar-estantes` siguiendo el patrón de `probar-catalogar-libro`): `401` sin token, `403` con un usuario `vendedor` (rol insuficiente), ciclo completo `POST` → `GET` (aparece en la lista) → `PUT` → `DELETE` (ya no aparece) con un usuario `administrador` sembrado — sin dejar datos de prueba en `babel-estantes-staging` al terminar
- [ ] El rol IAM de la función `estantes` sigue el principio de mínimo privilegio (`CLAUDE.md` A05, ADR-008) — sin acceso a `babel-libros`/`babel-ventas`/etc.

---

## Tarea 2 — [FEATURE]: `POST /api/ventas` — registrar una venta (backend, protegido)

**Origen:** `PRD.md` §6 (roadmap, Alta prioridad) — "Registro de venta"; `tech-specs.md` §5 (`POST /api/ventas`, "Vendedor/Admin") y §4.3 (modelo `Venta`, con snapshot de costo/utilidad — `MEMORY.md` ADR-006/ADR-003). Solo cubre el endpoint de escritura; `GET /api/ventas` (listado/filtros para reportes) y `GET /api/ventas/exportar` (XLSX) quedan para tareas futuras, ya que dependen de que existan ventas reales primero.

**Archivos:** `server/api/handlers/ventas.ts` (nuevo), `server/api/services/dynamodb.ts` (posible función nueva para actualización condicional — ver Qué hacer punto 2), `serverless.yml` (nueva función Lambda `registrarVenta` con su propio rol IAM, ADR-008).

**Qué hacer:**
1. Implementar `POST /api/ventas`: exige rol `vendedor` o `administrador` (mismo patrón que `POST /api/libros`). Recibe `{ bookId, formaDePago, porcentajeDescuentoVenta }` — nunca recibe `pvp`/`costoLibro` del cliente (`CLAUDE.md` A08): ambos se leen del `Libro` real en `babel-libros` (`obtenerPorClave` con `bookId`) en el momento de la venta.
2. Antes de guardar la venta, decrementar `Libro.cantidadDisponible` en `babel-libros` de forma **condicional** (evitar sobrevender si dos ventas del mismo libro llegan casi al mismo tiempo): `UpdateCommand` con `ConditionExpression: 'cantidadDisponible > :cero'`. Si la condición falla (ya no queda disponible) o el `bookId` no existe, responder `400`/`404` según corresponda — no crear la venta. Esto probablemente requiere una función nueva en `dynamodb.ts` (p. ej. `actualizarConCondicion` o `decrementarSiPositivo`), genérica por nombre de tabla/atributo, igual que las funciones existentes.
3. Calcular y guardar el snapshot (`pvp`, `costoLibro`, `precioFinal = pvp * (1 - porcentajeDescuentoVenta / 100)`, `utilidad = precioFinal - costoLibro`), `ventaId` (UUID), `vendidoPor` (email del token, nunca del body), `vendidoEn` (ISO). Validar `porcentajeDescuentoVenta` (0-100) y `formaDePago` (uno de los 5 valores del tipo `FormaDePago`) antes de procesar — `400` si no son válidos.
4. Actualizar `serverless.yml` (ADR-008): nueva función Lambda `registrarVenta` con rol IAM propio — `dynamodb:PutItem` sobre `babel-ventas`, `dynamodb:UpdateItem`+`GetItem` sobre `babel-libros`, `dynamodb:GetItem` sobre `babel-usuarios`. Recordar el límite de 256 caracteres en `description`.
5. Cubrir con `npm run test:api` los casos: sin token → `401`; rol no autorizado → `403`; `bookId` inexistente → `404`; `cantidadDisponible` en 0 → `400`; `formaDePago`/`porcentajeDescuentoVenta` inválidos → `400`; caso feliz → `201` con el snapshot correcto y `cantidadDisponible` decrementado.

**Definition of done:**
- [ ] `npm run build`, `npm run build:api`, `npm test -- --watch=false` y `npm run test:api` pasan sin errores
- [ ] Tests unitarios cubren los casos del handler (401/403/404/400×2/201) y la actualización condicional de `cantidadDisponible`
- [ ] Verificado manualmente contra `staging` con `curl` + un ID Token real: se cataloga un libro de prueba real con `POST /api/libros` (ya verificado, reutilizar el mecanismo), se vende con `POST /api/ventas` (`201`, `cantidadDisponible` bajó en 1), y se limpian ambos (`babel-ventas-staging` y `babel-libros-staging`) al terminar
- [ ] El rol IAM de la función `registrarVenta` sigue el principio de mínimo privilegio (`CLAUDE.md` A05, ADR-008)
