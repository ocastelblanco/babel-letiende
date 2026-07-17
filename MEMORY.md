# MEMORY.md — Babel

Memoria de arquitectura y estado del proyecto. Actualizar al cierre de cada sesión de trabajo relevante.

---

## 1. Estado actual

| Campo | Valor |
|---|---|
| Versión | Sin release — proyecto en fase de arranque (solo documentación) |
| URL producción | https://babel.letiende.co (aún no desplegada) |
| Rama principal | `main` |
| Rama de trabajo actual | `claude/babel-project-bootstrap-k7bhww` |
| Última sesión | 2026-07-17 — Bootstrap de documentación inicial (2026-07-16) + precisión del modelo de descuento editorial vs. descuento de venta (2026-07-17) |

---

## 2. Funcionalidades completadas vs. pendientes

- [ ] Scaffold del proyecto (Angular 22 + SSR + Serverless Framework)
- [ ] Autenticación con Google (Firebase Auth) + resolución de rol
- [ ] Flujo de catalogación (escaneo → metadatos → PVP → estante)
- [ ] Registro de venta
- [ ] Catálogo público de consulta (SSR)
- [ ] Cambio de estante de un libro catalogado
- [ ] Configuración de estantes (CRUD, admin)
- [ ] Configuración de descuentos de editorial (CRUD, admin)
- [ ] Gestión de usuarios (CRUD, admin)
- [ ] Reportes de ventas + exportación XLSX (admin)
- [ ] `DESIGN.md` propio de Babel

Ningún ítem está implementado todavía; el repositorio solo contiene `README.md`, `LICENSE`, `.gitignore` y los documentos de este bootstrap.

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

---

## 4. Dependencias instaladas

Ninguna todavía — el `package.json` se crea en la Tarea 1 de `TODO.md`. Dependencias previstas según `tech-specs.md` §2: Angular 22.x, Tailwind CSS 4.x, `firebase` (SDK cliente) + `firebase-admin` (backend), `xlsx`, `@zxing/browser`, `cheerio`, Serverless Framework 4.x, `aws-sdk`/`@aws-sdk/client-dynamodb`.

---

## 5. Configuraciones vigentes

Ninguna todavía (sin cuentas AWS/Firebase/dominio configuradas en esta sesión). Pendiente registrar aquí, a medida que se creen: ID de proyecto Firebase, ARNs de recursos AWS, nombres exactos de tablas DynamoDB desplegadas, IDs de distribución si aplica CDN, y la configuración de dominio `babel.letiende.co` en Route53/API Gateway.

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

Se irán agregando hallazgos reales durante la implementación (actualmente son anticipados por analogía con Comandante y con el stack elegido, no verificados en código real).

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

**Qué se hizo el 2026-07-17:** el usuario precisó que existen dos descuentos distintos e independientes — descuento editorial (margen de consignación, 100% si el libro es propio de Le Tiende) y descuento de venta (discrecional del vendedor). Se ajustaron `PRD.md` (§5.2, §5.4, §5.6, §7, §10), `tech-specs.md` (§4.3 modelos de datos con snapshot de costo/utilidad en `Venta`, §5 endpoints, §5.1 decisión de diseño) y este documento (ADR-006) para reflejarlo con precisión. Cambios enviados a la misma rama/PR (`claude/babel-project-bootstrap-k7bhww`) para aprobación conjunta.

**Próxima tarea sugerida:** ver `TODO.md` — Tarea 1 (scaffold del proyecto Angular) y Tarea 2 (esqueleto de Serverless Framework + tablas DynamoDB).
