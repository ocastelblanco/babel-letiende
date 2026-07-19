# TODO.md — Babel

Motor JIT: este documento mantiene **siempre exactamente 2 tareas atómicas** activas. Al completar cualquiera, se elimina, se mueve el resumen a `MEMORY.md` §2, y se calcula la siguiente tarea más prioritaria comparando `PRD.md` (roadmap) contra `MEMORY.md` (estado actual).

**Prioridad de selección aplicada:** la tarea de `RoleGuard` en el frontend se completó (3 tests unitarios cubriendo sin sesión/rol incorrecto/rol correcto; `npm run build` y `npm test -- --watch=false` en verde — ver `MEMORY.md` §2 y §9 para la decisión sobre cómo se satisfizo la verificación "en vivo" sin cablear todavía una ruta real de administración). Sube a Tarea 1 el `CatalogoPublicoComponent` (ya estaba en el TODO, sin cambios). Se agrega como Tarea 2 `POST /api/libros`, el primer endpoint de escritura del flujo de catalogación (`PRD.md` §6, Alta prioridad, caso de uso fundacional descrito en `CLAUDE.md` §1) — deliberadamente acotado al endpoint protegido en sí (sin resolución automática de metadatos por ISBN todavía, eso es una tarea futura separada). Ambas tareas son independientes entre sí: una es una vista pública de solo lectura, la otra es un endpoint de escritura protegido sin frontend asociado todavía.

---

## Tarea 1 — [FEATURE]: `CatalogoPublicoComponent` — catálogo público (SSR)

**Origen:** `PRD.md` §6 (roadmap, Alta prioridad) — "Catálogo público de consulta (SSR, sin autenticación)"; `tech-specs.md` §4.2 (ruta `/`, componente `CatalogoPublicoComponent`, pública) y §4.5 (SEO/SSR). El backend (`GET /api/libros`) ya existe y está verificado en `staging` — esta es la primera pieza de frontend que lo consume de verdad.

**Archivos:** `src/app/features/catalogo-publico/catalogo-publico.component.ts` (nuevo), `src/app/core/api/libros.service.ts` (nuevo, cliente HTTP hacia `/api/libros`), `src/app/app.routes.ts` (reemplazar el redirect placeholder de `''`→`/libros` por la ruta real — ver comentario existente en el archivo).

**Qué hacer:**
1. Implementar `src/app/core/api/libros.service.ts`: llama `GET /api/libros` (sin autenticación) y expone la lista de `Libro` como Signal.
2. Implementar `CatalogoPublicoComponent`: lista los libros disponibles (título, autor, portada, PVP en formato colombiano `$45.000` — `CLAUDE.md` §4) usando Tailwind y la paleta de marca. Sin filtros de texto/autor/tema todavía (`tech-specs.md` §5, fuera de alcance).
3. Registrar la ruta `/` apuntando a este componente en `app.routes.ts`, sin ningún guard (es pública) — reemplaza el redirect temporal a `/libros`.
4. Revisar el modo de renderizado en `app.routes.server.ts` para esta ruta: **cuidado con el bug ya documentado de `RenderMode.Prerender`** (`MEMORY.md` §7, CRÍTICO) — esta ruta es pública pero sus datos son dinámicos (cambian cuando se catalogan libros), así que `RenderMode.Server` es más apropiado que `Prerender` a pesar de no tener ningún guard.

**Definition of done:**
- [ ] `npm run build` y `npm test -- --watch=false` pasan sin errores
- [ ] Verificado con un deploy real a `staging`: `GET /` responde `200` y muestra la lista (aunque esté vacía, ya que `babel-libros-staging` no tiene datos todavía)
- [ ] La ruta `/` no requiere ningún guard ni sesión iniciada

---

## Tarea 2 — [FEATURE]: `POST /api/libros` — catalogar un libro (backend, protegido)

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
