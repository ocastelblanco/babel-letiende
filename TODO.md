# TODO.md — Babel

Motor JIT: este documento mantiene **siempre exactamente 2 tareas atómicas** activas. Al completar cualquiera, se elimina, se mueve el resumen a `MEMORY.md` §2, y se calcula la siguiente tarea más prioritaria comparando `PRD.md` (roadmap) contra `MEMORY.md` (estado actual).

**Prioridad de selección aplicada:** se completó y fusionó el CRUD de sitios de scraping en `/admin/sitios` (PR #35, lista única `info`/`pvp` — ADR-010), junto con dos incidentes de infraestructura resueltos en el camino (PR #38: guarda de concurrencia en el deploy de producción, redeploy de `staging`) y el fix del selector de cuentas de Google (PR #36). Su resumen está en `MEMORY.md` §2. La motor de scraping + guardia SSRF (antes Tarea 2) sube a **Tarea 1**: sigue siendo el siguiente paso de la iniciativa **"obtención automatizada de info de libros"** (`plan-obtencion-info-libros.md`, ADR-011), independiente y lista para construirse con fixtures (no depende de que la tabla tenga datos reales). Se agrega como **Tarea 2** `GestionUsuariosComponent` — CRUD real de usuarios en `/admin/usuarios` (`PRD.md` §5.6, prioridad Media): el backend (`CRUD /api/usuarios`, con las salvaguardas de auto-degradación/auto-eliminación de ADR-009) ya existe y está verificado en vivo desde hace varias tareas, sin consumo frontend todavía — mismo patrón que `GestionEstantesComponent`/`GestionSitiosScrapingComponent`. Ambas tareas son independientes entre sí: una toca solo `server/api/services/scraping.ts` (backend, sin UI), la otra agrega una pantalla nueva bajo `/admin/usuarios`.

---

## Tarea 1 — [FEATURE]: motor de scraping + guardia SSRF (`server/api/services/scraping.ts`)

**Origen:** `plan-obtencion-info-libros.md` §6 (Task B) y ADR-011 (`MEMORY.md` §3). Núcleo de seguridad de la iniciativa: el módulo que hace las peticiones salientes a los sitios de librerías y extrae info/PVP por ISBN, con la guardia SSRF fija que protege toda URL saliente sin importar lo que el admin haya agregado a la lista. Independiente de la Tarea 2 (se puede construir y testear con fixtures sin depender de datos reales en la tabla), pero la integración final (Task C, siguiente en el roadmap de esta iniciativa) las une. `CLAUDE.md` A10 (SSRF), A03 (XSS/HTML crudo) y A08 (validación de PVP) son de cumplimiento obligatorio aquí.

**Archivos:** `server/api/services/scraping.ts` (nuevo) + `server/api/services/scraping.spec.ts` (nuevo, con fixtures HTML en `server/api/services/__fixtures__/` o similar), `package.json`/`package-lock.json` (añadir `cheerio` como dependency de producción — ADR-004), y una revisión de `serverless.yml` para asegurar que `cheerio` **no** quede excluido del empaquetado (es runtime de backend, a diferencia de los paquetes solo-frontend ya excluidos).

**Qué hacer:**
1. Instalar `cheerio`. Confirmar con `npm ls cheerio` su árbol y verificar que el tamaño de una función de backend que lo incluya sigue < 250 MB descomprimido (gotcha de `MEMORY.md` §7); `cheerio` NO se añade a la lista de exclusiones.
2. Implementar `validarHostSeguro(url): boolean` — exige `https:`; resuelve el hostname; rechaza IP literal o resuelta en rangos privados/loopback/link-local (`10/8`, `172.16/12`, `192.168/16`, `127/8`, `::1`, `fc00::/7`, `fe80::/10`) y explícitamente `169.254.169.254` (metadata service). El `fetch` usa `redirect: 'manual'` y revalida el host de cada salto. Timeout corto. Nunca lanza hacia afuera: cualquier fallo/red/timeout degrada a "no encontrado" (mismo criterio que `api-letiende.ts`).
3. Implementar los adaptadores por `dominio` para los 4 sitios semilla (ya sembrados en `staging`: Librería Lerner, Tornamesa, Librería Nacional, Busca Libre): plantilla de URL de búsqueda por ISBN + selectores CSS (`cheerio`, nodos específicos) que extraen **solo texto/números planos** — nunca HTML crudo (A03). Respetar las banderas: solo extraer `info` si el sitio la tiene, solo `pvp` si la tiene.
4. Parsear el precio colombiano `$45.000` → entero COP; validar que sea número positivo ≤ `PVP_MAXIMO` (5.000.000) antes de devolverlo (A08).
5. Exponer una función tipo `scrapearSitio(sitio, isbn): Promise<{ titulo?; autor?; editorial?; portadaUrl?; pvp? }>` que nunca lanza.
6. Cubrir con `npm run test:api`: la guardia SSRF (rechaza `http://169.254.169.254`, IPs privadas/link-local, esquemas no-https), el parseo de precio, y cada adaptador contra un fixture HTML guardado (no sitios en vivo, para no depender de su disponibilidad). Confirmar que ningún adaptador devuelve HTML crudo.

**Definition of done:**
- [ ] `npm run build:api` y `npm run test:api` pasan sin errores
- [ ] Tests cubren la guardia SSRF (casos privados/link-local/metadata/no-https rechazados), el parseo de PVP colombiano y cada adaptador contra fixtures
- [ ] `cheerio` instalado como dependency; una función de backend que lo incluya sigue < 250 MB (`npx serverless package`)
- [ ] Ningún adaptador devuelve ni reenvía HTML crudo de un tercero (solo texto/números)

---

## Tarea 2 — [FEATURE]: `GestionUsuariosComponent` — CRUD real de usuarios en `/admin/usuarios`

**Origen:** `PRD.md` §5.6 ("Gestión de usuarios: crear, editar, borrar vendedores y administradores"), prioridad Media (`PRD.md` §6). El backend (`CRUD /api/usuarios`, administrador exclusivo, con las salvaguardas de ADR-009 — un administrador no puede cambiar su propio rol ni eliminarse a sí mismo vía este endpoint) ya está implementado y verificado en vivo desde hace varias tareas — falta la pantalla real de administración que lo consume. Independiente de la Tarea 1 (motor de scraping): esta tarea es puramente CRUD de datos, sin ninguna relación con scraping/SSRF.

**Plantillas de referencia (replicar de punta a punta):** backend ya existe, no tocar. Frontend = `estantes`/`sitios-scraping` (`gestion-*.component` + `*.service`), con la particularidad de que `email` es la clave primaria (no editable tras crear, igual que `dominio` en sitios-scraping) y que hay que reflejar en la UI las dos salvaguardas de ADR-009 (deshabilitar o advertir cuando el administrador autenticado intente editar su propio rol o eliminarse a sí mismo, para no depender solo del `400` del backend).

**Archivos:**
- `src/app/core/api/usuarios.service.ts` — **ya existe** (`obtenerUsuarioActual`, Signal de solo lectura, usado por `RoleGuard`); extenderlo con métodos autenticados `listarUsuarios`/`crearUsuario`/`actualizarUsuario`/`eliminarUsuario`, mismo patrón que `EstantesService`/`SitiosScrapingService`.
- `src/app/features/admin/gestion-usuarios.component.{ts,html,spec.ts}` (nuevo): lista de usuarios (email, nombre, rol), formulario único crear/editar (`email` no editable al editar), selector de rol (`vendedor`/`administrador`), eliminar con `confirm`.
- Ruta `admin/usuarios` en `app.routes.ts` (`RoleGuard('administrador')`) y `app.routes.server.ts` (`RenderMode.Client`); activar la card "Usuarios" en `admin-inicio.component.html`.

**Qué hacer:**
1. Extender `UsuariosService` con los 4 métodos de escritura/lectura autenticados (reusa el patrón `ResultadoOperacion*` que nunca lanza).
2. Implementar `GestionUsuariosComponent`: lista + formulario único crear/editar + eliminar. Al editar/eliminar la propia fila del administrador autenticado (comparar contra `authService.usuario()?.email`), mostrar una advertencia o deshabilitar el cambio de rol/el botón eliminar en esa fila específica — anticipa el `400` de ADR-009 en vez de dejar que el usuario lo descubra por un error del backend.
3. Registrar rutas y activar la card de admin.
4. Cubrir con `npm test -- --watch=false`: los métodos nuevos del servicio (éxito/error) y los casos principales del componente (lista, crea, edita, elimina, error, salvaguarda visual sobre la propia fila).

**Definition of done:**
- [ ] `npm run build` y `npm test -- --watch=false` pasan sin errores
- [ ] Tests unitarios cubren los métodos nuevos del servicio y los casos principales del componente, incluida la salvaguarda visual sobre la propia fila del administrador
- [ ] Verificado en vivo contra `staging` con la cuenta `administrador` real: alta/edición/baja de un usuario; confirmar que intentar cambiar el propio rol o eliminarse a sí mismo se bloquea (visual y/o por el `400` del backend)
- [ ] Un `vendedor` no puede acceder a `/admin/usuarios`
