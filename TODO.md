# TODO.md — Babel

Motor JIT: este documento mantiene **siempre exactamente 2 tareas atómicas** activas. Al completar cualquiera, se elimina, se mueve el resumen a `MEMORY.md` §2, y se calcula la siguiente tarea más prioritaria comparando `PRD.md` (roadmap) contra `MEMORY.md` (estado actual).

**Prioridad de selección aplicada:** la tarea de "Modelos de datos compartidos + cliente DynamoDB base" se completó (rama `feature/modelos-datos-dynamodb-client`) — build de frontend y backend limpios, 8 tests unitarios en verde (ver `MEMORY.md` §2 y §9). **Aviso:** la verificación en vivo contra una tabla real de `staging` (`guardar`/`obtenerPorClave`) no pudo confirmarse desde el entorno donde se implementó por credenciales AWS inválidas ahí (`UnrecognizedClientException`); nada quedó escrito en la tabla porque el `guardar()` de prueba falló antes de completarse. El cliente genérico no se usa todavía desde ningún endpoint real, así que tampoco lo ejercita el deploy automático a `staging` de CI — queda como riesgo abierto hasta que la Tarea 2 de abajo (primer endpoint que sí lo invoca) se despliegue y se verifique con datos reales. Se mantiene sin cambios la tarea de seguridad de verificación de ID Token (ahora Tarea 1), y se agrega como Tarea 2 el primer endpoint que realmente ejercita el cliente de DynamoDB: el catálogo público de consulta (`PRD.md` §6, Alta prioridad), que además no requiere autenticación y por lo tanto no depende de que la Tarea 1 esté lista.

---

## Tarea 1 — [FEATURE]: Verificación real del ID Token de Firebase en el backend + resolución de rol

**Origen:** `CLAUDE.md` A01/A07 y `tech-specs.md` §8 (prioridad Alta, seguridad) — hoy `AuthGuard`/`NoAuthGuard` son 100% cliente (PR #5, PR #6); ninguna Lambda verifica todavía el ID Token ni resuelve el rol contra `babel-usuarios`. Sin esto, cualquier ruta de negocio que se agregue después (catalogación, ventas, admin) no tendría ninguna autorización real del lado servidor — solo la experiencia de usuario del guard, que `CLAUDE.md` A01 prohíbe explícitamente usar como control de acceso real.

**Archivos:** `server/api/lib/verificar-token.ts` (nuevo), `server/api/handlers/usuarios-me.ts` (nuevo, `GET /api/usuarios/me`), `serverless.yml` (nueva ruta + variable de entorno `FIREBASE_SERVICE_ACCOUNT_BABEL` ya declarada, ahora sí consumida).

**Qué hacer:**
1. Instalar `firebase-admin` como dependencia del backend.
2. Implementar `server/api/lib/verificar-token.ts`: función que recibe el header `Authorization: Bearer <token>`, inicializa `firebase-admin` con `projectId: 'comandante-letiende'` (ver `MEMORY.md` ADR-007 y `tech-specs.md` §8.1 — nunca otro `projectId`) y la cuenta de servicio de `FIREBASE_SERVICE_ACCOUNT_BABEL`, y llama `verifyIdToken`. Debe rechazar (lanzar/retornar error tipado) si el header falta, el token es inválido o expiró — nunca asumir un token válido.
3. Implementar `server/api/handlers/usuarios-me.ts`: `GET /api/usuarios/me` — verifica el token con lo del punto 2, busca el email verificado en `babel-usuarios` (puede usar ya `server/api/services/dynamodb.ts` — `obtenerPorClave(process.env.TABLA_USUARIOS, { email })`, completado en la tarea anterior), y responde `403` si el correo no existe en la tabla (`CLAUDE.md` A01/A07: estar autenticado en el proyecto Firebase compartido no implica autorización en Babel). Si existe, responde el `Usuario` (`src/app/core/models/usuario.model.ts`) con su `rol`.
4. Registrar la ruta en `serverless.yml` bajo la función `api` (ya tiene permisos de lectura sobre `babel-usuarios`; confirmar que el nombre de tabla se resuelve por variable de entorno, nunca hardcodeado) y actualizar `package.patterns` para incluir el handler compilado y los `node_modules` de `firebase-admin`/`@aws-sdk/*` que ahora sí se usan en runtime.
5. No implementar todavía `RoleGuard` en el frontend (depende de que el cliente consuma este endpoint, puede ser una tarea posterior) — el alcance es exclusivamente la verificación y resolución de rol en el backend.

**Definition of done:**
- [ ] `npm run build:api` compila sin errores con `firebase-admin` instalado
- [ ] `GET /api/usuarios/me` sin header `Authorization` responde `401` (o equivalente), nunca `200`
- [ ] `GET /api/usuarios/me` con un ID Token real pero de un correo que NO existe en `babel-usuarios` responde `403`
- [ ] `GET /api/usuarios/me` con un ID Token real de un correo que SÍ existe en `babel-usuarios` (crear un registro de prueba en `staging` y limpiarlo después) responde `200` con el `rol` correcto
- [ ] Ningún secreto (`FIREBASE_SERVICE_ACCOUNT_BABEL`) queda hardcodeado — se lee siempre de la variable de entorno ya declarada en `serverless.yml`

---

## Tarea 2 — [FEATURE]: Endpoint público `GET /api/libros` — catálogo de consulta

**Origen:** `PRD.md` §6 (roadmap, Alta prioridad) — "Catálogo público de consulta (SSR, sin autenticación)"; `tech-specs.md` §5 (tabla de endpoints: `GET /api/libros`, marcado "Pública") y §4.3 (interfaz `Libro`, ya modelada en `src/app/core/models/libro.model.ts`). Es la primera pieza que realmente ejercita `server/api/services/dynamodb.ts` (recién completado) contra datos reales, lo que además cierra el riesgo abierto que dejó esa tarea (ver nota de prioridad arriba).

**Archivos:** `server/api/handlers/libros.ts` (nuevo), `serverless.yml` (nueva ruta `GET /api/libros` bajo la función `api`, y actualización de `package.patterns` de esa función para incluir el handler compilado y los módulos `@aws-sdk/*` — hoy la función `api` no empaqueta ningún `node_modules`, solo `dist-server/api/handlers/health.js`).

**Qué hacer:**
1. Implementar `GET /api/libros` usando las funciones genéricas de `server/api/services/dynamodb.ts` contra `TABLA_LIBROS` (variable de entorno ya declarada en `serverless.yml`, nunca hardcodeada). Para este alcance inicial, un `ScanCommand` simple filtrando `cantidadDisponible > 0` es aceptable — los filtros por texto/autor/tema de `tech-specs.md` §5 quedan para una tarea posterior — y debe devolver un array de `Libro`.
2. Sin autenticación: es un endpoint público (`tech-specs.md` §5) — no debe importar ni llamar nada relacionado con verificación de token.
3. Registrar la ruta en `serverless.yml` bajo la función `api` existente y actualizar `package.patterns` para incluir `dist-server/api/handlers/libros.js` y los `node_modules` de `@aws-sdk/client-dynamodb`/`@aws-sdk/lib-dynamodb`. El rol IAM `ApiLambdaRole` ya incluye `dynamodb:Scan` sobre `TablaLibros.Arn` — no requiere cambios de permisos.
4. No implementar todavía el consumo desde el frontend (`CatalogoPublicoComponent`) — el alcance de esta tarea es exclusivamente el endpoint del backend.

**Definition of done:**
- [ ] `npm run build:api` compila sin errores con el nuevo handler
- [ ] Al desplegarse a `staging`, `GET /api/libros` responde `200` con un array JSON (vacío si la tabla no tiene datos todavía)
- [ ] El endpoint no exige ningún header de autenticación
- [ ] Ningún nombre de tabla queda hardcodeado — se resuelve siempre desde `TABLA_LIBROS`
