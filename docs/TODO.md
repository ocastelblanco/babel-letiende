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
