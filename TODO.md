# TODO.md — Babel

Motor JIT: este documento mantiene **siempre exactamente 2 tareas atómicas** activas. Al completar cualquiera, se elimina, se mueve el resumen a `MEMORY.md` §2, y se calcula la siguiente tarea más prioritaria comparando `PRD.md` (roadmap) contra `MEMORY.md` (estado actual).

**Prioridad de selección aplicada:** no hay gaps de seguridad activos en producción. La tarea de autenticación con Google (SDK cliente, `AuthService`, `AuthGuard`) se completó (ver `MEMORY.md` §2 y §9, PR #5). Se reemplazó por la siguiente pieza fundacional del roadmap **Alta** (`PRD.md` §6), independiente de los modelos/DynamoDB: la pantalla visual de login, ya que sin ella el `AuthGuard` recién implementado redirige a una ruta (`/login`) que todavía no existe.

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

## Tarea 2 — [FEATURE]: `LoginComponent` — pantalla de ingreso con Google

**Origen:** `PRD.md` §5.1 (roadmap, prioridad Alta) — `tech-specs.md` §4.2 define la ruta `/login` con guard `NoAuthGuard`. El `AuthService`/`AuthGuard` ya existen (PR #5), pero no hay ninguna pantalla ni ruta que los use todavía: hoy `AuthGuard` redirige a `/login` y esa ruta no existe, dejando el flujo de login incompleto de punta a punta.

**Archivos:** `src/app/core/auth/no-auth.guard.ts` (nuevo, `NoAuthGuard`), `src/app/features/login/login.component.ts` (+ `.html`/`.css` si excede el límite de componente inline de `CLAUDE.md` §4), `src/app/app.routes.ts` (registrar `/login` y aplicar `AuthGuard` a al menos una ruta de prueba para verificar el flujo de punta a punta).

**Qué hacer:**
1. Implementar `src/app/core/auth/no-auth.guard.ts` (`NoAuthGuard` funcional, `CanActivateFn`): si ya hay sesión activa (`AuthService.usuario()`), redirige fuera de `/login` (p. ej. a `/`); si no hay sesión, permite el acceso. Es el guard inverso de `AuthGuard` (ver `tech-specs.md` §4.2).
2. Implementar `LoginComponent` (standalone, `features/login/`): botón "Ingresar con Google" que invoca `AuthService.iniciarSesionConGoogle()`; mientras la promesa está pendiente, mostrar un estado de carga simple; si falla (p. ej. el usuario cierra el popup), mostrar un mensaje de error legible, sin exponer detalles internos del error (`CLAUDE.md` A05). Tras un login exitoso, navegar a `/` (o a la ruta que corresponda — por ahora `/`, ya que no hay resolución de rol en el cliente todavía).
3. Registrar la ruta `/login` → `LoginComponent` con `canActivate: [NoAuthGuard]` en `app.routes.ts`.
4. Registrar temporalmente `AuthGuard` en al menos una ruta de prueba (o una ruta placeholder ya prevista del roadmap, si prefieres adelantar el andamiaje de `tech-specs.md` §4.2 con un componente vacío) para poder verificar el flujo completo: sin sesión → `AuthGuard` redirige a `/login` → login exitoso → navega fuera de `/login`.
5. Estilos con Tailwind (ya configurado), siguiendo la paleta de marca de `CLAUDE.md` §4 (`primary #230C00`, `secondary #E8630A`, etc.) de forma básica — no es necesario un `DESIGN.md` completo todavía, solo que la pantalla no se vea sin estilo alguno.

**Definition of done:**
- [ ] `npm run build` compila sin errores
- [ ] `npm run start` sirve `/login` y el botón "Ingresar con Google" invoca `iniciarSesionConGoogle()` (verificar manualmente con una cuenta de Google real, ya que esto requiere el popup real del navegador)
- [ ] Tras un login exitoso, la app navega fuera de `/login`
- [ ] `NoAuthGuard` redirige fuera de `/login` si ya hay sesión activa
- [ ] La ruta de prueba protegida con `AuthGuard` redirige correctamente a `/login` sin sesión
- [ ] Ningún detalle interno de error (stack trace, mensaje crudo del SDK de Firebase) se muestra al usuario final
