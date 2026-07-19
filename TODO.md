# TODO.md — Babel

Motor JIT: este documento mantiene **siempre exactamente 2 tareas atómicas** activas. Al completar cualquiera, se elimina, se mueve el resumen a `MEMORY.md` §2, y se calcula la siguiente tarea más prioritaria comparando `PRD.md` (roadmap) contra `MEMORY.md` (estado actual).

**Prioridad de selección aplicada:** la tarea de "Endpoint público `GET /api/libros`" se completó y se verificó **en vivo contra `staging`** con `curl` real (`200` con `[]`, sin ningún header de autenticación; regresión confirmada en `/api/health` y `/api/usuarios/me` — ver `MEMORY.md` §2 y §9). Se mantiene sin cambios la tarea de `RoleGuard` en el frontend (ahora Tarea 1), y se agrega como Tarea 2 el primer consumidor real de `GET /api/libros`: el catálogo público (`PRD.md` §6, Alta prioridad), que además destraba SEO/SSR (`tech-specs.md` §4.5). Ambas son independientes entre sí — una es de autorización interna, la otra es una vista pública sin autenticación.

---

## Tarea 1 — [FEATURE]: `RoleGuard` en el frontend usando `GET /api/usuarios/me`

**Origen:** `CLAUDE.md` A01/A07 y `tech-specs.md` §8 — la tarea de verificación de ID Token (`GET /api/usuarios/me`, ya desplegado y verificado en `staging`) dejó explícitamente pendiente el `RoleGuard` del frontend. Sin él, ninguna ruta de administrador del roadmap (`tech-specs.md` §4.2: `/admin/reportes`, `/admin/usuarios`, `/admin/editoriales`, `/admin/estantes`) tiene forma de bloquear a un vendedor autenticado pero sin rol de administrador — solo existe `AuthGuard` (autenticación, no autorización).

**Archivos:** `src/app/core/auth/role.guard.ts` (nuevo), `src/app/core/api/usuarios.service.ts` (nuevo, cliente hacia `/api/usuarios/me`), posible ampliación de `src/app/core/auth/auth.service.ts` para exponer el rol resuelto como Signal.

**Qué hacer:**
1. Implementar `src/app/core/api/usuarios.service.ts`: llama `GET /api/usuarios/me` con `Authorization: Bearer <idToken>` (el token lo obtiene del usuario actual de `AuthService`/Firebase), expone el `Usuario` resuelto (o `null`) como Signal de solo lectura. Debe manejar explícitamente `401`/`403` sin lanzar una excepción no controlada (resolver a `null`).
2. Implementar `RoleGuard` (`CanActivateFn`, recibe el rol requerido, ej. `'administrador'`) que consulte el Signal del punto 1 y bloquee/redirija (ej. a `/libros` o a una pantalla de "sin acceso") si el rol no coincide o el usuario no está autorizado en Babel. Debe funcionar igual de estricto que `AuthGuard`: nunca asumir autorización por defecto mientras la respuesta de `/api/usuarios/me` no haya llegado.
3. No agregar todavía ninguna ruta real de administración en `app.routes.ts` — el guard debe quedar listo para usarse en una tarea futura (evita depender de features que no existen aún, como `ReportesVentasComponent`).
4. Cubrir con tests unitarios (mocks del servicio HTTP) los 3 casos: sin sesión, con sesión pero rol incorrecto/403, con sesión y rol correcto.

**Definition of done:**
- [ ] `npm run build` y `npm test -- --watch=false` pasan sin errores
- [ ] Tests unitarios cubren los 3 casos del guard
- [ ] Verificado manualmente contra `staging` con un usuario de prueba sembrado vía `operaciones-staging.yml` (rol `vendedor` bloqueado por un `RoleGuard('administrador')` de prueba, y permitido con rol `administrador`)
- [ ] Ninguna ruta real de administración quedó expuesta sin `RoleGuard` (no aplica todavía, ya que no se crean rutas nuevas en esta tarea)

---

## Tarea 2 — [FEATURE]: `CatalogoPublicoComponent` — catálogo público (SSR)

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
