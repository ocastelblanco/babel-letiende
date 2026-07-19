# TODO.md — Babel

Motor JIT: este documento mantiene **siempre exactamente 2 tareas atómicas** activas. Al completar cualquiera, se elimina, se mueve el resumen a `MEMORY.md` §2, y se calcula la siguiente tarea más prioritaria comparando `PRD.md` (roadmap) contra `MEMORY.md` (estado actual).

**Prioridad de selección aplicada:** el CRUD de `/api/estantes` se completó y se verificó **en vivo contra `staging`** con `curl` + un ID Token real (`401` sin token, `403` con un usuario `vendedor`, ciclo completo `GET`(200)→`POST`(201)→`PUT`(200)→`GET`(200, aparece actualizado)→`DELETE`(204) con un usuario `administrador` sembrado, todos los datos de prueba limpiados — ver `MEMORY.md` §2 y §9). Sube a Tarea 1 `POST /api/ventas` (ya estaba en el TODO, sin cambios). Se agrega como Tarea 2 el CRUD de `/api/usuarios` (`PRD.md` §6, tech-specs.md §5) — cierra un gap de seguridad/operación real: hoy la única forma de dar de alta o quitar un `vendedor`/`administrador` en `babel-usuarios` es la operación interna `sembrar-usuario-prueba`/`eliminar-usuario-prueba` de `operaciones-staging.yml`, pensada para pruebas, no un feature real del producto. Ambas tareas son independientes entre sí: una escribe en `babel-ventas` (leyendo `babel-libros` solo para el snapshot), la otra en `babel-usuarios`.

---

## Tarea 1 — [FEATURE]: `POST /api/ventas` — registrar una venta (backend, protegido)

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

---

## Tarea 2 — [FEATURE]: CRUD `/api/usuarios` (administrador)

**Origen:** `PRD.md` §6 (roadmap) y `tech-specs.md` §5 (`GET`/`POST`/`PUT`/`DELETE` `/api/usuarios`, "Admin") y §4.2 (`/admin/usuarios`, `GestionUsuariosComponent`, fuera de alcance de esta tarea — solo backend). Cierra un gap real: hoy la única forma de dar de alta/baja un `vendedor`/`administrador` en `babel-usuarios` es la operación interna `sembrar-usuario-prueba`/`eliminar-usuario-prueba` de `operaciones-staging.yml` (pensada para pruebas de CI, no para uso real del administrador de Le Tiende).

**Archivos:** `server/api/handlers/usuarios.ts` (nuevo — el `GET /api/usuarios/me` actual vive en `usuarios-me.ts`, un archivo distinto; no confundir ni fusionar), `serverless.yml` (nueva función Lambda `usuarios` con su propio rol IAM, ADR-008).

**Qué hacer:**
1. Implementar los 4 handlers: `GET /api/usuarios` (lista todos), `POST /api/usuarios` (crea, recibe `{ email, nombre, rol }` — `email` es la clave primaria, no se genera), `PUT /api/usuarios/:email` (actualiza `nombre`/`rol`), `DELETE /api/usuarios/:email` (elimina). Los 4 exigen rol `administrador` exclusivamente — mismo patrón que `estantes.ts` (`verificarTokenDesdeHeader` + consulta a `babel-usuarios`, con `escanearTodo`/`obtenerPorClave`/`guardar`/`eliminar` ya existentes en `dynamodb.ts`).
2. Validar el body: `email` con formato válido, `nombre` no vacío, `rol` uno de `'vendedor' | 'administrador'`. `POST` sobre un `email` que ya existe: decidir si sobrescribe (comportamiento actual de `guardar`/`PutCommand`) o responde `409` — evaluar al implementar, documentar la decisión.
3. **Caso límite de seguridad a decidir explícitamente (no dejarlo implícito):** ¿qué pasa si un administrador se degrada a `vendedor` o se elimina a sí mismo vía `PUT`/`DELETE`? Ninguna corrección impide dejar la tabla sin ningún `administrador` (bloqueo total del panel admin). Decidir si se bloquea esa operación sobre el propio email del token (`403` o `400` explicativo) o si se acepta el riesgo y se documenta como responsabilidad operativa — no implementar sin decidir esto primero.
4. Actualizar `serverless.yml` (ADR-008): nueva función Lambda `usuarios` con rol IAM propio — `dynamodb:GetItem`/`PutItem`/`DeleteItem`/`Scan` sobre `babel-usuarios` únicamente (ya es la misma tabla que usa para resolver el rol del token, no hace falta permiso adicional a otra tabla). Recordar el límite de 256 caracteres en `description`.
5. Cubrir con `npm run test:api` los 4 verbos: sin token → `401`; rol `vendedor` → `403`; body inválido → `400`; caso feliz de cada verbo; el caso límite del punto 3.

**Definition of done:**
- [ ] `npm run build`, `npm run build:api`, `npm test -- --watch=false` y `npm run test:api` pasan sin errores
- [ ] Tests unitarios cubren los 4 verbos, sus casos de error (401/403/400) y el caso límite de auto-degradación/auto-eliminación del punto 3
- [ ] Verificado manualmente contra `staging` con `curl` + un ID Token real (nueva operación `probar-usuarios-crud` en `operaciones-staging.yml`, mismo patrón que `probar-estantes`): `401` sin token, `403` con un usuario `vendedor`, ciclo `POST`→`GET`→`PUT`→`DELETE` con un `administrador` sembrado — sin dejar filas de prueba adicionales en `babel-usuarios-staging` al terminar (más allá del propio usuario administrador de prueba, que se limpia con `eliminar-usuario-prueba` como siempre)
- [ ] El rol IAM de la función `usuarios` sigue el principio de mínimo privilegio (`CLAUDE.md` A05, ADR-008)
