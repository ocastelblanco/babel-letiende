# TODO.md — Babel

Motor JIT: este documento mantiene **siempre exactamente 2 tareas atómicas** activas. Al completar cualquiera, se elimina, se mueve el resumen a `MEMORY.md` §2, y se calcula la siguiente tarea más prioritaria comparando `PRD.md` (roadmap) contra `MEMORY.md` (estado actual).

**Prioridad de selección aplicada:** no hay gaps de seguridad activos en producción (nada desplegado todavía). La Tarea 1 (scaffold Angular) se completó (ver `MEMORY.md` §2 y §9, PR #2) y se reemplazó por la siguiente pieza fundacional del roadmap **Alta** (`PRD.md` §6) que puede avanzar de forma independiente al esqueleto de Serverless: la autenticación con Google, ya que bloquea todos los guards (`AuthGuard`/`RoleGuard`) de las rutas definidas en `tech-specs.md` §4.2.

---

## Tarea 1 — [FEATURE]: Esqueleto de Serverless Framework + tablas DynamoDB

**Origen:** `PRD.md` §6 (roadmap, prioridad Alta) — toda la lógica de backend (autenticación, catalogación, ventas) requiere que exista la infraestructura como código. `tech-specs.md` §5.1 define las 5 tablas y §9 las variables de entorno/secretos necesarias.

**Archivos:** `serverless.yml`, `server/api/handlers/health.ts` (endpoint mínimo de verificación), `.github/workflows/deploy.yml` (esqueleto inicial, sin credenciales reales).

**Qué hacer:**
1. Crear `serverless.yml` con: provider AWS, runtime `nodejs24.x`, definición de la función `api` (apuntando a `server/api/handlers/health.ts` como placeholder) y de la función `ssr` (ya puede apuntar al build real de Angular generado en `dist/babel-letiende/server/server.mjs` — el scaffold ya existe, ver `MEMORY.md` §2).
2. Declarar como recursos de Serverless Framework las 5 tablas DynamoDB de `tech-specs.md` §5.1 (`babel-libros`, `babel-ventas`, `babel-estantes`, `babel-editoriales-descuentos`, `babel-usuarios`) con capacidad aprovisionada 25 RCU/25 WCU cada una (objetivo de costo $0 — ver `tech-specs.md` §7.3).
3. Implementar `server/api/handlers/health.ts`: un endpoint `GET /api/health` que responda `200 OK` sin lógica de negocio, para validar que el despliegue funciona de punta a punta.
4. Crear `.github/workflows/deploy.yml` con los jobs de build+test en PR y despliegue en push a `main`, siguiendo el patrón de `comandante-letiende/.github/workflows/deploy-hosting.yml` pero reemplazando el deploy de Firebase Hosting por `npx serverless deploy --stage production` (dejar los `secrets.*` de AWS referenciados pero sin configurar aún).

**Definition of done:**
- [ ] `npx serverless deploy --stage staging` despliega sin errores (o `serverless-offline` funciona en local si aún no hay cuenta AWS configurada)
- [ ] Las 5 tablas DynamoDB quedan definidas en `serverless.yml` con capacidad aprovisionada 25/25
- [ ] `GET /api/health` responde `200 OK` en el entorno donde se pruebe (local u desplegado)
- [ ] El workflow de GitHub Actions existe y referencia los secrets correctos de `tech-specs.md` §9, sin credenciales reales hardcodeadas

---

## Tarea 2 — [FEATURE]: Autenticación con Google (Firebase Auth) — SDK cliente, `AuthService` y `AuthGuard`

**Origen:** `PRD.md` §5.1 y §6 (roadmap, prioridad Alta) — el login con Google es prerrequisito de todas las rutas protegidas (`tech-specs.md` §4.2: `/catalogar`, `/venta`, `/libros`, `/admin/*`). `tech-specs.md` §8 y §8.1 definen el flujo exacto y el modelo de identidad compartida con Comandante (mismo proyecto Firebase `comandante-letiende`, autorización independiente por app — ver `MEMORY.md` ADR-007).

**Archivos:** `src/environments/environment.ts`, `src/environments/environment.development.ts` (config pública del SDK cliente de Firebase), `angular.json` (registrar `fileReplacements` de environments si `ng new` no los generó), `src/app/core/auth/auth.service.ts`, `src/app/core/auth/auth.guard.ts`.

**Qué hacer:**
1. Instalar el SDK cliente `firebase` (paquete npm) y crear `src/environments/environment.ts`/`environment.development.ts` con la config pública (`apiKey`, `authDomain`, `projectId: 'comandante-letiende'`, etc.) — ver `tech-specs.md` §8.1. Esta config es pública y sí puede vivir en el repo (no es secreta), a diferencia de la cuenta de servicio de backend.
2. Implementar `src/app/core/auth/auth.service.ts` con Signals: `usuario$`/`usuario` (Signal del usuario autenticado o `null`), método `iniciarSesionConGoogle()` (usando `signInWithPopup` con `GoogleAuthProvider`, restringido solo a Google — ver `tech-specs.md` §8.1 "blast radius"), y `cerrarSesion()` (invoca `signOut(auth)` y limpia el estado reactivo — ver `CLAUDE.md` A07).
3. Implementar `src/app/core/auth/auth.guard.ts` (`AuthGuard` funcional, `CanActivateFn`) que redirige a `/login` si no hay sesión activa. Nota explícita (`tech-specs.md` §8, `CLAUDE.md` A01): este guard es solo experiencia de usuario — la autorización real seguirá resolviéndose en la Lambda `api` cuando exista (Tarea 1), nunca confiar en el rol resuelto en el cliente para decisiones de seguridad.
4. Registrar el `AuthService`/Firebase app en `app.config.ts` (providers).
5. No implementar todavía `RoleGuard` ni el componente visual `LoginComponent` (quedan para una tarea posterior de UI) — el alcance de esta tarea es la plomería de autenticación, no la pantalla de login.

**Definition of done:**
- [ ] `npm run build` compila sin errores con el SDK de Firebase instalado
- [ ] `AuthService.iniciarSesionConGoogle()` abre el popup de Google y puebla el Signal de usuario tras un login exitoso (verificar manualmente en `npm run start`)
- [ ] `AuthService.cerrarSesion()` limpia el Signal de usuario
- [ ] `AuthGuard` redirige a `/login` cuando no hay sesión (probar con una ruta protegida de prueba)
- [ ] Ningún secreto de backend (cuenta de servicio, `FIREBASE_SERVICE_ACCOUNT_BABEL`) queda en el código de cliente — solo la config pública del SDK
