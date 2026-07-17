# TODO.md — Babel

Motor JIT: este documento mantiene **siempre exactamente 2 tareas atómicas** activas. Al completar cualquiera, se elimina, se mueve el resumen a `MEMORY.md` §2, y se calcula la siguiente tarea más prioritaria comparando `PRD.md` (roadmap) contra `MEMORY.md` (estado actual).

**Prioridad de selección aplicada:** no hay gaps de seguridad activos en producción. La tarea de esqueleto de Serverless Framework + DynamoDB se completó y desplegó realmente a `staging` (ver `MEMORY.md` §2, §5 y §9, PR #3). Se reemplazó por la siguiente pieza fundacional del roadmap **Alta** (`PRD.md` §6), independiente de la autenticación: los modelos de datos compartidos y el cliente DynamoDB base, ya que tanto el catálogo público como la catalogación y las ventas los necesitan antes de poder implementarse.

---

## Tarea 1 — [FEATURE]: Autenticación con Google (Firebase Auth) — SDK cliente, `AuthService` y `AuthGuard`

**Origen:** `PRD.md` §5.1 y §6 (roadmap, prioridad Alta) — el login con Google es prerrequisito de todas las rutas protegidas (`tech-specs.md` §4.2: `/catalogar`, `/venta`, `/libros`, `/admin/*`). `tech-specs.md` §8 y §8.1 definen el flujo exacto y el modelo de identidad compartida con Comandante (mismo proyecto Firebase `comandante-letiende`, autorización independiente por app — ver `MEMORY.md` ADR-007).

**Archivos:** `src/environments/environment.ts`, `src/environments/environment.development.ts` (config pública del SDK cliente de Firebase), `angular.json` (registrar `fileReplacements` de environments si `ng new` no los generó), `src/app/core/auth/auth.service.ts`, `src/app/core/auth/auth.guard.ts`.

**Qué hacer:**
1. Instalar el SDK cliente `firebase` (paquete npm) y crear `src/environments/environment.ts`/`environment.development.ts` con la config pública (`apiKey`, `authDomain`, `projectId: 'comandante-letiende'`, etc.) — ver `tech-specs.md` §8.1. Esta config es pública y sí puede vivir en el repo (no es secreta), a diferencia de la cuenta de servicio de backend.
2. Implementar `src/app/core/auth/auth.service.ts` con Signals: `usuario$`/`usuario` (Signal del usuario autenticado o `null`), método `iniciarSesionConGoogle()` (usando `signInWithPopup` con `GoogleAuthProvider`, restringido solo a Google — ver `tech-specs.md` §8.1 "blast radius"), y `cerrarSesion()` (invoca `signOut(auth)` y limpia el estado reactivo — ver `CLAUDE.md` A07).
3. Implementar `src/app/core/auth/auth.guard.ts` (`AuthGuard` funcional, `CanActivateFn`) que redirige a `/login` si no hay sesión activa. Nota explícita (`tech-specs.md` §8, `CLAUDE.md` A01): este guard es solo experiencia de usuario — la autorización real se resuelve en la Lambda `api` (ya desplegada en `staging`, ver `MEMORY.md` §5), nunca confiar en el rol resuelto en el cliente para decisiones de seguridad.
4. Registrar el `AuthService`/Firebase app en `app.config.ts` (providers).
5. No implementar todavía `RoleGuard` ni el componente visual `LoginComponent` (quedan para una tarea posterior de UI) — el alcance de esta tarea es la plomería de autenticación, no la pantalla de login.

**Definition of done:**
- [ ] `npm run build` compila sin errores con el SDK de Firebase instalado
- [ ] `AuthService.iniciarSesionConGoogle()` abre el popup de Google y puebla el Signal de usuario tras un login exitoso (verificar manualmente en `npm run start`)
- [ ] `AuthService.cerrarSesion()` limpia el Signal de usuario
- [ ] `AuthGuard` redirige a `/login` cuando no hay sesión (probar con una ruta protegida de prueba)
- [ ] Ningún secreto de backend (cuenta de servicio, `FIREBASE_SERVICE_ACCOUNT_BABEL`) queda en el código de cliente — solo la config pública del SDK

---

## Tarea 2 — [FEATURE]: Modelos de datos compartidos + cliente DynamoDB base

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
