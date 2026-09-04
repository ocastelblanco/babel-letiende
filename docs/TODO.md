# TODO.md — Babel

Motor JIT: este documento mantiene **siempre exactamente 2 tareas atómicas** activas. Al completar cualquiera, se elimina, se mueve el resumen a `MEMORY.md` §2, y se calcula la siguiente tarea más prioritaria comparando `PRD.md` (roadmap) contra `MEMORY.md` (estado actual).

**Prioridad de selección aplicada (2026-07-27):** el usuario cerró su ronda de pruebas manuales en `staging` (pausa iniciada 2026-07-25 tras `ajustes-finales.md` Tareas A-G) y entregó un nuevo lote de ajustes en `ajustes-2026-07-27.md`. El motor JIT se retoma con las 3 tareas que ese documento describe para Babel, en el orden en que aparecen en el documento, **antes** de las 2 últimas piezas del roadmap (modo offline, producción) que quedaron en pausa — instrucción explícita del usuario. La cuarta pieza de `ajustes-2026-07-27.md` — el generador de QR para imprimir — es una herramienta fuera de Babel (no vive en la app, no consume su API) y el usuario la excluyó deliberadamente de este orden: se rastrea aparte, en su propia pista independiente (ver sección al final), sin ocupar ninguno de los 2 slots activos.

**Tarea 1 completada (2026-07-27):** vista Lista/Tarjetas + orden Título/Autor/Precio en `CatalogoPublicoComponent` (PR #67, fusionado por el usuario). Se promueve el siguiente ítem del backlog (Reporte de ventas — Descuento de venta) al segundo slot activo.

**Tarea 1 (Gestionar > Editar) completada (2026-07-27):** todos los campos del libro editables + paneles como Catalogar (PR #69, probado por el usuario). Con esto se cierra el backlog completo de `ajustes-2026-07-27.md` salvo la pista independiente del generador de QR (ver más abajo). Queda un solo ajuste pendiente de esta ronda (Reporte de ventas) — se promueve **Modo offline** al segundo slot activo como siguiente pieza del roadmap, pero no debe iniciarse hasta cerrar también el Reporte de ventas y confirmar con el usuario que no hay más ajustes de esta ronda.

**Reporte de ventas completado (2026-07-27):** columna "Descuento de venta" en `handlerExportar` (PR #70, probado por el usuario en `staging`). Con esto se cierra el backlog completo de `ajustes-2026-07-27.md` — solo queda pendiente la pista independiente del generador de QR (ver más abajo), que el usuario confirmó dejar para después. El roadmap principal retoma sus últimas 2 piezas (`PRD.md` §6): el usuario eligió explícitamente **Modo offline primero**, luego Producción — se llenan los 2 slots activos en ese orden.

**Modo offline CANCELADO (2026-07-27, decisión explícita del usuario):** antes de planear la implementación (se llegó a producir un plan completo, descartado sin código), el usuario decidió cancelarlo por completo — los cortes de wifi en la librería son muy infrecuentes (menos de 1 al mes) y ya se resuelven compartiendo datos móviles del celular con el que se cataloga; no se justifica el costo de mantener una cola de sincronización. Ver `PRD.md` §6/§9 para el detalle. En su lugar, el usuario trajo 2 ajustes nuevos a los reportes, que ocupan los 2 slots activos antes de retomar Producción.

**Reportes de ventas e inventario completados (2026-07-27):** las 2 tareas de arriba se fusionaron (PR #72, PR #73) y el usuario las probó en `staging` — funcionan bien. Con esto se cierra por completo `ajustes-2026-07-27.md`, salvo la pista independiente del generador de QR (el usuario confirmó dejarla para después). Ya no queda ningún otro ajuste pendiente antes de producción.

**Solo 1 tarea activa (sin item para el segundo slot):** el único ítem que le queda al roadmap principal (`PRD.md` §6) es "Primer despliegue a producción" — no hay un segundo ítem que promover (mismo caso ya documentado el 2026-07-25 al cerrar `ajustes-finales.md`). La pista del generador de QR sigue deliberadamente fuera de los slots del motor JIT por decisión del usuario.

**Pista independiente del generador de QR — COMPLETA (2026-07-29):** `tools/qr-muebles/` implementado, revisado (2 rondas de `architect`) y fusionado (PR #76) — detalle completo movido a `MEMORY.md` §2. Sin pendientes salvo que el usuario confirme el escaneo físico con celular real antes de imprimir el lote completo (no bloquea nada de este documento).

**Prioridad de selección aplicada (2026-07-29):** el usuario trajo un nuevo lote de 4 ajustes a Babel (3 fixes + 1 pregunta/fix, ninguno documentado antes en `PRD.md`/`ajustes-*.md`). Se investigó el código real (desplegables de ubicación física, componente Catalogar, librería de escaneo `@zxing/browser`, modelo de datos `Libro`) antes de escribir las tareas — hallazgo clave: `bookId` es la clave primaria real, `isbn` es un índice secundario nullable SIN validación de unicidad hoy (el mismo ISBN puede tener N registros). Se resolvieron 2 preguntas de producto con el usuario antes de detallar el alcance.

**Tarea 1 (orden alfabético) y Tarea 2 (mejoras a Catalogar) — COMPLETAS (2026-07-30/31, PR #78 y PR #79 fusionados):** detalle completo movido a `MEMORY.md` §2. La Tarea 2 incluyó una revisión de `architect` que encontró y corrigió una condición de carrera real (pérdida de inventario al fusionar el mismo duplicado desde 2 sesiones casi simultáneas) y un hotfix de deploy (descripción de función Lambda excedía 256 caracteres, reincidencia del gotcha ya documentado — ver `MEMORY.md` §7 reforzado). El usuario ajustó manualmente el aspect ratio de la cámara de 3:1 a 2:1 tras probarlo.

**Prioridad de selección aplicada (2026-07-31):** con las 4 tareas de este lote cerradas y sin más ajustes pendientes, el único ítem que le queda al roadmap principal (`PRD.md` §6) es "Primer despliegue a producción" — se promueve al único slot activo (sin segundo ítem que promover, mismo caso ya documentado el 2026-07-25 y el 2026-07-29). **El usuario pidió explícitamente dejar todo listo (repo sincronizado, documentación al día) pero NO iniciar la implementación/despliegue hasta que él lo indique** — respeta la regla ya vigente de no arrancar esta pieza sin confirmación explícita.

**Reforma del header superior — TAREA NUEVA (2026-08-18):** el usuario trajo un ajuste ad-hoc nuevo no documentado previamente en `PRD.md`. Se trata de reemplazar el header actual (texto plano, sin logo) por un nuevo componente `BarraNavegacionComponent` (mismo patrón que usa el proyecto hermano Ágora): logo + nombre "Babel" como link a home, menú reposicionado, botón de ícono para "Ingresar", avatar de Google + botón "Cerrar sesión" alineados a la derecha, responsive con drawer mobile, y renombre de la ruta/link "Gestionar" a "Catalogar" (solo texto/ruta, sin renombrar el componente). Este ajuste toma el único slot activo del motor JIT por delante de "Primer despliegue a producción" (aplicando el mismo criterio de priorización de ajustes ad-hoc ya documentado en 2026-07-27, 2026-07-29 y 2026-07-31). La tarea se entrega en una sola rama/PR (`feature/reforma-header-superior`) para desplegar a producción la misma noche tras validar en staging.

**Reforma del header — validada en `staging` (2026-08-18):** el usuario confirmó que todo funciona bien (PR #88). Se cierra la tarea abajo. En la misma revisión, el usuario recordó que **"Primer despliegue a producción" ya se había realizado** — este documento nunca lo registró porque el proyecto se congeló (pausa por catalogación de 3.000+ libros, ver `MEMORY.md`) justo después de completarlo. Se cierra también retroactivamente esa pieza y se revisó `PRD.md` §6 completo: con ambas cerradas (y "Modo offline" ya cancelado antes), **el roadmap principal queda completo** — no hay siguiente ítem que promover a ninguno de los 2 slots.

**Estado al cierre de sesión (03/09/2026, actualizado) — Integración con el proxy de `letiende.co`,
COMPLETA, todos los PRs fusionados y verificados en producción real:** pedido **externo** al roadmap de
este repositorio, coordinado desde el proyecto contenedor `letiende.co` (T-0014 en su `TODO.md`),
mismas decisiones de diseño que Ágora (T-0013). No ocupó ninguno de los 2 slots del motor JIT — el
roadmap principal sigue completo (ver arriba). Implementado en la rama `feature/proxy-letiende-co`,
**PR #111 fusionado (8 commits)**: `baseHref: /libros/`, barra de navegación común solo en el estado
sin sesión, sitemap apuntando a `letiende.co/libros`, y redirección 301 desde `babel.letiende.co` a
`babel.letiende.co/libros`.

Tras el primer despliegue real a staging, verificado con curl y con navegador real
(`claude-in-chrome`), aparecieron dos hallazgos más, ninguno anticipado por la planeación original,
**ya incorporados al PR #111**:

- El sitemap no respondía a través del proxy (`staging.letiende.co/libros/sitemap.xml`) — CloudFront
  reenvía la ruta completa con el prefijo (sin `OriginPath`), pero el API Gateway de esta app solo
  tenía registrada `/sitemap.xml` sin prefijo. Se agregó un segundo evento `httpApi`
  (`/libros/sitemap.xml`) a la nueva función `librosSitemap`.
- Las llamadas a la API propia (`/api/libros`, `/api/espacios`, `/api/muebles`, `/api/ubicaciones`) no
  llegaban a esta app cuando la página estaba embebida — son rutas **absolutas**, y el navegador las
  resuelve contra el ORIGEN de la página, ignorando el `<base href>` por completo. Se extendió el
  `absoluteUrlInterceptor` (ya existía para el caso SSR) para anteponer `/libros` a las llamadas
  `/api/*` en el navegador cuando `EmbebidoService.embebido` es `true`. Verificado con navegador real:
  las 4 llamadas de API responden 200 con el prefijo correcto, catálogo carga libros reales, sin
  errores de consola.

**Un tercer hallazgo más, real incidente de producción, PR #112 (`fix/redirige-mismo-dominio-hasta-cutover`),
fusionado (03/09/2026), reportado en vivo por el humano — mismo hallazgo y mismo fix ya aplicados
primero en Ágora (PR #63 de `agora-letiende`):** la redirección de `/`/`libro/:bookId`, diseñada
CROSS-DOMAIN a `letiende.co/libros/...` para consolidar SEO, se desplegó a producción antes de que el
cutover real de `letiende.co` (T-14/T-15, todavía pendiente) hiciera que ese destino existiera —
`letiende.co` en producción sigue sirviendo el sitio estático viejo, sin ninguna ruta `/libros`. Como
`babel.letiende.co` es hoy el único acceso público real, quedó roto. Corregido colapsando las dos ramas
en una sola: toda ruta redirige mismo dominio con el prefijo mientras el cutover no ocurra. Verificado
con `aws lambda invoke` directo contra `babel-letiende-staging-ssr` con un evento simulado (`Host:
babel.letiende.co`) y, tras la fusión, con `curl` real en producción: `https://babel.letiende.co/` →
301 → `https://babel.letiende.co/libros/` → 200.

Detalle técnico completo de los 3 hallazgos en `docs/MEMORY.md` §2 de este repositorio, y en
`docs/MEMORY.md`/`docs/TODO.md` de `letiende.co` y de `agora-letiende`. **Sin pendientes** — la
integración está completa y en producción. Lo único que falta para que la redirección cross-domain de
`/`/`libro/:bookId` pueda restaurarse es el cutover real de `letiende.co` (T-14/T-15), que no es una
tarea de este repositorio.

---

## Tarea 1 — Reforma del header (menú superior) — COMPLETA (2026-08-18)

Implementación del nuevo componente `BarraNavegacionComponent` en `src/app/shared/navegacion/` siguiendo el patrón de Ágora — PR #88, validado por el usuario en `staging`:

- [x] Logo + nombre "Babel" como link a home (`<a routerLink="/"> <img src="/logo_negro_sin_fondo.svg"> <span>Babel</span> </a>`), reemplaza el link "Catálogo" del header actual.
- [x] Elimina el link "Volver al catálogo" de la card de login y de la ficha de libro (`/libro/:bookId`, agregado en un ajuste posterior dentro del mismo PR).
- [x] Nuevo componente `BarraNavegacionComponent` (`src/app/shared/navegacion/`) con soporte responsive completo (menú hamburguesa/drawer mobile).
- [x] Botón de ícono reemplaza al link de texto "Ingresar" (`h-10 w-10 rounded-xl bg-primary text-neutral`, `aria-label="Ingresar"`).
- [x] Avatar de Google + botón "Cerrar sesión" reemplazan al link de texto "Cerrar sesión" (`<img referrerpolicy="no-referrer" class="h-8 w-8 rounded-full object-cover">`, botón `h-10 rounded-xl border border-primary/20 px-3 text-sm font-semibold text-primary`), alineados a la derecha.
- [x] Renombra el link/ruta "Gestionar" (`/gestionar`) a "Catalogar" (`/catalogar`) — solo texto/ruta, sin renombrar `GestionarComponent`.

---

## Tarea 2 — Primer despliegue a producción — COMPLETA (cierre retroactivo, 2026-08-18)

Se ejecutó realmente entre el 31/07/2026 y el 03/08/2026, sin haber sido marcada como cerrada en este documento en su momento (el proyecto pasó directo a la pausa de catalogación tras terminarla):

- Dominio personalizado `babel.letiende.co` (PR #81, 2026-07-31).
- Fix de `NG_ALLOWED_HOSTS` en el Lambda `ssr` para aceptar el dominio personalizado (PR #82, 2026-07-31).
- Datos reales de ubicación física (espacios/muebles/ubicaciones) poblados directamente en DynamoDB de producción (2026-08-01).
- Lanzamiento público confirmado en `README.es.md` (producción: 03/08/2026).

---

## Roadmap principal completo (histórico, 2026-08-18)

Con las 2 tareas de arriba cerradas, y "Modo offline" ya cancelado (2026-07-27, ver bitácora arriba), **`PRD.md` §6 no tenía más ítems pendientes** — todo lo "Alta"/"Media" implementado, y de las "Baja" solo quedaba "Empaquetado nativo (Capacitor)", deliberadamente fuera de alcance (`CLAUDE.md` §2). El motor JIT se quedó sin tareas activas por primera vez desde el inicio del proyecto — hasta el mismo día, cuando el usuario trajo un lote nuevo de 3 ajustes (ver abajo).

---

**Lote nuevo (2026-08-18):** el usuario detectó 3 problemas reales en producción — (1) portadas placeholder de scraping aceptadas como válidas, (2) PVPs sospechosos en libros ya catalogados sin forma de re-verificarlos en bloque, (3) catalogar un libro sin ISBN falla (bug real: el GSI `isbn-index` de `babel-libros` rechaza el atributo `isbn` presente-con-valor-`null`, debe estar ausente). Se investigó el código real (scraping.ts, metadatos.ts, libros.ts, serverless.yml, admin UI) antes de escribir las tareas y se resolvieron 4 preguntas de diseño con el usuario (regla de consenso de PVP simplificada a "el más alto como referencia"; chequeo de portada inválida global, no por sitio de origen; arquitectura async = Lambda auto-invocada por lotes + tabla de progreso, sin Step Functions/SQS; libros sin ISBN se saltan solo la validación de PVP). Se ordenan 3 tareas atómicas, cada una en su propia rama/PR: la Tarea 3 (proceso de "Validar libros" asíncrono) depende de que la Tarea 2 exista primero (necesita el campo `palabrasClaveInvalidas` en `SitioScraping`), y la Tarea 1 (bugfix aislado, bajo riesgo) se saca primero por ser independiente.

---

## Tarea 1 — Permitir catalogar libros sin ISBN — COMPLETA (2026-08-18)

`server/api/services/dynamodb.ts` + `server/api/handlers/libros.ts` — el atributo `isbn` debe omitirse del ítem (no guardarse como `null`) antes de `PutCommand`/`UpdateCommand`, porque el GSI `isbn-index` lo tipa `S` y un índice disperso exige que el atributo esté ausente, no `null`, para quedar fuera del índice. PR #89, validado por el usuario en `staging` ("Funciona bien").

- [x] Nueva función `omitirCamposNulos` en `dynamodb.ts`.
- [x] Aplicada en `handlerCrear`/`handlerEditar` antes de `guardar()`. `fusionarLibroDuplicado` (`UpdateCommand`, no `PutCommand`) tenía el mismo bug por una ruta distinta — corregido con `REMOVE #isbn` condicional en vez de `SET #isbn = :isbn`, hallazgo del agente durante la implementación, no anticipado en el plan original.
- [x] Tests nuevos en `libros.spec.ts` (objeto guardado sin la clave `isbn`, respuesta HTTP con `isbn: null` intacto).
- [x] Validado por el usuario en `staging`.

Sin cambios de documentación de fondo (bugfix, no cambio de comportamiento visible) — solo esta entrada de bitácora.

---

## Tarea 2 — Palabras clave que invalidan una portada de scraping — COMPLETA (2026-08-19)

Nuevo campo `palabrasClaveInvalidas: string[]` en `SitioScraping` (propagado a las 3 copias del tipo), helper `portadaEsInvalida()` en `scraping.ts`, wiring en `metadatos.ts` (el llenado de `portadaUrl` por prioridad descarta candidatos inválidos y pasa al siguiente sitio), y control nuevo en `GestionSitiosScrapingComponent` (input de palabras separadas por coma). PR #90, validado por el usuario en `staging` ("Funciona bien").

- [x] Modelo + validación backend (3 copias del tipo, default `[]`).
- [x] `portadaEsInvalida()` + wiring en `resolverMetadatosCompletos`.
- [x] Control nuevo en el formulario de `GestionSitiosScrapingComponent`.
- [x] Tests (`portadaEsInvalida`, `metadatos.spec.ts`, `sitios-scraping.spec.ts`, `gestion-sitios-scraping.component.spec.ts`).
- [x] `docs/tech-specs.md` (modelo `SitioScraping`), `docs/PRD.md` §5.2 (mención breve).

**Bug real encontrado por el usuario durante la validación en `staging` (mismo PR, commit adicional):** `/admin/sitios` aparecía incompleta (sin botones "Eliminar", solo el primer sitio con info visible) — las filas de `babel-sitios-scraping` guardadas antes de esta tarea no tienen el atributo `palabrasClaveInvalidas` (el `Scan` de DynamoDB devuelve el ítem tal cual quedó guardado, sin aplicar el default `[]`, que solo se aplicaba en el path de escritura). `GestionSitiosScrapingComponent` leía `.length`/`.join()` sobre `undefined` y lanzaba al renderizar esa fila. El mismo hueco rompía, más grave, `GET /api/metadatos/:isbn` (ruta crítica de catalogación) con `500` en cuanto un sitio viejo con `info`/`pvp` en `true` lograba scrapear una portada. Corregido normalizando `palabrasClaveInvalidas ?? []` en los 2 puntos de lectura (`sitios-scraping.ts` GET, `metadatos.ts`), más guardas `?? []` en el componente (no depender solo de la normalización del backend). Tests de regresión en los 3 archivos — ver `MEMORY.md` §7 (gotcha nuevo) y §2.

Con esto se cierra el lote de 3 ajustes de catalogación traído el 2026-08-18 (Tarea 1 isbn nulo, Tarea 2 palabras clave de portada) — solo queda la Tarea 3 (backlog), que se promueve abajo.

**Tarea 3 completa (2026-08-19, ver detalle abajo):** con el diseño (PR #91), el backend (PR #92) y el frontend fusionados y validados, se cierra por completo el lote de 3 ajustes de catalogación del 2026-08-18. Se revisó `PRD.md` §6 completo: con "Validar libros" marcado completado, el roadmap principal no tiene más ítems pendientes salvo "Empaquetado nativo (Capacitor)", deliberadamente fuera de alcance (`CLAUDE.md` §2) — mismo caso ya documentado el 2026-07-25/07-29/07-31/08-18. El motor JIT queda sin tareas activas hasta que el usuario traiga un nuevo lote de ajustes.

---

## Tarea 3 — Proceso asíncrono "Validar libros" (PVP + portada, por mueble) — COMPLETA (2026-08-19)

La más grande de las 3 del lote — primer patrón asíncrono del proyecto (Lambda `validarLibrosWorker` auto-invocada por lotes + tabla `babel-validaciones-libros` de progreso + polling desde el frontend), 3 funciones Lambda nuevas, componente admin nuevo `ValidarLibrosComponent` en `/admin/validar-libros`. La Tarea 2 (`palabrasClaveInvalidas`/`portadaEsInvalida`) de la que dependía está cerrada y validada.

**Decisiones de diseño ya resueltas con el usuario (2026-08-18, ver bitácora arriba):** regla de consenso de PVP simplificada a "el más alto como referencia"; chequeo de portada inválida global, no por sitio de origen; arquitectura async = Lambda auto-invocada por lotes + tabla de progreso, sin Step Functions/SQS; libros sin ISBN se saltan solo la validación de PVP.

**Diseño detallado — COMPLETO (2026-08-19, PR #91):** el detalle fino que no estaba persistido en ningún documento (modelo exacto de `babel-validaciones-libros`, contrato de las 3 Lambdas, permisos IAM incluida la auto-invocación, tamaño de lote, forma del polling desde el frontend) quedó resuelto en `docs/plan-validar-libros-async.md`, con ADR-012 nuevo en `docs/MEMORY.md` §3 justificando la arquitectura (sin Step Functions/SQS) y referencias agregadas en `docs/tech-specs.md` (§5, §5.1, §11) y `docs/PRD.md` (§5.6, §6).

- [x] Backend — COMPLETO (2026-08-19, PR #92, validado por el usuario en `staging`: "Funciona bien"): tabla `babel-validaciones-libros`, 3 funciones Lambda (`handlerIniciar`, `handlerWorker`, `handlerConsultar` en `server/api/handlers/validaciones-libros.ts`) + roles IAM (incluida la auto-invocación con ARN por convención) + tests unitarios (28 nuevos: consenso de PVP, agrupación por mueble, portada pendiente vs. corregida, auto-invocación, corridas colgadas). Nueva dependencia `@aws-sdk/client-lambda`. De paso corrigió un gotcha desactualizado en `MEMORY.md` §7 (`npx serverless print` sí detecta hoy descripciones de Lambda >256 caracteres).
- [x] Frontend — COMPLETO (2026-08-19, PR pendiente de abrir): `ValidacionesLibrosService` (`core/api/`) + `ValidarLibrosComponent` en `/admin/validar-libros` (`RoleGuard('administrador')`), según el contrato de `docs/plan-validar-libros-async.md` §7 — botón "Iniciar validación", barra de progreso, mueble actual, contadores de PVP/portada en vivo, lista final de `portadasPendientes`/`erroresLibro`. Manejo explícito del `409` (retoma la corrida en curso en vez de bloquear). 17 tests nuevos (345 frontend en total). **Bug real encontrado y corregido en la propia tarea:** si se perdía la conexión durante el polling, el resumen `en_progreso` quedaba congelado en el Signal y el botón nunca se reactivaba — corregido limpiando el resumen al detectar la corrida perdida. Pendiente de validación del usuario en `staging`.

Con esto se cierra por completo la Tarea 3 y el lote de 3 ajustes de catalogación traído el 2026-08-18 (Tarea 1 isbn nulo, Tarea 2 palabras clave de portada, Tarea 3 validar libros).

**Bug real encontrado por el usuario en `staging` (2026-08-19, mismo PR del frontend, commit adicional):** el botón "Iniciar validación" respondía `500`. Causa raíz: `IniciarValidacionLambdaRole` solo tenía `dynamodb:Scan` sobre `babel-usuarios`, pero el código resuelve el rol del administrador con `GetItem` — desajuste invisible para tests (mockean `obtenerPorClave`) y para `serverless print`/`package`. Corregido en `serverless.yml`. Ver `MEMORY.md` §2/§7 para el detalle completo.

---

**Selector manual de portada — TAREA NUEVA (2026-08-19):** el usuario trajo un ajuste ad-hoc nuevo, no documentado previamente en `PRD.md`. Algunas portadas placeholder de scraping usan URLs con un ID individual, sin ninguna palabra clave detectable por `portadaEsInvalida` (Tarea 2) — para esos casos, un vendedor/administrador que nota una portada genérica o incorrecta (al catalogar o al editar) puede pedir, con un botón, todas las portadas candidatas encontradas en vivo en los sitios de scraping autorizados y elegir la correcta a ojo. Se planeó en sesión con `Plan` mode (3 preguntas de producto resueltas con el usuario: alcance solo por ISBN v1, sitios `info: true`, excluir del listado las portadas ya conocidas como inválidas) antes de escribir código — plan completo disponible en el historial de la conversación, no se persistió como documento separado por ser de escala comparable a la Tarea 2 (sin tabla ni infraestructura nueva).

## Tarea — Selector manual de portada por ISBN (Catalogar/Editar) — COMPLETA (2026-08-19)

- [x] Backend: `GET /api/metadatos/:isbn/portadas` (`handlerBuscarPortadas` en `server/api/handlers/metadatos.ts`) — `resolverPortadasCandidatas` reutiliza `scrapearSitio`/`portadaEsInvalida` (`scraping.ts`) tal cual existen, devuelve TODAS las portadas válidas de los sitios `info: true` (no solo la primera por prioridad, a diferencia de `resolverMetadatosCompletos`), ordenadas por `prioridad`. Nueva función Lambda `metadatosPortadas` + rol IAM `MetadatosPortadasLambdaRole` (verificado acción por acción contra `dynamodb.ts`, lección del incidente de IAM del mismo día). 9 tests nuevos (343 backend en verde).
- [x] Frontend: `MetadatosService.buscarPortadas()` + `SelectorPortadaComponent` nuevo en `src/app/shared/` (primer componente compartido con lógica/estado real del proyecto, `input()`/`output()` signal-based de Angular 22) — diálogo con grid de portadas candidatas, selección en 2 pasos (elegir tarjeta, confirmar con "Cambiar"). Wiring en `CatalogarLibroComponent` y `EditarLibroComponent`: botón de ícono (refrescar) junto al thumbnail de portada, deshabilitado sin ISBN. `EditarLibroComponent` no tenía thumbnail de portada — se agregó igual que ya existía en Catalogar (pedido explícito del usuario). 21 tests nuevos (363 frontend en total).
- [x] **Hallazgo real de Angular durante las pruebas (no relacionado con el feature en sí):** `formulario.controls.X.setValue(valor)` seguido de `fixture.detectChanges()` NO actualiza un `@if` del template que lee `formulario.controls.X.value` directamente — confirmado en un repro aislado, reproducible también contra el código YA EXISTENTE antes de esta tarea (no es un bug introducido). Sí funciona disparando un evento DOM `input` real (`campo.dispatchEvent(new Event('input'))`), el mismo patrón que ya usaban todos los tests de este archivo que sí verifican DOM. Ver gotcha nuevo en `MEMORY.md` §7.
- [x] `npm run build:api`, `npm run build`, `npx serverless print --stage dev` y `npx serverless package --stage dev` verificados sin errores. Smoke test con `ng serve` + `curl /catalogar` (200, sin crash).
- [x] Verificación visual interactiva del usuario en `staging` con login real — exitosa.

Con esto queda cerrada la tarea completa (diseño, backend, frontend y verificación en vivo); sin tareas activas hasta el próximo lote de ajustes del usuario.

---

**Adaptadores de scraping nuevos — TAREA AD-HOC (2026-08-20):** el usuario agregó dos sitios en `/admin/sitios` (`production`): Casa Tomada y Librería de la U. No traían portada/datos al catalogar. Diagnosticado antes de tocar código: `babel-sitios-scraping-production` (verificado con `aws dynamodb scan`) tenía ambos dominios bien capturados — no fue un error de la interfaz de administración. La política (tabla) y el mecanismo (adaptador de código, `ADAPTADORES_POR_DOMINIO` en `scraping.ts`) son cosas separadas por diseño (ADR-010); un sitio en la lista sin adaptador se omite en silencio, sin ningún error visible.

## Tarea — Adaptadores de scraping para Casa Tomada y Librería de la U — COMPLETA (2026-08-20)

- [x] Investigado en vivo contra ambos sitios reales antes de escribir código: Librería de la U corre la misma API pública VTEX que Lerner/Nacional (mismos campos `Autor`/`Editorial` que Lerner); Casa Tomada corre exactamente la misma plataforma que Tornamesa (misma ruta de búsqueda, mismo JSON-LD `Book` de producto).
- [x] `scrapearLibreriaDeLaU` reusa `consultarApiVtex` sin cambios. `consultarTornamesa` generalizada a `consultarPlataformaListaLibros(urlBase, query)`, compartida por Tornamesa y la nueva `scrapearCasaTomada`.
- [x] Ambos dominios agregados a `ADAPTADORES_POR_DOMINIO`.
- [x] 4 tests nuevos con fixtures basados en respuestas reales (347 tests backend en verde, antes 343).
- [x] `docs/tech-specs.md` (conteo de sitios con adaptador + nota sobre política vs. mecanismo), `docs/MEMORY.md` §2.

Fuera de alcance a propósito: `handlerBuscar`/`buscarPvpPorTexto` (búsqueda por título/autor sin ISBN, `metadatos.ts`) no se tocaron — ya excluían deliberadamente sitios sin datos completos en la misma respuesta (costo N+1, decisión de PR #48). Verificado por el usuario en `production` ("Todo funciona bien"). Con esto queda cerrada la tarea; sin tareas activas hasta el próximo lote de ajustes del usuario.

---

**Bug real reportado por el usuario en `production` (2026-08-29):** el buscador de "Catalogar > Editar" se bloqueaba y no filtraba nada al escribir un título o autor. Dos correcciones previas no lo resolvieron por atacar la hipótesis equivocada — CloudWatch nunca mostró ningún error porque el fallo nunca llegó al Lambda.

## Tarea — Fix del buscador de "Catalogar > Editar" — COMPLETA (2026-08-29)

- [x] **Intento 1 (PR #101):** `escanearTodo`/`escanearMayorQue`/`escanearProyeccion` no seguían `LastEvaluatedKey` de un `Scan` de DynamoDB (límite ~1MB por página) — con `babel-libros` ya sobre 2.000+ libros, solo se traía la primera página. Corregido con `escanearPaginado()` compartido. Necesario y correcto, pero no era la causa de este bug puntual.
- [x] **Intento 2 (PR #102):** consecuencia del intento 1 — varios `Scan` secuenciales podían superar el timeout por defecto (10s), sobre todo en cold start. Subido a 25s. Tampoco era la causa de este bug.
- [x] **Causa raíz real, encontrada con el stack de DevTools que aportó el usuario (PR #103):** un libro sin ISBN se persiste con el atributo `isbn` AUSENTE en `babel-libros` (`omitirCamposNulos`, PR #89 — el GSI `isbn-index` tipa `isbn` estrictamente `S`), así que `GET /api/libros/inventario` devolvía esos libros con `isbn` `undefined`, no `null`. El guard `libro.isbn !== null` de `editar-libro.component.ts` dejaba pasar el `undefined`, y `undefined.includes(...)` reventaba el `computed` `librosFiltrados`, tumbando el render de TODA la lista. Misma clase de bug que el gotcha de `palabrasClaveInvalidas` del 2026-08-19 (`MEMORY.md` §7) — un campo no-`undefined` en el tipo TS puede seguir ausente en datos ya persistidos.
- [x] Fix en dos capas: filtro del componente con `?? ''` en vez de comparar contra `null`; nuevo helper `normalizarLibro()` en `server/api/handlers/libros.ts` que restituye `isbn: null` en los 4 endpoints que devuelven libros crudos de DynamoDB.
- [x] 2 tests de regresión (el del componente reproduce el `TypeError` exacto sin el fix). 365 tests frontend / 354 backend en verde, build limpio.
- [x] `docs/MEMORY.md` §2 (bitácora completa de los 3 PRs) y §7 (gotcha nuevo).

Verificado por el usuario en `production` ("Funciona bien, ya fusioné el PR"). Con esto queda cerrada la tarea; sin tareas activas hasta el próximo lote de ajustes del usuario.

---

**Lote de 3 funcionalidades nuevas — TRAÍDO POR EL USUARIO (2026-08-29):** el usuario detectó que un mismo libro se catalogó **dos veces en la misma ubicación**, pese a la advertencia de duplicados que ya existe (Tarea 2.3, PR #79). El lote ataca el problema en tres frentes: prevenirlo al catalogar, detectar los casos ya existentes con un reporte, y dejar de mostrarlos como libros distintos en el catálogo público.

Diseño completo, decisiones de producto y desglose de tareas en **`docs/plan-duplicados-catalogacion.md`** (PR #105, docs-only). Las 4 ambigüedades reales se resolvieron con el usuario antes de escribir el plan: semántica del campo Cantidad (precargar el total y enviar la **diferencia** al endpoint atómico ya existente, conservando la protección contra la condición de carrera del PR #79); criterio de apilamiento (**solo por ISBN**, los libros sin ISBN no se apilan); cómo consultar Babel primero al buscar por título/autor (**índice ligero cacheado en el cliente** — `babel-libros` no tiene índice por título, así que un `Scan` por búsqueda caería sobre la ruta crítica de catalogación); y el PVP en la ficha apilada (**por panel**, con rango en la cabecera si difieren). 7 supuestos adicionales (§2 del plan) quedaron **confirmados por el usuario tal cual** el 2026-08-29, sin ajustes.

**Hallazgo de la revisión del código actual, que explica el incidente:** `seleccionarDuplicado` (`catalogar-libro.component.ts`) **sobrescribe silenciosamente el panel "Ubicación del libro"** con la ubicación del duplicado — el vendedor elige la ubicación B, escanea un ISBN que ya existe en A, y el formulario salta a A sin avisar. Además la advertencia actual no distingue "misma ubicación" de "otra ubicación", que es justo la diferencia que importa. Se corrige en la Tarea 1.

## Tarea 1 — Duplicados en catalogación: los dos flujos de advertencia — COMPLETA (2026-08-29)

- [x] `CatalogarLibroComponent`: nuevo `computed` `duplicadoEnMismaUbicacion` clasifica cada coincidencia contra `panelUbicacionId()` — reactivo, se reclasifica solo si el vendedor cambia el panel después de detectar el duplicado, sin volver a golpear el backend.
- [x] **Caso MISMA ubicación (bloqueante):** advertencia con el texto exacto pedido; `effect()` en el constructor deshabilita todo el formulario salvo `cantidadTotal` (que pasa a representar el TOTAL existente, no ejemplares nuevos) y cambia el botón a "Editar libro"; sin enlace de ignorar. Al guardar, se calcula el DELTA (`cantidadNueva - total existente`) y solo si es positivo se envía a `fusionar-duplicado` — un delta ≤ 0 muestra un mensaje que remite a la pestaña Editar, sin enviar nada.
- [x] **Caso OTRA ubicación (informativo):** el panel de ubicación **YA NO se sobrescribe** con la ubicación del duplicado — corregida la causa real del incidente reportado por el usuario. El botón sigue diciendo "Catalogar libro" y, al guardar, crea un `bookId` nuevo e independiente (`POST /api/libros`, nunca `fusionar-duplicado`) en la ubicación que el vendedor ya había elegido.
- [x] Invertido el orden de `dispararBusquedaPorIsbn`: Babel se consulta primero (`GET /api/libros/por-isbn/:isbn`); si el ISBN ya está catalogado, la búsqueda de metadatos externos **no se llama en absoluto**.
- [x] Sin backend nuevo — reutiliza `GET /api/libros/por-isbn/:isbn` y `POST /api/libros/:bookId/fusionar-duplicado` tal cual existían.
- [x] 9 tests nuevos/reescritos en `catalogar-libro.component.spec.ts` (369 tests frontend en verde, antes 365) cubriendo ambos casos, el cálculo del delta, el delta no positivo, la reclasificación al cambiar el panel, y que el panel ya no se sobrescribe. `npm run build` limpio. Smoke test `ng serve` + `curl /catalogar` (200, sin crash) — verificación visual interactiva con login real queda pendiente del usuario en `staging`.

Se promueve la Tarea 3 al segundo slot activo (con la Tarea 2, que sigue activa y sin empezar).

## Tarea 2 — Reporte de libros repetidos — COMPLETA (2026-08-29)

- [x] Backend: `GET /api/libros/exportar-repetidos` (`handlerExportarRepetidos`, Lambda propia, ADR-008, solo `administrador`), calcado del patrón de `handlerExportarInventario`. Agrupación por **componentes conexos** (`agruparPorIsbnOTitulo`, union-find sobre buckets `Map` por ISBN/título normalizado — evita el `O(n²)` de comparar cada par) — dos libros se unen si comparten ISBN o título normalizado; la relación encadena. `Motivo` (`ISBN`/`Título`/`ISBN y título`) se calcula por grupo, funciona también en grupos de 3+ formados por encadenamiento. Columnas: `Grupo`, `Motivo`, `libroId`, `ISBN`, `Título`, `Autor`, `Editorial`, `PVP`, `Espacio`, `Mueble`, `Ubicación`.
- [x] Frontend: `LibrosService.exportarRepetidos()` (mismo patrón de descarga de blob que `exportarInventario`, `descargarArchivo` parametrizado para el nombre de archivo) + tercer bloque "Reporte de libros repetidos" en `/admin/reportes` (`ReportesVentasComponent`), calcado del bloque de inventario.
- [x] 7 tests backend (`normalizarParaComparacion` + agrupación/encadenamiento/exclusión de grupos de 1) + 7 frontend nuevos (361 backend / 376 frontend en total). `npm run build`/`build:api`/`serverless print --stage dev`/`serverless package --stage dev` verificados sin errores (zip empaquetado con `libros.js`/`verificar-token.js`/`dynamodb.js`). Smoke test `ng serve` + `curl /admin/reportes` (200, sin crash) — verificación visual interactiva con login real queda pendiente del usuario en `staging`.

Se promueve la Tarea 4 al segundo slot activo (con la Tarea 3, que sigue activa y sin empezar).

## Tarea 3 — Babel como primera fuente al buscar por título/autor — COMPLETA (2026-08-29)

- [x] Backend: `GET /api/libros/indice` (`handlerIndice`, `escanearProyeccion` con los 8 campos mínimos). Rol IAM de solo lectura calcado de `LibrosInventarioLambdaRole`.
- [x] **Tamaño real medido contra `production`** (`aws dynamodb scan` con la misma proyección, 2026-08-29): 1.534 libros hoy, ~360 B/libro sin comprimir, ~100 B/libro con gzip. A 3.000 libros (volumen fundacional) el índice pesa ~300 KB comprimido — se decidió mantener `portadaUrl` pese a ser el campo más pesado, para conservar la miniatura de los candidatos de Babel.
- [x] Frontend: `LibrosService.cargarIndice()` cacheado una sola vez por sesión (`indiceSolicitado`); `buscarCandidatos()` filtra primero el índice en memoria (`filtrarIndice`, exige que título Y autor coincidan si ambos se escribieron) y solo cae a la búsqueda externa sin coincidencias. Los candidatos de Babel se marcan con la etiqueta "Ya en el catálogo".
- [x] Al elegir un candidato de Babel, se resuelve la ficha completa por `bookId` (`LibrosService.obtenerDetalle`) y entra por el mismo camino de duplicados de la Tarea 1 (`seleccionarDuplicado`, misma/otra ubicación) — reutilizado sin duplicar lógica. Ajuste retroactivo menor a `seleccionarDuplicado`: también precarga `isbn`.
- [x] 15 tests nuevos (5 backend + 4 `LibrosService` + 6 `CatalogarLibroComponent`) — 366 backend / 386 frontend en total. `build`/`build:api`/`serverless print`/`serverless package --stage dev` verificados. Smoke test `ng serve` + `curl /catalogar` (200) — verificación visual con login real pendiente del usuario en `staging`.

## Tarea 4 — Apilamiento en el catálogo público — COMPLETA (2026-08-29)

- [x] Backend: `GET /api/libros/:bookId` extendido de forma aditiva con `ejemplares: EjemplarConUbicacion[]` (`resolverEjemplares`, `Query` al GSI `isbn-index`, sin ISBN solo el propio libro — D2). Filtra a `cantidadDisponible > 0` (S6). Rol IAM `LibrosDetalleLambdaRole` actualizado con `dynamodb:Query` sobre `isbn-index` (antes solo tenía `GetItem` — gotcha recurrente del proyecto de verificar IAM acción por acción, `MEMORY.md` §7).
- [x] Frontend, listado (`CatalogoPublicoComponent`): `librosAgrupados` agrupa por ISBN en memoria (sin tocar `GET /api/libros`), una tarjeta/fila por grupo, PVP mínimo/máximo y `cantidadDisponible` sumada.
- [x] Frontend, ficha (`LibroDetalleComponent`): un panel "Ubicación en la librería" por ejemplar disponible, cada uno con su PVP y su propio botón VENDER — el diálogo actúa sobre el `bookId` del panel que lo abrió, nunca el del libro de nivel superior. `ejemplares: []` muestra la nota de agotado sin ningún botón.
- [x] Cabecera con PVP único o rango (D4); `<title>`/`<meta>` de SSR y la URL `/libro/:bookId` sin cambios (S7).
- [x] 4 tests backend + 11 frontend nuevos (370 backend / 397 frontend en total). `build`/`build:api`/`serverless print`/`serverless package --stage dev` verificados. Smoke test parcial: `/catalogar` (guardada) responde 200; `/` y `/libro/:bookId` (públicas, sin guard) cuelgan en este sandbox por falta de backend real alcanzable durante el SSR — limitación preexistente del entorno, no de esta tarea. Verificación visual con datos reales pendiente del usuario en `staging`.

**Con esto se cierra por completo el lote de duplicados/apilamiento/reporte traído por el usuario el 2026-08-29** (`docs/plan-duplicados-catalogacion.md`, Tareas 1-4, PRs #106, #107, #108 y #109 — los 4 fusionados). Sin tareas activas hasta el próximo lote de ajustes del usuario.

---

**Lote nuevo (2026-09-04):** el usuario trajo 3 ajustes no documentados antes en `PRD.md` — (1) portadas rotas del proveedor de scraping sin fallback visual ni corrección automática real, (2) el proceso "Validar libros" corre siempre sobre TODO el inventario en un solo bloque, sin poder parcelizarlo, (3) el catálogo público no tiene forma rápida de abrir la ficha de un libro escaneando su código de barras. Se investigó el código real antes de escribir las tareas (renderizado de `portadaUrl` en 6 componentes/9 sitios, `portadaEsInvalida`/`procesarLibro` en `scraping.ts`/`validaciones-libros.ts`, `construirColaPorMueble`, el escáner `@zxing/browser` de Catalogar, y la integración con `letiende.co`) y se resolvieron 4 preguntas de producto con el usuario (detalle completo en `docs/MEMORY.md` §2): **(1)** portadas rotas se corrigen en 2 capas — fallback visual en frontend + verificación HTTP real (no solo palabras clave) en el validador; **(2)** el conteo de libros por Mueble se calcula en el cliente, sin endpoint nuevo; **(3)** se agrega un atajo "Seleccionar todo el Espacio" junto al multi-select de Muebles; **(4)** ISBN escaneado sin match en el catálogo público → mensaje de error simple. Se ordenan 3 tareas atómicas, cada una en su propia rama/PR — la Tarea 1 (bugfix + endurecimiento del validador, independiente y de bajo riesgo) se saca primero, igual que en lotes anteriores. Plan completo (con las 4 decisiones y su razonamiento) en el historial de la conversación, no se persistió como documento separado — misma decisión de escala que el "Selector manual de portada" (2026-08-19).

## Tarea 1 — Fallback de portadas rotas (frontend + backend) — COMPLETA (2026-09-04)

- [x] Frontend: `public/portada-generica.svg` (placeholder "Sin portada", mismo estilo que el `@else` de texto existente) + directiva compartida standalone `SinPortadaFallbackDirective` (`src/app/shared/directivas/sin-portada-fallback.directive.ts`) que, en `(error)` del `<img>`, cambia `src` al SVG genérico — con guard anti-loop (no repite el cambio si `src` ya es el genérico). Aplicada en los 9 sitios donde se renderiza `[src]="...portadaUrl"`: `catalogar-libro.component.html` (3), `editar-libro.component.html` (2), `catalogo-publico.component.html` (2), `libro-detalle.component.html` (1), `selector-portada.component.html` (1) — no reemplaza la rama `@if/@else` existente (portada ausente/vacía), la complementa para el caso "hay URL pero el archivo ya no existe".
- [x] Backend: `fetchSeguro()` (`server/api/services/scraping.ts`) ampliada para aceptar un método HTTP opcional (default `GET`, sin cambiar los 5 call-sites existentes). Nueva función exportada `portadaUrlResponde()` — intenta `HEAD`, cae a `GET` si falla, `false` solo si ambos fallan, pasando siempre por la guardia SSRF `esUrlSegura` ya existente, timeout propio más corto (`TIMEOUT_MS_PORTADA = 5000`, pensado para miles de libros por lote en vez del `TIMEOUT_MS = 8000` de scraping de páginas). `procesarLibro()` (`validaciones-libros.ts`) ahora entra al mismo bloque de re-scraping/`portadasPendientes` si `portadaEsInvalida()` **o** `portadaUrlResponde()` detectan un problema — con corto-circuito para no gastar una petición HTTP si la palabra clave ya la marcó inválida. Comportamiento existente sin cambios (nunca borra la portada, solo la reemplaza o la marca pendiente).
- [x] Tests nuevos: directiva (2), `portadaUrlResponde` en `scraping.spec.ts` (4: HEAD 200, HEAD 404→GET 200, ambos fallan, SSRF rechazada sin fetch real), `procesarLibro` en `validaciones-libros.spec.ts` (3: HTTP roto sin palabra clave, ambas válidas sin tocar nada, corto-circuito de la palabra clave). 408 tests frontend (antes 406) / 382 backend (antes 375).
- [x] `npm run build`, `npm run build:api`, `npm test -- --watch=false` y `npm run test:api` verificados en verde tras integrar ambos cambios juntos.

Se promueve la Tarea 2 al segundo slot activo (con la Tarea 3 en backlog, ver abajo).

## Tarea 2 — Validación por lotes: seleccionar Espacio y Mueble(s) — COMPLETA (2026-09-04)

- [x] Backend: `handlerIniciar` (`validaciones-libros.ts`) acepta body opcional `{ muebleIds?: string[] }` (`extraerMuebleIdsFiltro`, trata `undefined`/`null`/`[]`/no-array/elementos no-string como "sin filtro" — 100% retrocompatible). Con 1+ ids, filtra `libros[]` por `ubicacionId → muebleId` (mismo `Map` que usa `construirColaPorMueble`) antes de armar la cola. El filtro aplicado se persiste como `muebleIdsFiltro?: string[]` en el ítem de `babel-validaciones-libros` (ausente, nunca `null`, cuando no se filtró) — trazable en `GET /api/validaciones-libros/:id`, aunque el frontend no lo muestra todavía (no se pidió en esta tarea).
- [x] Frontend: `ValidacionesLibrosService.iniciarValidacion(muebleIds?: string[])` envía `{ muebleIds }` solo si trae elementos. `ValidarLibrosComponent` gana una tarjeta "Validar por lotes (opcional)" (visible solo sin corrida en curso/terminada): `<select>` de Espacio → checkboxes de Mueble con conteo en vivo (`conteoPorMueble`, cruzando el índice ligero ya cacheado por `LibrosService.cargarIndice()` con `ubicacionId → muebleId → espacioId` en memoria, mismo patrón que `catalogo-publico.component.ts` — sin endpoint nuevo) → checkbox "Seleccionar todo el Espacio" (`todoElEspacioSeleccionado`/`alternarTodoElEspacio`) → texto explicativo (todo el inventario vs. N libros de M muebles). Sin selección, `iniciar()` sigue validando todo el inventario (comportamiento actual sin cambios).
- [x] Tests nuevos: 6 backend (`construirColaPorMueble` con libros pre-filtrados; `handlerIniciar` sin filtro, 1 mueble, 2+ muebles, `muebleIds: []`, mueble inexistente) + 4 frontend (conteo por mueble, 2 muebles seleccionados, atajo de espacio completo, limpieza al cambiar de espacio) — 388 tests backend (antes 382) / 412 frontend (antes 408).
- [x] `npm run build`, `build:api`, `npm test -- --watch=false` y `test:api` verificados en verde tras integrar backend y frontend juntos.

Con esto se cierra el lote de 3 tareas salvo la Tarea 3, que se promueve al único slot activo.

## Tarea 3 — Botón de escaneo en el Catálogo público — COMPLETA (2026-09-04)

- [x] Nuevo componente compartido standalone `EscanerCodigoBarrasComponent` (`src/app/shared/escaner-codigo-barras/`) — encapsula toda la lógica de cámara `@zxing/browser` (EAN-13, `facingMode: 'environment', aspectRatio: { ideal: 3 }`) antes duplicada en `CatalogarLibroComponent`, con su propio botón/`<video>`/mensajes de error, y expone `output()` (`codigoDetectado: string`, Angular 22 signal-based) en vez de tocar un formulario directamente. **Decisión tomada durante la implementación:** `CatalogarLibroComponent` se dejó sin tocar (no se migró a usar el componente nuevo) — su spec ejercita `escaneando()`/`iniciarEscaneo()`/`detenerEscaneo()` directamente sobre el propio componente, y migrarlo habría exigido reescribir esas pruebas en un componente ya complejo (duplicados, condición de carrera documentada) por un beneficio marginal; la duplicación con `EditarLibroComponent` queda igual que antes de esta tarea, sin empeorar.
- [x] Botón "Escanear" en `CatalogoPublicoComponent`, junto a la búsqueda, abre `EscanerCodigoBarrasComponent` en un modal (mismo patrón `fixed inset-0` que `SelectorPortadaComponent`/el diálogo "Vender" de `libro-detalle.component.ts`).
- [x] Al detectar ISBN, busca coincidencia exacta en el signal `libros()` ya cargado (sin llamada nueva al backend) y navega a `/libro/:bookId`; sin match, mensaje de error simple sin caer a la búsqueda de texto (decisión ya tomada con el usuario, ver `MEMORY.md` §2).
- [x] Sin cambios de rutas ni de backend.
- [x] 10 tests nuevos (5 `EscanerCodigoBarrasComponent`, 5 `CatalogoPublicoComponent`: modal oculto por defecto, se abre con "Escanear", ISBN con match navega y cierra el modal, ISBN sin match muestra error sin navegar, botón "Cerrar") — 422 tests frontend (antes 412). `npm run build` y `npm test -- --watch=false` verificados en verde.

**Con esto se cierra por completo el lote de 3 tareas traído por el usuario el 2026-09-04** (fallback de portadas — PR #114 — validación por lotes por Mueble — PR #115, aclaración de alcance en PR #116 — y escáner en catálogo público — PR #117, todos fusionados). Sin tareas activas hasta el próximo lote de ajustes del usuario.

---

**Hotfix — botón flotante "Volver arriba" en el Catálogo público (2026-09-04):** el usuario pidió un botón flotante (ícono `^`) que aparezca al hacer scroll más de una pantalla de alto en el catálogo público y lleve de vuelta al inicio del listado. Toma el único slot activo del motor JIT.

## Tarea — Botón flotante "Volver arriba" en el Catálogo público — COMPLETA (2026-09-04)

- [x] Botón flotante fijo (`fixed bottom-6 right-6`, `z-40` — bajo el modal del escáner que usa `z-50`) en `CatalogoPublicoComponent`, visible solo cuando `window.scrollY > window.innerHeight` (signal `mostrarBotonArriba`, listener `scroll` en `window` con `{ passive: true }`), oculto en el resto. Ícono chevron arriba (mismo estilo Heroicons outline ya usado en `BarraNavegacionComponent`), estilo `bg-primary`/`text-neutral`/`rounded-full`/sombra coherente con el resto de la app. Al hacer click (`volverArriba()`), `window.scrollTo({ top: 0, behavior: 'smooth' })`.
- [x] SSR-safe: listener y acceso a `window` guardados con `isPlatformBrowser(inject(PLATFORM_ID))` (mismo patrón de `AuthService`/`EmbebidoService`) — se agrega en `ngOnInit`, se remueve en `ngOnDestroy` (nuevo en este componente).
- [x] 5 tests nuevos (oculto por defecto, aparece tras scroll profundo, se oculta al subir, `scrollTo` con los argumentos correctos al hacer click, listener removido en `ngOnDestroy`) — 427 tests frontend (antes 422).
- [x] `npm run build -- --configuration=production` (build SSR + navegador) y `npm test -- --watch=false` verificados en verde — sin ninguna referencia a `window` fuera de los guards `isPlatformBrowser`.

Sin tareas activas hasta el próximo lote/hotfix del usuario.


