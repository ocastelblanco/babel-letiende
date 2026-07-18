# TODO.md — Babel

Motor JIT: este documento mantiene **siempre exactamente 2 tareas atómicas** activas. Al completar cualquiera, se elimina, se mueve el resumen a `MEMORY.md` §2, y se calcula la siguiente tarea más prioritaria comparando `PRD.md` (roadmap) contra `MEMORY.md` (estado actual).

**Prioridad de selección aplicada:** la tarea de "Verificación real del ID Token de Firebase + `GET /api/usuarios/me`" se completó y se verificó **en vivo contra `staging`** con un ID Token real (401 sin header, 403 con correo sin fila en `babel-usuarios`, 200 con el rol correcto — ver `MEMORY.md` §2 y §9, PR pendiente de fusión). En el camino se encontró y corrigió un bug real que rompía el arranque de la Lambda en producción (`jose@6` ESM puro vs. `require()` de `jwks-rsa`, ver `MEMORY.md` §7) y se cerró un problema de permisos IAM de la cuenta de servicio de Firebase. Se mantiene sin cambios la tarea de "Endpoint público `GET /api/libros`" (ahora Tarea 1), y se agrega como Tarea 2 el punto que la propia tarea recién completada dejó explícitamente pendiente: `RoleGuard` en el frontend, prerrequisito de cualquier ruta de administración del roadmap (`PRD.md` §6). Ambas son independientes entre sí.

---

## Tarea 1 — [FEATURE]: Endpoint público `GET /api/libros` — catálogo de consulta

**Origen:** `PRD.md` §6 (roadmap, Alta prioridad) — "Catálogo público de consulta (SSR, sin autenticación)"; `tech-specs.md` §5 (tabla de endpoints: `GET /api/libros`, marcado "Pública") y §4.3 (interfaz `Libro`, ya modelada en `src/app/core/models/libro.model.ts`). Es la primera pieza que realmente ejercita `server/api/services/dynamodb.ts` contra datos reales.

**Archivos:** `server/api/handlers/libros.ts` (nuevo), `serverless.yml` (nueva función Lambda o ruta `GET /api/libros`, y su propio `package.patterns`/rol IAM de mínimo privilegio — ver el patrón ya usado por la función `usuariosMe`).

**Qué hacer:**
1. Implementar `GET /api/libros` usando las funciones genéricas de `server/api/services/dynamodb.ts` contra `TABLA_LIBROS` (variable de entorno ya declarada en `serverless.yml`, nunca hardcodeada). Para este alcance inicial, un `ScanCommand` simple filtrando `cantidadDisponible > 0` es aceptable — los filtros por texto/autor/tema de `tech-specs.md` §5 quedan para una tarea posterior — y debe devolver un array de `Libro`.
2. Sin autenticación: es un endpoint público (`tech-specs.md` §5) — no debe importar ni llamar nada relacionado con verificación de token.
3. Registrar la función/ruta en `serverless.yml`. Seguir el patrón de la función `usuariosMe` (PR de la tarea anterior): función propia con rol IAM acotado (`dynamodb:Scan` solo sobre `TablaLibros.Arn`, no reutilizar `ApiLambdaRole` completo) y `package.patterns` incluyendo `node_modules/**` si se usa `@aws-sdk/*` (ya se usa). **Cuidado:** el campo `description` de cualquier función Lambda nueva no puede superar 256 caracteres (bug real encontrado en la tarea anterior, ver `MEMORY.md` §7) — verificar antes de desplegar.
4. No implementar todavía el consumo desde el frontend (`CatalogoPublicoComponent`) — el alcance de esta tarea es exclusivamente el endpoint del backend.

**Definition of done:**
- [ ] `npm run build:api` compila sin errores con el nuevo handler
- [ ] Al desplegarse a `staging` (vía PR, deploy automático de CI), `GET /api/libros` responde `200` con un array JSON (vacío si la tabla no tiene datos todavía) — verificar con `curl` real contra la URL de `staging`, no solo localmente
- [ ] El endpoint no exige ningún header de autenticación
- [ ] Ningún nombre de tabla queda hardcodeado — se resuelve siempre desde `TABLA_LIBROS`

---

## Tarea 2 — [FEATURE]: `RoleGuard` en el frontend usando `GET /api/usuarios/me`

**Origen:** `CLAUDE.md` A01/A07 y `tech-specs.md` §8 — la tarea de verificación de ID Token (recién completada, `GET /api/usuarios/me` ya desplegado y verificado en `staging`) dejó explícitamente pendiente el `RoleGuard` del frontend. Sin él, ninguna ruta de administrador del roadmap (`tech-specs.md` §4.2: `/admin/reportes`, `/admin/usuarios`, `/admin/editoriales`, `/admin/estantes`) tiene forma de bloquear a un vendedor autenticado pero sin rol de administrador — solo existe `AuthGuard` (autenticación, no autorización).

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
