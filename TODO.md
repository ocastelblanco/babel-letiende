# TODO.md — Babel

Motor JIT: este documento mantiene **siempre exactamente 2 tareas atómicas** activas. Al completar cualquiera, se elimina, se mueve el resumen a `MEMORY.md` §2, y se calcula la siguiente tarea más prioritaria comparando `PRD.md` (roadmap) contra `MEMORY.md` (estado actual).

**Prioridad de selección aplicada:** no hay gaps de seguridad activos en producción (nada desplegado todavía), por lo que ambas tareas activas provienen del roadmap de prioridad **Alta** (`PRD.md` §6), eligiendo las dos que fundan el resto del proyecto: frontend y backend/infraestructura, de forma independiente entre sí.

---

## Tarea 1 — [FEATURE]: Scaffold del proyecto Angular 22 SSR

**Origen:** `PRD.md` §6 (roadmap, prioridad Alta) — "Flujo de catalogación completo" y todo el resto del roadmap dependen de que exista el proyecto Angular base. `tech-specs.md` §3 define la estructura de carpetas objetivo.

**Archivos:** generados por `ng new`/`ng generate` según `tech-specs.md` §3 — principalmente `angular.json`, `package.json`, `tsconfig.json`, `src/main.ts`, `src/server.ts`, `postcss.config.json`, `.prettierrc`, y la estructura de carpetas `src/app/{core,features,shared}`.

> Nota de alcance: al ser el primer scaffold del repositorio (sin código previo), esta tarea excede el límite habitual de "máximo 3 archivos" del criterio de atomicidad — se acepta como excepción justificada porque el andamiaje del framework se genera con herramientas oficiales (Angular CLI), no se escribe archivo por archivo a mano, y es un paso único no recurrente.

**Qué hacer:**
1. `ng new babel-letiende --standalone --ssr --style=css` (o equivalente para Angular 22) sobre el repo existente, o inicializar manualmente si el CLI aún no soporta 22.x de forma estable.
2. Configurar Tailwind CSS 4.x siguiendo el mismo patrón que Comandante (`postcss.config.json` en formato JSON — ver el gotcha documentado en `CLAUDE.md`/`comandante-letiende` sobre `@angular/build:application` y PostCSS).
3. Crear la estructura de carpetas `src/app/core/{auth,api,models}`, `src/app/features/{catalogo-publico,catalogar,venta,libros,admin}`, `src/app/shared/` según `tech-specs.md` §3.
4. Configurar los path aliases (`@core/*`, `@shared/*`, `@features/*`, `@theme/*`) en `tsconfig.json`.
5. Configurar Prettier con las mismas reglas base que Comandante (`.prettierrc`).

**Definition of done:**
- [ ] `npm run build` compila sin errores
- [ ] `npm run start` sirve la aplicación localmente
- [ ] La estructura de carpetas coincide con `tech-specs.md` §3
- [ ] Tailwind CSS aplica estilos correctamente (validar con una clase de prueba)
- [ ] Los path aliases resuelven correctamente en al menos un import de prueba

---

## Tarea 2 — [FEATURE]: Esqueleto de Serverless Framework + tablas DynamoDB

**Origen:** `PRD.md` §6 (roadmap, prioridad Alta) — toda la lógica de backend (autenticación, catalogación, ventas) requiere que exista la infraestructura como código. `tech-specs.md` §5.1 define las 5 tablas y §9 las variables de entorno/secretos necesarias.

**Archivos:** `serverless.yml`, `server/api/handlers/health.ts` (endpoint mínimo de verificación), `.github/workflows/deploy.yml` (esqueleto inicial, sin credenciales reales).

**Qué hacer:**
1. Crear `serverless.yml` con: provider AWS, runtime `nodejs24.x`, definición de la función `api` (apuntando a `server/api/handlers/health.ts` como placeholder) y de la función `ssr` (placeholder hasta que exista el build de Angular de la Tarea 1).
2. Declarar como recursos de Serverless Framework las 5 tablas DynamoDB de `tech-specs.md` §5.1 (`babel-libros`, `babel-ventas`, `babel-estantes`, `babel-editoriales-descuentos`, `babel-usuarios`) con capacidad aprovisionada 25 RCU/25 WCU cada una (objetivo de costo $0 — ver `tech-specs.md` §7.3).
3. Implementar `server/api/handlers/health.ts`: un endpoint `GET /api/health` que responda `200 OK` sin lógica de negocio, para validar que el despliegue funciona de punta a punta.
4. Crear `.github/workflows/deploy.yml` con los jobs de build+test en PR y despliegue en push a `main`, siguiendo el patrón de `comandante-letiende/.github/workflows/deploy-hosting.yml` pero reemplazando el deploy de Firebase Hosting por `npx serverless deploy --stage production` (dejar los `secrets.*` de AWS referenciados pero sin configurar aún).

**Definition of done:**
- [ ] `npx serverless deploy --stage staging` despliega sin errores (o `serverless-offline` funciona en local si aún no hay cuenta AWS configurada)
- [ ] Las 5 tablas DynamoDB quedan definidas en `serverless.yml` con capacidad aprovisionada 25/25
- [ ] `GET /api/health` responde `200 OK` en el entorno donde se pruebe (local u desplegado)
- [ ] El workflow de GitHub Actions existe y referencia los secrets correctos de `tech-specs.md` §9, sin credenciales reales hardcodeadas
