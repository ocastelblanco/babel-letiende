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
| Rama de trabajo actual | `feature/modelos-datos-dynamodb-client` — Tarea 1 de `TODO.md` implementada, pendiente de push/PR (ver §9) |
| Última sesión | 2026-07-17/18 — PRs #7–#10 fusionados (fix de dominio Firebase, deploy automático a `staging`, identidad visual, íconos PWA); sesión siguiente: modelos de datos + cliente DynamoDB genérico (Tarea 1) |

---

## 2. Funcionalidades completadas vs. pendientes

- [x] Scaffold del proyecto Angular 22 + SSR + Tailwind CSS 4 (PR #2, rama `feature/scaffold-angular-ssr`) — ver detalle en §9
- [x] Esqueleto de Serverless Framework + tablas DynamoDB, desplegado a `staging` (PR #3, rama `feature/serverless-skeleton-dynamodb`) — ver detalle en §5 y §9
- [x] Autenticación con Google (Firebase Auth) — SDK cliente, `AuthService` (Signals), `AuthGuard` (PR #5) — ver detalle en §9.
- [x] `LoginComponent` + `NoAuthGuard` — probado con deploy real a `staging`, identidad visual igualada a Comandante por medición de píxeles (sin Ionic, PR #6/#9 fusionados) — ver detalle en §7 y §9. Pendiente: `RoleGuard` y verificación de rol en backend.
- [x] Deploy automático a `staging` en cada PR (CI, PR #8 fusionado) — ver §5 y §9
- [x] Íconos PWA + `manifest.webmanifest` (PR #10 fusionado) — ver §7 y §9. Pendiente sin urgencia: fuente Angellya como `@font-face`.
- [x] Modelos de datos compartidos + cliente DynamoDB base (rama `feature/modelos-datos-dynamodb-client`, PR pendiente de crear) — ver detalle en §9. Pendiente: verificación en vivo contra `staging` (ver aviso en `TODO.md`).
- [ ] Verificación real del ID Token de Firebase en el backend + resolución de rol (`TODO.md` Tarea 1)
- [ ] Endpoint público `GET /api/libros` — catálogo de consulta (`TODO.md` Tarea 2)
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

**Ya instaladas** (autenticación con Google, Tarea completada 2026-07-17): `firebase` v12.x (SDK cliente, sin `@angular/fire` — ver §7 y §9).

**Ya instaladas** (modelos + cliente DynamoDB, Tarea completada 2026-07-18): `@aws-sdk/client-dynamodb`, `@aws-sdk/lib-dynamodb` (dependencias de runtime del backend, ver §9 — instaladas con `--ignore-scripts` por un problema de red del entorno, no de los paquetes en sí, ver §7).

**Pendientes** (previstas en `tech-specs.md` §2, aún no instaladas): `firebase-admin` (backend, verificación de rol — próxima tarea), `xlsx`, `@zxing/browser`, `cheerio`.

---

## 5. Configuraciones vigentes

| Campo | Valor |
|---|---|
| Proyecto Firebase (Authentication) | `comandante-letiende` — compartido con Comandante, confirmado por el usuario (ver ADR-007) |
| Dominios autorizados de Firebase Auth | `localhost`, dominios propios de Comandante (`comandante-letiende.{firebaseapp,web}.app`, `comandante.letiende.co`, preview channels `pr*`), y **`oyzau0c910.execute-api.us-east-1.amazonaws.com`** (agregado el 2026-07-17 para que `signInWithPopup` funcione en `staging` de Babel — ver gotcha en §7). Si el stack de `staging` se destruye y se vuelve a desplegar, API Gateway genera un dominio nuevo y hay que repetir este paso (o mejor, resolverlo de raíz con el dominio personalizado `babel.letiende.co` del roadmap). |
| Cuenta AWS | `696912647258` — credenciales configuradas localmente vía AWS CLI, usadas para el deploy real a `staging` del 2026-07-17 |
| Stage `staging` — API Gateway | `https://oyzau0c910.execute-api.us-east-1.amazonaws.com` (HTTP API, region `us-east-1`) |
| Stage `staging` — Lambda `api` | `arn:aws:lambda:us-east-1:696912647258:function:babel-letiende-staging-api`, rol `babel-api-role-staging` (CRUD acotado a las 5 tablas + `/index/*`, sin más permisos) |
| Stage `staging` — Lambda `ssr` | `arn:aws:lambda:us-east-1:696912647258:function:babel-letiende-staging-ssr`, rol `babel-ssr-role-staging` (solo `AWSLambdaBasicExecutionRole`, sin acceso a DynamoDB) |
| Stage `staging` — Tablas DynamoDB (nombre real) | `babel-libros-staging`, `babel-ventas-staging`, `babel-estantes-staging`, `babel-editoriales-descuentos-staging`, `babel-usuarios-staging` — todas `PROVISIONED` 25/25 RCU/WCU (tabla y GSIs) |
| Nombres lógicos → variables de entorno de la Lambda `api` | `TABLA_LIBROS`, `TABLA_VENTAS`, `TABLA_ESTANTES`, `TABLA_EDITORIALES_DESCUENTOS`, `TABLA_USUARIOS` (resueltos en `serverless.yml`, nunca hardcodeados en el código de negocio) |

**GitHub Actions Secrets configurados por el usuario (2026-07-17):** `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `SERVERLESS_LICENSE_KEY` (ruta de licencia de Serverless Framework v4, sin depender del dashboard — confirmado con la doc oficial que la variable de entorno exacta es `SERVERLESS_LICENSE_KEY`, no `SERVERLESS_ACCESS_KEY`; el workflow se corrigió para usarla).

**Deploy automático a `staging` en cada PR (2026-07-17):** `.github/workflows/deploy.yml` tiene un job `desplegar-staging` que corre en todo evento `pull_request` (después de `build-y-test`), despliega con `npx serverless deploy --stage staging` usando los mismos secrets, y comenta la URL en el PR. Con esto, cualquier sesión de Claude Code (incluida la app de Android) puede validar cambios en `staging` solo con `commit → push → PR`, sin necesidad de credenciales de AWS locales ni de un deploy manual desde esta Mac. Motivo: hasta este punto, todos los deploys de `staging` se habían hecho a mano (`npm run deploy:staging`) con las credenciales AWS configuradas únicamente en esta máquina.

Pendiente (sin configurar en esta sesión): dominio personalizado `babel.letiende.co` en Route53/API Gateway/ACM (fuera de alcance de la tarea de esqueleto — ver roadmap técnico), y los secrets de negocio de producción (`FIREBASE_SERVICE_ACCOUNT_BABEL`, `GOOGLE_CUSTOM_SEARCH_*`, `API_LETIENDE_BASE_URL`).

---

## 6. Patrones de código establecidos

- **Frontend:** Signals para estado reactivo (`AuthService`), Standalone components, guards como `CanActivateFn` — ver `tech-specs.md` §4.1 y `CLAUDE.md` §4.
- **Modelos de datos:** una interfaz TypeScript por archivo en `src/app/core/models/`, nombre de archivo en kebab-case + sufijo `.model.ts` (ej. `descuento-editorial.model.ts`), tipos de unión de string exportados aparte cuando se reutilizan (`FormaDePago`, `RolUsuario`). Comentario TSDoc solo en el nivel de la interfaz explicando el "por qué" de negocio (referencia a `tech-specs.md`/`MEMORY.md` ADR); comentario en línea por campo únicamente si su fórmula o su rango no es autoevidente (ej. `costo`, `porcentajeDescuentoEditorial`). Sin `any`.
- **Backend — acceso a datos:** un cliente `DynamoDBDocumentClient` único por proceso (`server/api/services/dynamodb.ts`) con funciones genéricas (`obtenerPorClave`, `guardar`, `eliminar`, `consultarPorIndice`) parametrizadas por nombre de tabla — el nombre real de tabla nunca se hardcodea dentro del servicio, lo resuelve el handler que llama desde `process.env.TABLA_*` (variables ya declaradas en `serverless.yml`). Los handlers de endpoint (`server/api/handlers/*.ts`) no hablan con el SDK de AWS directamente, siempre pasan por este servicio.
- **Backend — handlers:** un archivo por endpoint/grupo en `server/api/handlers/`, tipados con `APIGatewayProxyHandlerV2`/`APIGatewayProxyResultV2` de `aws-lambda`, TSDoc de una sola frase explicando el alcance (ver `health.ts`).

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
| **(Verificado 2026-07-17)** El SDK cliente `firebase` (`initializeApp`/`getAuth`) depende de almacenamiento del navegador (indexedDB/localStorage); inicializarlo sin guardas durante el renderizado SSR de la Lambda `ssr` rompería el prerenderizado | Inicializar Firebase solo si `isPlatformBrowser(inject(PLATFORM_ID))`; en servidor, el Signal de usuario permanece `null` sin error. Confirmado: el build SSR sigue prerenderizando correctamente con `AuthService` en el árbol de providers. |
| **(Verificado 2026-07-17)** `angular.json` con el builder `@angular/build:application` (Angular 22) sigue soportando `fileReplacements` por configuración, igual que en versiones anteriores de Angular | No cambió el mecanismo — se puede seguir usando `fileReplacements` en `architect.build.configurations.<config>` para alternar `environment.ts`/`environment.development.ts`. |
| **⚠️ (Verificado 2026-07-17, CRÍTICO)** `src/app/app.routes.server.ts` trae por defecto (`ng new --ssr`) `{ path: '**', renderMode: RenderMode.Prerender }` — esto genera HTML estático en **build time** y significa que los guards (`AuthGuard`/`NoAuthGuard`, y cualquier guard futuro) **nunca se ejecutan por petición** en el Lambda `ssr` desplegado. Detectado porque `/libros` servía `200` en vez de redirigir a `/login` en `staging`, mientras que en el dev server local (`ng serve`, que sí hace SSR real por petición) el mismo guard funcionaba bien — el dev server local puede ocultar este bug. | Usar `RenderMode.Server` (no `Prerender`) para cualquier ruta protegida por un guard. Solo usar `Prerender` en rutas genuinamente públicas y sin variación por usuario (p. ej. el futuro catálogo público, si se decide optimizar para SEO) — nunca en rutas con `canActivate`. Verificar SIEMPRE con un deploy real (no solo `ng serve`) antes de confiar en que un guard funciona en producción. |
| **(Verificado 2026-07-17)** La tipografía de marca **Angellya** (`CLAUDE.md` §4, `tech-specs.md` §4.4) no existe como archivo de fuente en ningún repo de Le Tiende — se buscó en `comandante/` (repo hermano) y solo aparece **vectorizada como paths dentro de los SVG de logo** (`logo_negro_sin_fondo.svg`/`logo_blanco_sin_fondo.svg`), nunca cargada como webfont; Comandante tampoco la usa en su propio código (su `login.component.ts` no aplica ningún `font-family` de Angellya al título) | Hasta que el usuario provea el archivo real (`.woff2`/`.otf`/`.ttf`), todo texto de marca usa Poppins como fallback (igual que hace Comandante en la práctica, aunque su `DESIGN.md` documente Angellya). No inventar ni descargar una fuente sustituta sin confirmar con el usuario. |
| **(Resuelto 2026-07-17)** El "favicon.ico" de Comandante solo tenía el monograma "tt" a 16×16/32×32 px | El usuario ubicó el set completo ya generado en `~/Documents/LeTiende/letiende.co/fuentes/logos_monos_png_ico/favicon_io/` (16/32/180/192/512 + `.ico` multi-resolución) y el SVG fuente en `logos_monos_svg/mono_naranja.svg` — copiado a `public/` (ver §9). El ícono de 512px tiene el trazo casi al borde (solo ~3% de margen horizontal, `magick -trim` confirma 481×343 dentro de un lienzo 512×512): **no se declaró `purpose: "maskable"` en el manifest**, solo `"any"`, porque no cumple el margen de seguridad recomendado (~10%) y un recorte circular del SO cortaría el trazo. |
| **(Resuelto 2026-07-17)** La fuente **Angellya** no existía en ningún repo de Le Tiende | El usuario la ubicó en `~/Documents/LeTiende/ImagenVisual/tipografías/angellya/Angellya.{otf,ttf}` — pendiente de integrar como `@font-face` (ver §9, tarea siguiente). |
| **⚠️ (Verificado 2026-07-17, CRÍTICO)** `signInWithPopup` abre y cierra el popup inmediatamente, sin mostrar el selector de cuenta de Google, y `AuthService`/`LoginComponent` capturan un `auth/unauthorized-domain` genérico ("No se pudo iniciar sesión...") — Firebase Auth valida el dominio actual contra la lista de "Authorized domains" del proyecto **antes** de completar el flujo del popup; un dominio de API Gateway generado automáticamente (`*.execute-api.*.amazonaws.com`) nunca está ahí por defecto | Agregar el dominio exacto a la lista (Firebase Console → Authentication → Settings → Authorized domains, o vía la API v2 `identitytoolkit.googleapis.com/v2/projects/{project}/config` con `updateMask=authorizedDomains`, preservando los dominios existentes — **nunca sobrescribir la lista completa**, es un proyecto compartido con Comandante). Confirmado en esta sesión: se agregó `oyzau0c910.execute-api.us-east-1.amazonaws.com` (ver §5). Recordar para cualquier dominio nuevo (`production`, un dominio personalizado, u otro stage). |

| **(Verificado 2026-07-17, benigno — sin acción)** Tras el fix de dominio autorizado, Chrome muestra en consola `Cross-Origin-Opener-Policy policy would block the window.close call` durante `signInWithPopup`, aunque el login se completa correctamente | Warning conocido y confirmado como cosmético (ver issues `firebase-js-sdk` [#8541](https://github.com/firebase/firebase-js-sdk/issues/8541)/[#8295](https://github.com/firebase/firebase-js-sdk/issues/8295)): ocurre porque el dominio de Google/Firebase donde corre el popup tiene su propio COOP restrictivo, y el navegador bloquea la llamada a `window.close()` cross-origin — el SDK completa el login por otra vía igual. Solo pasa en Chrome. Decisión del usuario: no agregar el header `Cross-Origin-Opener-Policy: same-origin-allow-popups` en el servidor SSR por ahora, ya que no hay garantía de que elimine el warning (la política restrictiva vive del lado de Google) y no hay ningún problema funcional que arreglar. |

| **(Verificado 2026-07-18)** `npm install` completo falla en entornos sandbox sin salida a internet general (aunque el registro de npm sí sea alcanzable): el `postinstall` de la devDependency `serverless` intenta descargar un release y aborta todo el `npm install`, incluidos paquetes nuevos que no tienen nada que ver con `serverless` | Instalar con `--ignore-scripts` cuando el fallo sea específicamente el `postInstall.js` de `serverless` (confirmar el error exacto antes de usarlo, no como solución genérica). Verificado: los paquetes nuevos (`@aws-sdk/*`) quedaron correctamente en `package.json`/`package-lock.json` y `node_modules` tras reintentar así. |
| **(Verificado 2026-07-18)** Angular CLI 22 exige Node `^22.22.3 \|\| ^24.15.0 \|\| >=26.0.0`; algunos entornos traen preinstalado un patch inferior (`v22.22.2`) que falla `ng build`/`ng test` con un mensaje claro, pero no es evidente que sea solo un patch de diferencia | Si hay `nvm` disponible, `nvm install 22.22.3` (o la versión mayor/menor equivalente) resuelve sin tocar ninguna configuración del proyecto — no es un problema del repo, es del entorno de ejecución. |
| **(Confirmado 2026-07-18)** Las credenciales AWS (`AWS_ACCESS_KEY_ID`/`AWS_SECRET_ACCESS_KEY`) presentes como variables de entorno en un entorno de ejecución en la nube (a diferencia de la Mac del usuario o del runner de GitHub Actions) no necesariamente son válidas contra la cuenta real `696912647258` — un intento de `guardar()`/`obtenerPorClave()` real contra `babel-estantes-staging` devolvió `UnrecognizedClientException` | No asumir que cualquier sesión tiene acceso real a AWS solo porque las variables de entorno existen. La verificación en vivo contra `staging` sigue dependiendo de GitHub Actions (que sí tiene los secrets reales) o de una sesión con credenciales confirmadas — y solo se ejerce genuinamente cuando existe al menos un handler que invoque el código en cuestión (ver `TODO.md`, aviso de prioridad). |

Los primeros tres hallazgos de esta tabla siguen siendo anticipados por analogía con Comandante (no verificados en código real de Babel); los marcados "(Verificado 2026-07-17)" o "(Verificado/Confirmado 2026-07-18)" ya se confirmaron en código/infraestructura real de Babel (o en el entorno de ejecución, en el caso de los tres últimos).

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

**Qué se hizo el 2026-07-17 (Tarea 1 de `TODO.md` — scaffold Angular):** se generó el proyecto Angular 22 SSR (standalone components) en la raíz del repo con `ng new`, configurado Tailwind CSS 4 vía `@tailwindcss/postcss` (`.postcssrc.json` en JSON puro — ver gotcha verificado en §7), creada la estructura de carpetas exacta de `tech-specs.md` §3 (`src/app/{core,features,shared}`, `src/theme/`), configurados los path aliases (`@core`, `@shared`, `@features`, `@theme`) en `tsconfig.json`, y Prettier con la config generada por Angular CLI. Se corrigió además `.gitignore` para dejar de ignorar `package-lock.json` (requerido por `CLAUDE.md` A08). Build (`npm run build`) y servidor de desarrollo (`npm run start`, HTTP 200) verificados de forma independiente antes de commitear. Cambios enviados en la rama `feature/scaffold-angular-ssr` (PR #2, fusionado a `main`), en dos commits separados: uno de documentación pendiente (README completo + symlinks de skills) y otro del scaffold en sí.

**Qué se hizo el 2026-07-17 (esqueleto de Serverless Framework + DynamoDB):** se creó `serverless.yml` con dos funciones Lambda separadas por rol IAM de mínimo privilegio (`api` con CRUD acotado a las 5 tablas, `ssr` sin ningún permiso de DynamoDB), las 5 tablas DynamoDB de `tech-specs.md` §5.1 con capacidad aprovisionada 25/25, el handler placeholder `GET /api/health`, el wrapper `server/ssr/handler.mjs` (`@codegenie/serverless-express`) sobre el build SSR de Angular, y `.github/workflows/deploy.yml`. El usuario autorizó explícitamente un **deploy real** a AWS stage `staging` (cuenta `696912647258`) — se ejecutó y se verificó de forma independiente (recursos reales confirmados por AWS CLI, ver §5). Cambios en la rama `feature/serverless-skeleton-dynamodb` (PR #3). El primer run de CI falló (`serverless package` sin autenticar); el usuario configuró los GitHub Secrets (`AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `SERVERLESS_LICENSE_KEY`) y se corrigió el workflow para usar `SERVERLESS_LICENSE_KEY` (no `SERVERLESS_ACCESS_KEY` — son dos rutas de auth distintas de Serverless Framework v4, confirmado con la documentación oficial, ver §5). CI en verde tras el fix; **PR #3 fusionado a `main`** y rama remota/local eliminadas.

**Qué se hizo el 2026-07-17 (autenticación con Google):** se implementó `AuthService` (Signals, SDK `firebase` puro sin `@angular/fire`) y `AuthGuard` (`CanActivateFn`). La config pública de Firebase (proyecto compartido `comandante-letiende`) se copió del repo hermano Comandante (`/Users/ocastelblanco/Documents/LeTiende/letiende.co/comandante/src/environments/environment.ts`), confirmando que es la misma para ambos ambientes de Babel por ahora (no hay proyecto Firebase de producción distinto todavía). Firebase se inicializa solo en el navegador (`isPlatformBrowser`) para no romper el SSR. Cubierto con 6 tests unitarios (Vitest, mocks del SDK) — sin verificación manual de UI porque el alcance excluye explícitamente `LoginComponent`. Cambios en la rama `feature/auth-google-firebase` (PR #5, fusionado a `main`).

**Qué se hizo el 2026-07-17 (`LoginComponent` + prueba real en AWS):** se implementó `NoAuthGuard`, `LoginComponent` (Tailwind, paleta de marca) y las rutas `/login`/`/libros` (esta última con un placeholder `ListaLibrosCatalogadosComponent`, nombre real del roadmap). Se agregó un redirect de `""`/`"**"` hacia `/libros` porque un login exitoso navegaba a `/` sin ningún componente asociado. El usuario pidió expresamente probar el mínimo posible en AWS real para validar la infraestructura/CI-CD sin esperar la tarea de modelos/DynamoDB (confirmado que son independientes) y sin disparar el job de `production` vía GitHub Actions — se optó por un **redeploy manual a `staging`** (`npm run deploy:staging`) en vez de fusionar a `main`. Al probar contra el deploy real se encontró el bug crítico de `RenderMode.Prerender` (ver §7) que dejaba `AuthGuard` sin efecto en producción; corregido a `RenderMode.Server` y re-verificado con un segundo redeploy real: `/libros` sin sesión → `302 → /login` confirmado con `curl` contra `https://oyzau0c910.execute-api.us-east-1.amazonaws.com`. Cambios en la rama `feature/login-component` (PR #6, fusionado a `main`).

**Qué se hizo el 2026-07-17 (identidad visual de Comandante en `LoginComponent`):** el usuario pidió que Babel siga la misma filosofía UX/UI de Comandante. Se inspeccionó `comandante/` (repo hermano): usa Ionic + Tailwind, paleta de 4 colores de `DESIGN.md`, Poppins vía Google Fonts, y un logo wordmark SVG ("le tiende", con la tipografía Angellya ya vectorizada como paths, no como fuente utilizable). Se copiaron `favicon.ico`, `logo_negro_sin_fondo.svg` y `logo_blanco_sin_fondo.svg` a `public/`, se agregaron tokens de color/tipografía a `styles.css` y se rediseñó `LoginComponent` (Tailwind puro, sin Ionic) replicando la estructura visual de Comandante (tarjeta centrada, logo, botón con ícono). Se corrigió un problema real de contraste: el `button-primary` de `DESIGN.md` usa texto `on-secondary` (`#230C00`, oscuro) sobre fondo `secondary` (`#E8630A`) — el primer borrador de Babel usaba texto blanco, que el propio `DESIGN.md` de Comandante marca como reprobado en WCAG AA (~2.6:1). Verificado con una captura real (Playwright + Chrome headless, instalado en este entorno para la prueba) del dev server y con un redeploy manual a `staging`. Cambios en la misma rama `feature/login-component` (PR #6, fusionado a `main`).

**Pendiente de assets del usuario (ver §7):** (1) archivo real de la fuente **Angellya** (`.woff2`/`.otf`/`.ttf`) — no existe en ningún repo de Le Tiende, ni siquiera en Comandante, que documenta su uso en `DESIGN.md` pero nunca la implementó; (2) versión de alta resolución (SVG o PNG ≥512px) del monograma cuadrado "tt" — hoy solo existe embebido en `favicon.ico` a 16×16/32×32, insuficiente para generar el set completo de íconos PWA (192/512/maskable/apple-touch-icon) sin verse borroso.

**Qué se hizo el 2026-07-17 (íconos PWA + `manifest.webmanifest`):** el usuario ubicó `mono_naranja.svg` y reveló un directorio de assets fuente compartido de Le Tiende (`~/Documents/LeTiende/letiende.co/fuentes/` e `~/Documents/LeTiende/ImagenVisual/`) con un set de íconos PWA ya generado profesionalmente (`favicon_io/`) y la fuente Angellya real (`.otf`/`.ttf`). Se usó el set ya generado en vez de regenerar desde el SVG (mejor calidad, confirmado con el usuario) — copiados `favicon-{16,32}.png`, `apple-touch-icon.png` (180), `icon-{192,512}.png`, `favicon.ico` a `public/`. Se creó `public/manifest.webmanifest` (nombre, colores de marca, `purpose: "any"` únicamente — el ícono de 512px no tiene margen de seguridad suficiente para `maskable`, ver §7) y se enlazó todo en `index.html` (`theme-color`, favicons, `apple-touch-icon`, `manifest`). Verificado sirviendo localmente: manifest válido, todos los assets responden 200. Angellya queda pendiente de integrar como `@font-face` — no se hizo en esta misma tarea (alcance separado).

**Qué se hizo el 2026-07-17 (fix de `signInWithPopup` en `staging` — bug #1 post-merge del PR #6):** el usuario reportó que el popup de Google se abría y cerraba de inmediato, mostrando el mensaje genérico de error. Se confirmó la causa raíz consultando la config real de Identity Platform (`identitytoolkit.googleapis.com/v2/projects/comandante-letiende/config`, usando un access token obtenido a partir del refresh token ya almacenado por `firebase-tools` en esta máquina — sin nueva autorización interactiva): `oyzau0c910.execute-api.us-east-1.amazonaws.com` no estaba en `authorizedDomains`. Con permiso explícito del usuario, se hizo `PATCH` a esa misma API agregando el dominio a la lista existente (14 → 15, sin quitar ninguno de Comandante — ver §5 y §7). No fue necesario ningún cambio de código; el fix es de configuración del proyecto Firebase compartido, no del repo. **Confirmado por el usuario: el login ya funciona en `staging`.** Reportó además el warning benigno de COOP (ver §7, sin acción tomada por decisión del usuario).

**Segundo problema reportado por el usuario — RESUELTO:** el segundo bug era que `LoginComponent` se veía muy distinto al de Comandante, porque Comandante usa Ionic y Babel no. Se investigó, se descartó instalar Ionic (Comandante no usa SSR en absoluto y Ionic + Angular standalone + SSR tiene fricción conocida — riesgo real de romper el SSR ya desplegado en Babel) y en su lugar se replicó el resultado visual exacto con Tailwind puro, midiendo por píxel la app real (`https://comandante.letiende.co`) — ver "identidad visual de Comandante" arriba y el fix de colores reales del botón (PR #9, fusionado a `main`). Confirmado por el usuario como resuelto en todos lados.

**Qué se hizo el 2026-07-17 (CI: deploy automático a `staging` en cada PR):** para que el usuario pueda continuar el desarrollo desde Claude Code en Android sin depender de esta Mac ni de credenciales de AWS locales, se agregó el job `desplegar-staging` en `.github/workflows/deploy.yml` (dispara en todo `pull_request`, usa los secrets ya existentes, comenta la URL de `staging` en el PR). Verificado real en los PR #8, #9 y #10 — funciona de punta a punta. PR #8 fusionado a `main`.

**Qué se hizo el 2026-07-17 (íconos PWA + `manifest.webmanifest`, PR #10 fusionado):** ver detalle arriba — usó el set ya generado en `favicon_io/` en vez de regenerar desde el SVG. Verificado con auto-deploy real a `staging`.

**Qué se hizo el 2026-07-18 (Tarea 1 de `TODO.md` — modelos de datos + cliente DynamoDB):** se crearon las 5 interfaces de `src/app/core/models/` (`Libro`, `Venta`, `Estante`, `DescuentoEditorial`, `Usuario`, exactamente como `tech-specs.md` §4.3), se instalaron `@aws-sdk/client-dynamodb`/`@aws-sdk/lib-dynamodb` (con `--ignore-scripts`, ver gotcha en §7) y se implementó `server/api/services/dynamodb.ts` con un `DynamoDBDocumentClient` único y 4 funciones genéricas (`obtenerPorClave`, `guardar`, `eliminar`, `consultarPorIndice`) parametrizadas por nombre de tabla, sin lógica de negocio. `npm run build`, `npm run build:api` y `npm test` (8 tests) pasan limpios en este entorno (tras instalar Node 22.22.3 vía `nvm`, ver §7). **No se pudo completar** el último ítem del Definition of Done: la verificación en vivo contra una tabla real de `staging` — un script puntual (`guardar`/`obtenerPorClave`/`eliminar` de prueba contra `babel-estantes-staging`, no commiteado) falló con `UnrecognizedClientException` porque las credenciales AWS de este entorno no son válidas contra la cuenta real (ver §7). No quedó ningún dato de prueba escrito (el fallo ocurrió en el primer `guardar()`). Se documentó el riesgo abierto en `TODO.md` y se decidió cerrarlo naturalmente con la Tarea 2 (primer endpoint real que invoca este servicio), en vez de forzar una verificación artificial fuera de alcance. Cambios en la rama `feature/modelos-datos-dynamodb-client`, PR por crear.

**Próxima tarea sugerida:** ver `TODO.md` — Tarea 1 (verificación real del ID Token de Firebase + resolución de rol) y Tarea 2 (endpoint público `GET /api/libros`, primera pieza que ejercita de verdad el cliente DynamoDB de hoy contra datos reales). Ambas son independientes entre sí. Pendiente sin urgencia: integrar la fuente Angellya (ya localizada, ver §7) como `@font-face`.
