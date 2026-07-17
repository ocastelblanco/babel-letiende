# TODO.md — Babel

Motor JIT: este documento mantiene **siempre exactamente 2 tareas atómicas** activas. Al completar cualquiera, se elimina, se mueve el resumen a `MEMORY.md` §2, y se calcula la siguiente tarea más prioritaria comparando `PRD.md` (roadmap) contra `MEMORY.md` (estado actual).

**Prioridad de selección aplicada:** no hay gaps de seguridad activos en producción. La tarea de `LoginComponent` + `NoAuthGuard` se completó y se probó con un deploy real a `staging` (ver `MEMORY.md` §2, §7 y §9, PR #6) — en el proceso se encontró y corrigió un bug real de `RenderMode.Prerender` que dejaba los guards sin efecto en producción. Se reemplazó por la siguiente pieza de seguridad **Alta** prioridad (`CLAUDE.md` A01/A07, `tech-specs.md` §8): la verificación real del ID Token de Firebase en el backend, independiente del cliente genérico de DynamoDB (usa una lectura directa a `babel-usuarios`, sin esperar la abstracción reutilizable de la Tarea 1).

---

## Tarea 1 — [FEATURE]: Modelos de datos compartidos + cliente DynamoDB base

**Origen:** `PRD.md` §6 (roadmap, prioridad Alta) — el catálogo público, la catalogación y el registro de venta necesitan los mismos modelos e igual acceso a datos; implementarlos una sola vez evita divergencia entre features. `tech-specs.md` §4.3 define las interfaces exactas y §5.1 las 5 tablas ya desplegadas (`TODO.md` anterior, `MEMORY.md` §5).

**Archivos:** `src/app/core/models/{libro,venta,estante,descuento-editorial,usuario}.model.ts`, `server/api/services/dynamodb.ts`, `server/tsconfig.json` (ampliar `include` si hace falta).

**Qué hacer:**
1. Crear en `src/app/core/models/` una interfaz TypeScript por cada modelo de `tech-specs.md` §4.3 (`Libro`, `Venta`, `Estante`, `DescuentoEditorial`, `Usuario`), tipado estricto, sin `any`, comentarios solo donde el campo no sea autoexplicativo (p. ej. por qué `porcentajeDescuentoEditorial` puede ser 100).
2. Instalar `@aws-sdk/client-dynamodb` y `@aws-sdk/lib-dynamodb` como dependencias del backend.
3. Implementar `server/api/services/dynamodb.ts`: cliente DynamoDB único (`DynamoDBDocumentClient`) y funciones genéricas reutilizables (`obtenerPorClave`, `guardar`, `eliminar`, `consultarPorIndice`) parametrizadas por nombre de tabla — sin lógica de negocio de ningún endpoint específico todavía, solo la plomería de acceso a datos que usarán las tareas de catalogación/venta/catálogo público.
4. Los nombres de tabla se resuelven desde las variables de entorno ya definidas en `serverless.yml` (`TABLA_LIBROS`, `TABLA_VENTAS`, etc. — ver `MEMORY.md` §5), nunca hardcodeados.
5. No implementar todavía ningún endpoint de negocio (`/api/libros`, `/api/ventas`, etc.) — el alcance de esta tarea es exclusivamente modelos + cliente de datos reutilizable.

**Definition of done:**
- [ ] `npm run build` compila sin errores con las 5 interfaces de modelo creadas
- [ ] `npm run build:api` compila sin errores con `server/api/services/dynamodb.ts`
- [ ] Las funciones genéricas del cliente DynamoDB funcionan contra una tabla real de `staging` (probar `guardar`/`obtenerPorClave` manualmente, p. ej. con un script puntual o `aws dynamodb get-item`, y limpiar el registro de prueba después)
- [ ] Ningún nombre de tabla está hardcodeado — todos vienen de variables de entorno

---

## Tarea 2 — [FEATURE]: Verificación real del ID Token de Firebase en el backend + resolución de rol

**Origen:** `CLAUDE.md` A01/A07 y `tech-specs.md` §8 (prioridad Alta, seguridad) — hoy `AuthGuard`/`NoAuthGuard` son 100% cliente (PR #5, PR #6); ninguna Lambda verifica todavía el ID Token ni resuelve el rol contra `babel-usuarios`. Sin esto, cualquier ruta de negocio que se agregue después (catalogación, ventas, admin) no tendría ninguna autorización real del lado servidor — solo la experiencia de usuario del guard, que `CLAUDE.md` A01 prohíbe explícitamente usar como control de acceso real.

**Archivos:** `server/api/lib/verificar-token.ts` (nuevo), `server/api/handlers/usuarios-me.ts` (nuevo, `GET /api/usuarios/me`), `serverless.yml` (nueva ruta + variable de entorno `FIREBASE_SERVICE_ACCOUNT_BABEL` ya declarada, ahora sí consumida).

**Qué hacer:**
1. Instalar `firebase-admin` como dependencia del backend.
2. Implementar `server/api/lib/verificar-token.ts`: función que recibe el header `Authorization: Bearer <token>`, inicializa `firebase-admin` con `projectId: 'comandante-letiende'` (ver `MEMORY.md` ADR-007 y `tech-specs.md` §8.1 — nunca otro `projectId`) y la cuenta de servicio de `FIREBASE_SERVICE_ACCOUNT_BABEL`, y llama `verifyIdToken`. Debe rechazar (lanzar/retornar error tipado) si el header falta, el token es inválido o expiró — nunca asumir un token válido.
3. Implementar `server/api/handlers/usuarios-me.ts`: `GET /api/usuarios/me` — verifica el token con lo del punto 2, busca el email verificado en `babel-usuarios` (lectura directa con `@aws-sdk/client-dynamodb`, sin esperar el cliente genérico de la Tarea 1 — es una única consulta puntual), y responde `403` si el correo no existe en la tabla (`CLAUDE.md` A01/A07: estar autenticado en el proyecto Firebase compartido no implica autorización en Babel). Si existe, responde el `Usuario` (`tech-specs.md` §4.3) con su `rol`.
4. Registrar la ruta en `serverless.yml` bajo la función `api` (ya tiene permisos de lectura sobre `babel-usuarios` desde la tarea de Serverless — confirmar que el nombre de tabla se resuelve por variable de entorno, nunca hardcodeado).
5. No implementar todavía `RoleGuard` en el frontend (depende de que el cliente consuma este endpoint, puede ser una tarea posterior) — el alcance es exclusivamente la verificación y resolución de rol en el backend.

**Definition of done:**
- [ ] `npm run build:api` compila sin errores con `firebase-admin` instalado
- [ ] `GET /api/usuarios/me` sin header `Authorization` responde `401` (o equivalente), nunca `200`
- [ ] `GET /api/usuarios/me` con un ID Token real pero de un correo que NO existe en `babel-usuarios` responde `403`
- [ ] `GET /api/usuarios/me` con un ID Token real de un correo que SÍ existe en `babel-usuarios` (crear un registro de prueba en `staging` y limpiarlo después) responde `200` con el `rol` correcto
- [ ] Ningún secreto (`FIREBASE_SERVICE_ACCOUNT_BABEL`) queda hardcodeado — se lee siempre de la variable de entorno ya declarada en `serverless.yml`
