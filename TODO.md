# TODO.md — Babel

Motor JIT: este documento mantiene **siempre exactamente 2 tareas atómicas** activas. Al completar cualquiera, se elimina, se mueve el resumen a `MEMORY.md` §2, y se calcula la siguiente tarea más prioritaria comparando `PRD.md` (roadmap) contra `MEMORY.md` (estado actual).

**Prioridad de selección aplicada:** la tarea de `CatalogoPublicoComponent` se completó (`GET /` con SSR real, `LibrosService`, `PvpPipe`; build/tests en verde — ver `MEMORY.md` §2 y §9 para el bug de SSR/URLs relativas encontrado y corregido, y el root-cause real del flake de Vitest, `isolate: false`). Sube a Tarea 1 `POST /api/libros` (ya estaba en el TODO, sin cambios). Se agrega como Tarea 2 el CRUD de `/api/estantes` (`PRD.md` §6, Media prioridad) — es la pieza de datos más simple y completamente independiente que falta para poder implementar después el flujo de catalogación real (elegir estante al catalogar) y el cambio de estante, sin acoplarse a la tabla `babel-libros` ni a `POST /api/libros`. Ambas tareas son independientes entre sí: una escribe en `babel-libros`, la otra en `babel-estantes`.

---

## Tarea 1 — [FEATURE]: `POST /api/libros` — catalogar un libro (backend, protegido)

**Origen:** `PRD.md` §6 (roadmap, Alta prioridad) — "Flujo de catalogación completo (escaneo → metadatos → precio → estante)", descrito en `CLAUDE.md` §1 como el **caso de uso fundacional** del proyecto (catalogar el inventario inicial de +3.000 libros). Esta tarea cubre únicamente el endpoint de escritura protegido; la resolución automática de metadatos por ISBN (`api.letiende.co`) y el frontend de catalogación quedan para tareas futuras separadas — ver `tech-specs.md` §5 (`POST /api/libros`) y §3 (`server/api/handlers/libros.ts` ya existe para el `GET` público).

**Archivos:** `server/api/handlers/libros.ts` (ampliar con el handler de `POST`, o separar en un archivo nuevo si el archivo actual crece demasiado), `serverless.yml` (nueva función Lambda o ruta adicional sobre la función `libros` existente, con permisos IAM ampliados — ver Qué hacer).

**Qué hacer:**
1. Implementar el handler de `POST /api/libros`: reutiliza `verificarTokenDesdeHeader` (`server/api/lib/verificar-token.ts`, ya existe) para validar el ID Token, y resuelve el rol consultando `babel-usuarios` (mismo patrón que `usuarios-me.ts`) — exige rol `vendedor` **o** `administrador` (ambos pueden catalogar; a diferencia de `RoleGuard`, que exige un rol exacto, aquí basta con estar autorizado en Babel con cualquiera de los dos roles). Nunca confiar en un rol enviado en el body (`CLAUDE.md` A01).
2. Validar el body (`Libro` sin `bookId`/`creadoEn`, que genera el backend): campos requeridos presentes, `pvp` es un número positivo dentro de un rango razonable antes de persistirlo (`CLAUDE.md` A08 — el PVP en esta tarea lo ingresa manualmente el vendedor, ya que la resolución automática por ISBN es una tarea futura). Responder `400` con un mensaje genérico si la validación falla.
3. Actualizar `serverless.yml` (ADR-008): la función que atienda este endpoint necesita `dynamodb:PutItem` sobre `babel-libros` y `dynamodb:GetItem` sobre `babel-usuarios` (para resolver el rol) — revisar si conviene ampliar el rol IAM de la función `libros` existente (que hoy solo tiene `dynamodb:Scan` sobre `babel-libros` para el `GET`) o crear una función nueva; cualquiera de las dos opciones debe seguir el principio de mínimo privilegio real, no un rol amplio "por si acaso". Recordar el límite de 256 caracteres en `description` (`MEMORY.md` §7).
4. Cubrir con tests unitarios: sin token → `401`; token válido pero sin fila en `babel-usuarios` → `403`; `pvp` inválido (negativo, no numérico, fuera de rango) → `400`; caso feliz (rol `vendedor` o `administrador`) → `201` con el libro creado (incluyendo `bookId`/`creadoEn` generados).

**Definition of done:**
- [ ] `npm run build`, `npm run build:api` y `npm test -- --watch=false` pasan sin errores
- [ ] Tests unitarios cubren los 4 casos del handler (401/403/400/201)
- [ ] Verificado manualmente contra `staging` con `curl` + un ID Token real (reutilizar/ampliar `operaciones-staging.yml`): `401` sin token, `403` con un usuario sin fila en `babel-usuarios`, `201` con un usuario `vendedor` sembrado — y una limpieza posterior del libro de prueba creado en `babel-libros-staging`
- [ ] El rol IAM de la función que atiende este endpoint sigue el principio de mínimo privilegio (`CLAUDE.md` A05, ADR-008) — sin acceso a tablas que no necesita

---

## Tarea 2 — [FEATURE]: CRUD `/api/estantes` (administrador)

**Origen:** `PRD.md` §6 (roadmap, Media prioridad) — "Configuración de estantes (CRUD)"; `tech-specs.md` §5 (`GET`/`POST`/`PUT`/`DELETE` `/api/estantes`, todos `Admin`) y §4.2 (`/admin/estantes`, `GestionEstantesComponent`, fuera de alcance de esta tarea — solo backend). `Estante` (`src/app/core/models/estante.model.ts`) es la entidad más simple del dominio (`estanteId`, `espacio`, `mueble`, `ubicacion`, sin cálculos ni relaciones con otras tablas), y es un prerrequisito de datos para el futuro flujo de catalogación (elegir estante) y el futuro cambio de estante — pero implementarlo no depende de que esas tareas existan todavía.

**Archivos:** `server/api/handlers/estantes.ts` (nuevo, los 4 verbos), `serverless.yml` (nueva función Lambda `estantes` con su propio rol IAM, ADR-008).

**Qué hacer:**
1. Implementar los 4 handlers en `server/api/handlers/estantes.ts` (o separarlos si el archivo crece demasiado): `GET /api/estantes` (lista todos), `POST /api/estantes` (crea, genera `estanteId`), `PUT /api/estantes/:estanteId` (actualiza), `DELETE /api/estantes/:estanteId` (elimina). Los 4 exigen rol `administrador` exclusivamente (a diferencia de `POST /api/libros`, aquí NO basta con `vendedor`) — reutilizar el mismo patrón de `verificarTokenDesdeHeader` + consulta a `babel-usuarios`.
2. Usar las funciones genéricas ya existentes en `server/api/services/dynamodb.ts` (`obtenerPorClave`, `guardar`, `eliminar`) — no debería hacer falta ninguna función nueva en ese servicio, ya que `babel-estantes` no necesita `Scan`/`Query` (el `GET` de listado puede usar `escanearMayorQue`-style o una nueva función de "listar todos" si `escanearMayorQue` no aplica sin un atributo numérico — evaluar al implementar).
3. Validar el body en `POST`/`PUT`: los 3 campos de texto (`espacio`, `mueble`, `ubicacion`) son requeridos y no vacíos. Responder `400` con un mensaje genérico si falla.
4. Actualizar `serverless.yml` (ADR-008): nueva función Lambda `estantes` con rol IAM propio — `dynamodb:GetItem`/`PutItem`/`DeleteItem`/`Scan` (o el verbo que aplique según el punto 2) sobre `babel-estantes` únicamente, más `dynamodb:GetItem` sobre `babel-usuarios` (para resolver el rol). Recordar el límite de 256 caracteres en `description`.
5. Cubrir con tests unitarios los 4 handlers: sin token → `401`; token válido pero rol `vendedor` (no `administrador`) → `403`; body inválido en `POST`/`PUT` → `400`; casos felices de cada verbo.

**Definition of done:**
- [ ] `npm run build`, `npm run build:api` y `npm test -- --watch=false` pasan sin errores
- [ ] Tests unitarios cubren los 4 verbos y sus casos de error (401/403/400)
- [ ] Verificado manualmente contra `staging` con `curl` + un ID Token real: `401` sin token, `403` con un usuario `vendedor` (rol insuficiente), ciclo completo `POST` → `GET` (aparece en la lista) → `PUT` → `DELETE` (ya no aparece) con un usuario `administrador` sembrado — sin dejar datos de prueba en `babel-estantes-staging` al terminar
- [ ] El rol IAM de la función `estantes` sigue el principio de mínimo privilegio (`CLAUDE.md` A05, ADR-008) — sin acceso a `babel-libros`/`babel-ventas`/etc.
