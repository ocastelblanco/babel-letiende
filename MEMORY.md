# MEMORY.md — Babel

Memoria de arquitectura y estado del proyecto. Actualizar al cierre de cada sesión de trabajo relevante.

---

## 1. Estado actual

| Campo | Valor |
|---|---|
| Versión | Sin release en producción — infraestructura backend ya desplegada y verificada en `staging` |
| URL producción | https://babel.letiende.co (aún no desplegada) |
| URL staging (real) | `https://oyzau0c910.execute-api.us-east-1.amazonaws.com` (API Gateway HTTP API, stage `staging`) |
| Rama principal | `main` |
| Rama de trabajo actual | `feature/serverless-skeleton-dynamodb` (PR #3, sin fusionar) |
| Última sesión | 2026-07-17 — Esqueleto de Serverless Framework + 5 tablas DynamoDB, desplegado realmente a `staging` |

---

## 2. Funcionalidades completadas vs. pendientes

- [x] Scaffold del proyecto Angular 22 + SSR + Tailwind CSS 4 (PR #2, rama `feature/scaffold-angular-ssr`) — ver detalle en §9
- [x] Esqueleto de Serverless Framework + tablas DynamoDB, desplegado a `staging` (PR #3, rama `feature/serverless-skeleton-dynamodb`) — ver detalle en §5 y §9
- [ ] Autenticación con Google (Firebase Auth) + resolución de rol (`TODO.md` Tarea 1 — SDK cliente/`AuthService`/`AuthGuard` primero, `RoleGuard` y verificación de rol en backend después)
- [ ] Modelos de datos compartidos + cliente DynamoDB base (`TODO.md` Tarea 2)
- [ ] Flujo de catalogación (escaneo → metadatos → PVP → estante)
- [ ] Registro de venta
- [ ] Catálogo público de consulta (SSR)
- [ ] Cambio de estante de un libro catalogado
- [ ] Configuración de estantes (CRUD, admin)
- [ ] Configuración de descuentos de editorial (CRUD, admin)
- [ ] Gestión de usuarios (CRUD, admin)
- [ ] Reportes de ventas + exportación XLSX (admin)
- [ ] `DESIGN.md` propio de Babel

El repositorio ya tiene el scaffold de Angular (`src/app/{core,features,shared}`, `src/theme/`, `angular.json`, `package.json`, etc.), `serverless.yml` con las 2 Lambdas y las 5 tablas ya desplegadas en `staging`, además de `README.md`, `LICENSE`, `.gitignore` y los documentos de este bootstrap. Ningún flujo de negocio está implementado todavía.

---

## 3. ADRs (Architecture Decision Records)

### ADR-001 — Backend propio en AWS Lambda/DynamoDB; `api.letiende.co` solo para metadatos
- **Fecha:** 2026-07-16
- **Estado:** Aceptado
- **Decisión:** Babel construye su propio backend (Lambda + DynamoDB + Serverless Framework) para almacenamiento y lógica de negocio (libros, ventas, estantes, usuarios, descuentos). La API externa `https://api.letiende.co`, ya existente y compartida entre apps de Le Tiende, se consume únicamente para resolver metadatos de libro (título, autor, portada, editorial) a partir del ISBN vía Google Books.
- **Razón:** el enunciado del proyecto describe explícitamente Lambda + DynamoDB como parte de la infraestructura propia de Babel ("el objetivo de la infraestructura (Lambda, Dynamo, Firebase Authentication, etc.) es que sea de costo $0"), mientras que `api.letiende.co` se menciona como un servicio ya consumido para un paso específico (metadatos). Confirmado con el usuario en la sesión de bootstrap.
- **Consecuencias:** Babel es responsable de su propio modelo de datos y de la lógica de scraping/búsqueda de PVP; no depende de cambios en `api.letiende.co` salvo para el paso de metadatos.

### ADR-002 — Aplicación PWA responsive, no app nativa empaquetada
- **Fecha:** 2026-07-16
- **Estado:** Aceptado
- **Decisión:** Babel se implementa como una PWA responsive (acceso a cámara vía `getUserMedia` desde el navegador), no como una app nativa empaquetada con Capacitor/Cordova.
- **Razón:** el stack solicitado (Angular SSR en AWS Lambda) es infraestructura web; empaquetar nativo agregaría complejidad de build/publicación no solicitada explícitamente. Confirmado con el usuario.
- **Consecuencias:** el acceso a cámara depende de las restricciones de navegador (HTTPS obligatorio, permisos por gesto de usuario — ver `CLAUDE.md` §7). Si la experiencia de escaneo resulta insuficiente en campo, evaluar Capacitor como ítem de roadmap Baja prioridad (ver `PRD.md` §6).

### ADR-003 — Tabla `babel-ventas` separada del registro de libro
- **Fecha:** 2026-07-16
- **Estado:** Aceptado
- **Decisión:** cada venta se registra como un documento independiente en `babel-ventas`, y `babel-libros.cantidadDisponible` se decrementa por cada venta, en vez de sobrescribir un único campo "vendido" en el libro.
- **Razón:** los reportes de ventas (PRD §5.5) requieren filtrar/ordenar por fecha, PVP, utilidad, costo, editorial y forma de pago con granularidad por transacción; un libro catalogado puede tener múltiples ejemplares vendidos en momentos distintos.
- **Consecuencias:** el catálogo público debe consultar `cantidadDisponible > 0` para determinar si un libro sigue en venta, en vez de un simple booleano.

### ADR-004 — Scraping sin navegador headless
- **Fecha:** 2026-07-16
- **Estado:** Aceptado
- **Decisión:** la búsqueda de PVP en sitios de la lista blanca se implementa con peticiones HTTP simples (`fetch`/`undici`) + `cheerio` para parsear HTML, sin Puppeteer/Playwright.
- **Razón:** mantener el tiempo de ejecución y memoria de la Lambda bajos para permanecer dentro de la capa siempre gratuita de AWS (objetivo de costo $0 explícito del proyecto).
- **Consecuencias:** sitios que dependan fuertemente de JavaScript del lado del cliente para mostrar el precio no serán compatibles con este enfoque; deberán excluirse de la lista blanca o resolverse manualmente.

### ADR-005 — Documentación en español, código en español
- **Fecha:** 2026-07-16
- **Estado:** Aceptado
- **Decisión:** variables, funciones, clases, nombres de tablas, commits, comentarios y documentación técnica en español.
- **Razón:** decisión explícita del usuario en la sesión de bootstrap (a diferencia de Comandante, que usa código en inglés con comentarios/UI en español).
- **Consecuencias:** revisar que las librerías de terceros no impongan convenciones en inglés dentro del propio código de Babel (los nombres de paquetes npm y sus APIs siguen en inglés, eso es aceptado).

### ADR-006 — Dos descuentos distintos: editorial (margen/consignación) vs. venta (discrecional)
- **Fecha:** 2026-07-17
- **Estado:** Aceptado
- **Decisión:** el sistema modela dos porcentajes de descuento completamente independientes:
  1. **Descuento editorial** (`Libro.porcentajeDescuentoEditorial`): margen que Le Tiende retiene sobre el PVP en libros que la editorial deja en consignación (típico 35% en el contexto colombiano: PVP $100.000 → editorial cobra $65.000, Le Tiende retiene $35.000 de utilidad). El administrador puede configurar modelos distintos por editorial (`babel-editoriales-descuentos`). Cuando el libro es propiedad de Le Tiende y no está en consignación, este porcentaje es 100% (sin costo, toda la venta es utilidad). Se fija al catalogar y determina `Libro.costo`.
  2. **Descuento de venta** (`Venta.porcentajeDescuentoVenta`): descuento discrecional que el vendedor acuerda con el comprador al momento de vender (0% por defecto), usado para rotar catálogo o al negociar libros propios de Le Tiende. Determina `Venta.precioFinal`, no afecta el costo del libro.
- **Razón:** precisión de negocio aportada por el usuario tras la primera versión de la documentación — el modelo original no distinguía estos dos conceptos con claridad, lo que habría llevado a un cálculo incorrecto de costo/utilidad en los reportes.
- **Consecuencias:** `Venta` ahora incluye un snapshot (`costoLibro`, `utilidad`, `pvp`) tomado al momento de la venta, para que cambios posteriores en la configuración de descuentos de editorial no alteren el costo/utilidad de ventas ya registradas. `POST /api/ventas` debe calcular y persistir ese snapshot, no solo referenciar el libro. Ver `tech-specs.md` §4.3 y §5.1, y `PRD.md` §5.2/§5.4/§10.

### ADR-007 — Firebase Authentication compartido con Comandante; autorización independiente por app
- **Fecha:** 2026-07-17
- **Estado:** Aceptado
- **Decisión:** Babel no crea un proyecto Firebase propio. Reutiliza el mismo proyecto Firebase que usa Comandante para Google Sign-In (misma identidad de usuario en ambas apps), pero cada app resuelve la autorización (rol `administrador`/`vendedor`) de forma completamente independiente en su propia base de datos: `babel-usuarios` en DynamoDB para Babel, la colección `users` de Firestore para Comandante. Babel usa su propia cuenta de servicio (`FIREBASE_SERVICE_ACCOUNT_BABEL`) sobre ese proyecto compartido, distinta de la de Comandante.
- **Razón:** pedido explícito del usuario — los mismos usuarios de Google de Comandante deben poder autenticarse en Babel sin crear cuenta nueva, evaluando primero si esto introducía algún problema de seguridad.
- **Consecuencias:**
  - Estar autenticado en el proyecto compartido no otorga ningún permiso por sí solo en ninguna de las dos apps — el correo debe existir explícitamente en la tabla/colección de usuarios de esa app específica (ya era así, se refuerza en `CLAUDE.md` A01/A07).
  - Mayor "blast radius" si el proyecto Firebase o una cuenta de servicio se ven comprometidos (afecta potencialmente a ambas apps) — mitigado con cuentas de servicio separadas por app.
  - Revocación en dos pasos: quitar el rol en `babel-usuarios` revoca solo Babel; deshabilitar la cuenta en la consola de Firebase revoca ambas apps. El administrador debe saber cuál usar según el caso.
  - Cuota de usuarios activos mensuales (MAU) de Firebase se comparte entre ambas apps (sin impacto esperado dado el volumen).
  - `projectId` confirmado por el usuario el 2026-07-17: **`comandante-letiende`**. Babel debe configurar el SDK cliente y `firebase-admin` apuntando a ese `projectId` exacto (ver `tech-specs.md` §6 y §8.1).

---

## 4. Dependencias instaladas

**Ya instaladas** (scaffold Angular, Tarea 1 completada):
- Runtime: `@angular/{common,compiler,core,forms,platform-browser,platform-server,router,ssr}` 22.x, `express` 5.x (servidor SSR), `rxjs` 7.8, `tslib`
- Dev: `@angular/{build,cli,compiler-cli}` 22.x, `tailwindcss` 4.x + `@tailwindcss/postcss` 4.x, `postcss`, `prettier` 3.x, `typescript` 6.x, `vitest` (test runner que usa `ng test` en Angular 22), `@types/{express,node}`, `jsdom`

**Ya instaladas** (esqueleto Serverless, Tarea completada 2026-07-17): `serverless` 4.39.0 (devDependency, versión exacta), `@codegenie/serverless-express` (wrapper Lambda del SSR), `@types/aws-lambda` (dev).

**Pendientes** (previstas en `tech-specs.md` §2, aún no instaladas): `firebase` (SDK cliente — próxima tarea), `firebase-admin` (backend), `xlsx`, `@zxing/browser`, `cheerio`, `@aws-sdk/client-dynamodb`/`@aws-sdk/lib-dynamodb` (próxima tarea de modelos + cliente DynamoDB).

---

## 5. Configuraciones vigentes

| Campo | Valor |
|---|---|
| Proyecto Firebase (Authentication) | `comandante-letiende` — compartido con Comandante, confirmado por el usuario (ver ADR-007) |
| Cuenta AWS | `696912647258` — credenciales configuradas localmente vía AWS CLI, usadas para el deploy real a `staging` del 2026-07-17 |
| Stage `staging` — API Gateway | `https://oyzau0c910.execute-api.us-east-1.amazonaws.com` (HTTP API, region `us-east-1`) |
| Stage `staging` — Lambda `api` | `arn:aws:lambda:us-east-1:696912647258:function:babel-letiende-staging-api`, rol `babel-api-role-staging` (CRUD acotado a las 5 tablas + `/index/*`, sin más permisos) |
| Stage `staging` — Lambda `ssr` | `arn:aws:lambda:us-east-1:696912647258:function:babel-letiende-staging-ssr`, rol `babel-ssr-role-staging` (solo `AWSLambdaBasicExecutionRole`, sin acceso a DynamoDB) |
| Stage `staging` — Tablas DynamoDB (nombre real) | `babel-libros-staging`, `babel-ventas-staging`, `babel-estantes-staging`, `babel-editoriales-descuentos-staging`, `babel-usuarios-staging` — todas `PROVISIONED` 25/25 RCU/WCU (tabla y GSIs) |
| Nombres lógicos → variables de entorno de la Lambda `api` | `TABLA_LIBROS`, `TABLA_VENTAS`, `TABLA_ESTANTES`, `TABLA_EDITORIALES_DESCUENTOS`, `TABLA_USUARIOS` (resueltos en `serverless.yml`, nunca hardcodeados en el código de negocio) |

**GitHub Actions Secrets configurados por el usuario (2026-07-17):** `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `SERVERLESS_LICENSE_KEY` (ruta de licencia de Serverless Framework v4, sin depender del dashboard — confirmado con la doc oficial que la variable de entorno exacta es `SERVERLESS_LICENSE_KEY`, no `SERVERLESS_ACCESS_KEY`; el workflow se corrigió para usarla).

Pendiente (sin configurar en esta sesión): dominio personalizado `babel.letiende.co` en Route53/API Gateway/ACM (fuera de alcance de la tarea de esqueleto — ver roadmap técnico), y los secrets de negocio de producción (`FIREBASE_SERVICE_ACCOUNT_BABEL`, `GOOGLE_CUSTOM_SEARCH_*`, `API_LETIENDE_BASE_URL`).

---

## 6. Patrones de código establecidos

Aún no hay código. Los patrones previstos (a validar en la primera implementación) están documentados en `tech-specs.md` §4.1 (Signals, servicios unidireccionales, componentes Smart/Dumb) y `CLAUDE.md` §4 (convenciones de código e idioma).

---

## 7. Gotchas conocidos

| Situación | Solución |
|---|---|
| Acceso a cámara para código de barras no funciona | Verificar HTTPS y que la solicitud se dispare desde un gesto directo del usuario (tap), no automáticamente al cargar la página — ver `CLAUDE.md` §7 |
| Avatar de Google devuelve 429 | Agregar `referrerpolicy="no-referrer"` en el `<img>` — mismo hallazgo que en Comandante |
| Cold start alto en la Lambda SSR | Esperado en el nivel gratuito; no usar concurrencia aprovisionada salvo que el costo lo justifique |
| **(Verificado 2026-07-17)** Con `@angular/build:application` (builder de Angular 22 con SSR), Tailwind 4 vía `postcss.config.js` (`module.exports`) no siempre se detecta de forma confiable | Usar `.postcssrc.json` en JSON puro: `{ "plugins": { "@tailwindcss/postcss": {} } }`. Confirmado funcionando en el scaffold real (PR #2): las utilidades de Tailwind se generan correctamente en el CSS de salida. |
| **(Verificado 2026-07-17)** El `.gitignore` original del bootstrap (`b4a2bc4`) traía `/package-lock.json` ignorado — pasó inadvertido mientras no existía `package.json` | Corregido en PR #2: se quitó esa línea del `.gitignore`. Recordar para cualquier proyecto bootstrapeado con una plantilla genérica de `.gitignore` antes de tener `package.json`: revisar que no ignore el lockfile, ya que `CLAUDE.md` A08 exige `npm ci` reproducible en CI. |
| **(Verificado 2026-07-17)** `tsconfig.json` de Angular 22 usa TypeScript 6.x, que deprecó `baseUrl` — los path aliases (`paths`) deben usar valores con prefijo `./` explícito y no depender de `baseUrl` | Confirmado con un import de prueba (`@core/models/...`) que compiló correctamente sin `baseUrl`, solo con `paths` apuntando a `./src/...`. |

| **(Verificado 2026-07-17)** Angular 22 con SSR protege contra SSRF exigiendo una lista explícita de hosts permitidos (`AngularNodeAppEngine`); sin ella, la Lambda `ssr` responde 400 a cualquier host, incluido el dominio real que genera API Gateway | Configurar `NG_ALLOWED_HOSTS` con el host real (`${HttpApi}.execute-api.${AWS::Region}.amazonaws.com` en `serverless.yml`) — no es necesario tener ya un dominio personalizado para que funcione. |
| **(Verificado 2026-07-17)** El build SSR de Angular (`dist/babel-letiende/server/server.mjs`) exporta una instancia de Express pensada para `app.listen()`, no un handler Lambda | Envolver esa misma instancia con `@codegenie/serverless-express` (`server/ssr/handler.mjs`) en vez de reimplementar el bootstrap SSR; `src/server.ts` solo necesita `export { app }` adicional. |

Los primeros tres hallazgos de esta tabla siguen siendo anticipados por analogía con Comandante (no verificados en código real de Babel); los marcados "(Verificado 2026-07-17)" ya se confirmaron en código/infraestructura real de Babel.

---

## 8. Documentos de referencia

| Documento | Contenido |
|---|---|
| `CLAUDE.md` | Descripción, stack, comandos, convenciones, seguridad OWASP, git flow, gotchas |
| `PRD.md` | Visión de producto, flujos, roadmap funcional, casos de uso, requisitos no funcionales |
| `tech-specs.md` | Arquitectura, endpoints, modelos de datos, infraestructura, entornos, secretos |
| `MEMORY.md` | Este documento — estado, ADRs, gotchas, contexto de sesión |
| `TODO.md` | Motor JIT — siempre exactamente 2 tareas atómicas activas |

---

## 9. Contexto de la sesión actual

**Qué se hizo el 2026-07-16:** bootstrap completo de documentación del proyecto Babel usando la skill `project-docs-bootstrap` (repo `ocastelblanco/ia-orchestration-skills`). Se inspeccionó el repositorio hermano `comandante-letiende` (stack, `CLAUDE.md`, `DESIGN.md`, `tech-specs.md`, workflow de GitHub Actions) para mantener consistencia de filosofía visual y de CI/CD. Se resolvieron con el usuario las ambigüedades de arquitectura: `api.letiende.co` como servicio externo ya existente (solo metadatos), app como PWA responsive (no nativa), y código/documentación en español.

**Qué se hizo el 2026-07-17:** el usuario precisó que existen dos descuentos distintos e independientes — descuento editorial (margen de consignación, 100% si el libro es propio de Le Tiende) y descuento de venta (discrecional del vendedor). Se ajustaron `PRD.md` (§5.2, §5.4, §5.6, §7, §10), `tech-specs.md` (§4.3 modelos de datos con snapshot de costo/utilidad en `Venta`, §5 endpoints, §5.1 decisión de diseño) y este documento (ADR-006) para reflejarlo con precisión.

Adicionalmente, el usuario pidió compartir el mismo proyecto Firebase Authentication de Comandante (misma cuenta de Google en ambas apps), manteniendo roles independientes por app en su propia base de datos. Se evaluaron los riesgos de seguridad (blast radius compartido, revocación en dos pasos, necesidad de cuenta de servicio propia por app) y se documentaron en `tech-specs.md` §8.1 (nueva), `CLAUDE.md` (OWASP A01/A07 y tabla de prohibiciones), `PRD.md` (§5.1, §9) y este documento (ADR-007). Todos los cambios se enviaron a la misma rama/PR (`claude/babel-project-bootstrap-k7bhww`, PR #1) para aprobación conjunta.

**Qué se hizo también el 2026-07-17 (continuación):** el usuario confirmó el `projectId` de Firebase a reutilizar: `comandante-letiende`. Se resolvió el pendiente de ADR-007 y se actualizaron `tech-specs.md` §6/§8.1 y este documento (§1, §5, ADR-007) con el valor exacto.

**Qué se hizo el 2026-07-17 (Tarea 1 de `TODO.md` — scaffold Angular):** se generó el proyecto Angular 22 SSR (standalone components) en la raíz del repo con `ng new`, configurado Tailwind CSS 4 vía `@tailwindcss/postcss` (`.postcssrc.json` en JSON puro — ver gotcha verificado en §7), creada la estructura de carpetas exacta de `tech-specs.md` §3 (`src/app/{core,features,shared}`, `src/theme/`), configurados los path aliases (`@core`, `@shared`, `@features`, `@theme`) en `tsconfig.json`, y Prettier con la config generada por Angular CLI. Se corrigió además `.gitignore` para dejar de ignorar `package-lock.json` (requerido por `CLAUDE.md` A08). Build (`npm run build`) y servidor de desarrollo (`npm run start`, HTTP 200) verificados de forma independiente antes de commitear. Cambios enviados en la rama `feature/scaffold-angular-ssr` (PR #2, sin fusionar), en dos commits separados: uno de documentación pendiente (README completo + symlinks de skills) y otro del scaffold en sí.

**Qué se hizo el 2026-07-17 (esqueleto de Serverless Framework + DynamoDB):** se creó `serverless.yml` con dos funciones Lambda separadas por rol IAM de mínimo privilegio (`api` con CRUD acotado a las 5 tablas, `ssr` sin ningún permiso de DynamoDB), las 5 tablas DynamoDB de `tech-specs.md` §5.1 con capacidad aprovisionada 25/25, el handler placeholder `GET /api/health`, el wrapper `server/ssr/handler.mjs` (`@codegenie/serverless-express`) sobre el build SSR de Angular, y `.github/workflows/deploy.yml`. El usuario autorizó explícitamente un **deploy real** a AWS stage `staging` (cuenta `696912647258`) — se ejecutó y se verificó de forma independiente (recursos reales confirmados por AWS CLI, ver §5). Cambios en la rama `feature/serverless-skeleton-dynamodb` (PR #3, sin fusionar). El primer run de CI falló (`serverless package` sin autenticar); el usuario configuró los GitHub Secrets (`AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `SERVERLESS_LICENSE_KEY`) y se corrigió el workflow para usar `SERVERLESS_LICENSE_KEY` (no `SERVERLESS_ACCESS_KEY` — son dos rutas de auth distintas de Serverless Framework v4, confirmado con la documentación oficial, ver §5).

**Próxima tarea sugerida:** ver `TODO.md` — Tarea 1 (autenticación con Google: SDK cliente, `AuthService`, `AuthGuard`) y Tarea 2 (modelos de datos compartidos + cliente DynamoDB base). Ambas son independientes entre sí y pueden avanzar en paralelo.
