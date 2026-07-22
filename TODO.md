# TODO.md — Babel

Motor JIT: este documento mantiene **siempre exactamente 2 tareas atómicas** activas. Al completar cualquiera, se elimina, se mueve el resumen a `MEMORY.md` §2, y se calcula la siguiente tarea más prioritaria comparando `PRD.md` (roadmap) contra `MEMORY.md` (estado actual).

**Prioridad de selección aplicada:** se completaron y fusionaron `GestionEstantesComponent` (PR #32, CRUD real de estantes en `/admin/estantes`) y el autocompletado de metadatos por ISBN vía `api.letiende.co` (PR #33, `GET /api/metadatos/:isbn` + reintento ante fallas transitorias). Sus resúmenes están en `MEMORY.md` §2. La siguiente prioridad es la iniciativa **"obtención automatizada de info de libros"** (`plan-obtencion-info-libros.md`, aprobada por el usuario): rediseña el paso crítico del flujo de catalogación (`PRD.md` §5.2) añadiendo una cadena de fallbacks (scraping por ISBN) que aporta metadatos **y** PVP, gobernada por una lista única de sitios administrable (ADR-010) con una guardia SSRF fija (ADR-011). El alcance acordado llega **hasta el scraping por ISBN** (la búsqueda por título/autor + UI de selección queda diferida). Las dos primeras tareas atómicas de esa iniciativa son independientes de arranque: **Task A** crea la lista administrable (datos + UI admin), **Task B** crea el motor de scraping + la guardia SSRF como unidad testeada de forma aislada (fixtures). La integración en el endpoint + el PVP editable (Task C) sigue después, una vez A y B estén verificadas.

---

## Tarea 1 — [FEATURE]: CRUD de sitios de scraping en `/admin/sitios` (lista única `info`/`pvp`)

**Origen:** `plan-obtencion-info-libros.md` §6 (Task A) y ADR-010 (`MEMORY.md` §3). Primer cimiento de la iniciativa de obtención automatizada de info: la tabla administrable `babel-sitios-scraping` que reemplaza el modelo lista-blanca + lista-negra por una sola lista donde cada sitio declara si sirve para `info` (metadatos bibliográficos) y/o `pvp` (precio). Independiente de la Tarea 2 (motor de scraping): esta tarea solo crea los datos + la UI de administración; no hace ninguna petición saliente.

**Plantillas de referencia (replicar de punta a punta):** backend = `editoriales-descuentos` (clave primaria natural suministrada por el usuario, `409` en POST duplicado). Frontend = `estantes` (`gestion-estantes.component` + `estantes.service`).

**Archivos:**
- Modelo: `src/app/core/models/sitio-scraping.model.ts` (nuevo) + copia local en el handler. Interfaz `SitioScraping { dominio (PK); nombre; url; info: boolean; pvp: boolean; prioridad: number }`.
- Backend: `server/api/handlers/sitios-scraping.ts` (+ `.spec.ts`) — un solo handler para los 4 verbos (ADR-008), `exigirAdministrador` (rol `administrador` exclusivo), validación (`dominio` hostname no vacío/válido, `url` https, `info`/`pvp` booleanos, `prioridad` numérica), `409` si el `dominio` ya existe (POST), `404` si no existe (PUT/DELETE). Reusa `server/api/services/dynamodb.ts` (`escanearTodo`/`obtenerPorClave`/`guardar`/`eliminar`) y `verificar-token.ts`.
- Infra `serverless.yml`: `custom.nombresTablas.sitiosScraping`, env `TABLA_SITIOS_SCRAPING`, `functions.sitiosScraping` (rutas `GET`/`POST /api/sitios-scraping`, `PUT`/`DELETE /api/sitios-scraping/{dominio}`, con el bloque literal de exclusiones `node_modules/**` — ver gotcha de tamaño de Lambda en `MEMORY.md` §7), `SitiosScrapingLambdaRole` (GetItem/PutItem/DeleteItem/Scan sobre la tabla nueva + GetItem sobre `babel-usuarios`), `TablaSitiosScraping` (PK `dominio` tipo `S`, PROVISIONED 25/25).
- Frontend: `src/app/core/api/sitios-scraping.service.ts` (+ `.spec.ts`, patrón `EstantesService`: `DatosSitioScraping`, `ResultadoOperacionSitioScraping`, signals, `cargar`/`crear`/`actualizar`/`eliminar` autenticados), `src/app/features/admin/gestion-sitios-scraping.component.{ts,html,spec.ts}` (lista + formulario único crear/editar con checkboxes `info`/`pvp` + eliminar con `confirm`), ruta `admin/sitios` en `app.routes.ts` (`RoleGuard('administrador')`) y `app.routes.server.ts` (`RenderMode.Client`), y activar la card en `admin-inicio.component.html` (+ `RouterLink` en el `.ts`).

**Qué hacer:**
1. Definir el modelo y la copia local; implementar el handler CRUD con validación y los códigos 400/403/404/409 (plantilla `editoriales-descuentos.ts`).
2. Añadir tabla + función + rol IAM de mínimo privilegio en `serverless.yml` (plantilla `editorialesDescuentos`).
3. Implementar el servicio Angular autenticado y el componente de gestión (plantilla `estantes`).
4. Registrar rutas, activar la card de admin.
5. Sembrar los 4 sitios iniciales (Librería Lerner/Tornamesa/Librería Nacional `{info:true,pvp:true}`, Busca Libre `{info:true,pvp:false}`) — vía la UI ya desplegada o una operación nueva en `operaciones-staging.yml`.
6. Cubrir con `npm run test:api` (handler: 401/403/400/404/409/2xx) y `npm test -- --watch=false` (servicio + componente).

**Definition of done:**
- [ ] `npm run build`, `npm run build:api`, `npm test -- --watch=false`, `npm run test:api` pasan sin errores
- [ ] `npx serverless package --stage staging` produce la función nueva < 250 MB descomprimido
- [ ] Verificado en vivo contra `staging` con la cuenta `administrador` real: alta/edición/baja de un sitio; un `vendedor` no puede acceder a `/admin/sitios`
- [ ] Los 4 sitios semilla quedan cargados

---

## Tarea 2 — [FEATURE]: motor de scraping + guardia SSRF (`server/api/services/scraping.ts`)

**Origen:** `plan-obtencion-info-libros.md` §6 (Task B) y ADR-011 (`MEMORY.md` §3). Núcleo de seguridad de la iniciativa: el módulo que hace las peticiones salientes a los sitios de librerías y extrae info/PVP por ISBN, con la guardia SSRF fija que protege toda URL saliente sin importar lo que el admin haya agregado a la lista. Independiente de la Tarea 1 de arranque (se puede construir y testear con fixtures sin la tabla), pero la integración final (Task C) las une. `CLAUDE.md` A10 (SSRF), A03 (XSS/HTML crudo) y A08 (validación de PVP) son de cumplimiento obligatorio aquí.

**Archivos:** `server/api/services/scraping.ts` (nuevo) + `server/api/services/scraping.spec.ts` (nuevo, con fixtures HTML en `server/api/services/__fixtures__/` o similar), `package.json`/`package-lock.json` (añadir `cheerio` como dependency de producción — ADR-004), y una revisión de `serverless.yml` para asegurar que `cheerio` **no** quede excluido del empaquetado (es runtime de backend, a diferencia de los paquetes solo-frontend ya excluidos).

**Qué hacer:**
1. Instalar `cheerio`. Confirmar con `npm ls cheerio` su árbol y verificar que el tamaño de una función de backend que lo incluya sigue < 250 MB descomprimido (gotcha de `MEMORY.md` §7); `cheerio` NO se añade a la lista de exclusiones.
2. Implementar `validarHostSeguro(url): boolean` — exige `https:`; resuelve el hostname; rechaza IP literal o resuelta en rangos privados/loopback/link-local (`10/8`, `172.16/12`, `192.168/16`, `127/8`, `::1`, `fc00::/7`, `fe80::/10`) y explícitamente `169.254.169.254` (metadata service). El `fetch` usa `redirect: 'manual'` y revalida el host de cada salto. Timeout corto. Nunca lanza hacia afuera: cualquier fallo/red/timeout degrada a "no encontrado" (mismo criterio que `api-letiende.ts`).
3. Implementar los adaptadores por `dominio` para los 4 sitios semilla: plantilla de URL de búsqueda por ISBN + selectores CSS (`cheerio`, nodos específicos) que extraen **solo texto/números planos** — nunca HTML crudo (A03). Respetar las banderas: solo extraer `info` si el sitio la tiene, solo `pvp` si la tiene.
4. Parsear el precio colombiano `$45.000` → entero COP; validar que sea número positivo ≤ `PVP_MAXIMO` (5.000.000) antes de devolverlo (A08).
5. Exponer una función tipo `scrapearSitio(sitio, isbn): Promise<{ titulo?; autor?; editorial?; portadaUrl?; pvp? }>` que nunca lanza.
6. Cubrir con `npm run test:api`: la guardia SSRF (rechaza `http://169.254.169.254`, IPs privadas/link-local, esquemas no-https), el parseo de precio, y cada adaptador contra un fixture HTML guardado (no sitios en vivo, para no depender de su disponibilidad). Confirmar que ningún adaptador devuelve HTML crudo.

**Definition of done:**
- [ ] `npm run build:api` y `npm run test:api` pasan sin errores
- [ ] Tests cubren la guardia SSRF (casos privados/link-local/metadata/no-https rechazados), el parseo de PVP colombiano y cada adaptador contra fixtures
- [ ] `cheerio` instalado como dependency; una función de backend que lo incluya sigue < 250 MB (`npx serverless package`)
- [ ] Ningún adaptador devuelve ni reenvía HTML crudo de un tercero (solo texto/números)
