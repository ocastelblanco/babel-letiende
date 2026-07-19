# TODO.md — Babel

Motor JIT: este documento mantiene **siempre exactamente 2 tareas atómicas** activas. Al completar cualquiera, se elimina, se mueve el resumen a `MEMORY.md` §2, y se calcula la siguiente tarea más prioritaria comparando `PRD.md` (roadmap) contra `MEMORY.md` (estado actual).

**Prioridad de selección aplicada:** el CRUD de `/api/usuarios` se completó y se verificó **en vivo contra `staging`** con `curl` + un ID Token real (`401` sin token, `403` con un correo sin fila en `babel-usuarios-staging` con el script deteniéndose ahí sin efectos secundarios; con un `administrador` sembrado: confirmada la salvaguarda de auto-degradación/auto-eliminación —`PUT`/`DELETE` sobre el propio email del token responden `400`, ADR-009— y ciclo feliz completo `GET`(200)→`POST`(201)→`PUT`(200)→`GET`(200, aparece actualizado)→`DELETE`(204) sobre un usuario objetivo de prueba distinto, limpiado solo — ver `MEMORY.md` §2 y §9). Sube a Tarea 1 la catalogación manual en el frontend (ya estaba en el TODO, sin cambios). Se agrega como Tarea 2 el CRUD de `/api/editoriales-descuentos` (`PRD.md` §6, roadmap Media; `tech-specs.md` §4.3/§5) — sigue el mismo patrón atómico ya probado (`estantes.ts`/`usuarios.ts`) y es la última pieza de configuración de negocio que falta antes de poder calcular `Libro.costo` con datos reales en vez de un porcentaje elegido a mano en cada catalogación. Ambas tareas son independientes entre sí: una es frontend puro consumiendo endpoints ya desplegados, la otra es backend puro sobre `babel-editoriales-descuentos`.

---

## Tarea 1 — [FEATURE]: Catalogación manual en el frontend (formulario `POST /api/libros` + `GET /api/estantes`)

**Origen:** `PRD.md` §6 (roadmap, Alta prioridad) — "Flujo de catalogación completo (escaneo → metadatos → precio → estante)". Este es el caso de uso fundacional descrito en `CLAUDE.md` §1 (catalogar 3.000+ libros iniciales), por lo que es la ruta crítica de rendimiento/usabilidad de toda la app. Esta tarea cubre solo el primer recorte vertical: captura **manual** de todos los campos (ISBN escrito a mano, sin cámara) contra los dos endpoints de backend que ya existen y están verificados en vivo (`POST /api/libros`, `GET /api/estantes`). El escaneo de código de barras con cámara (`@zxing/browser`/`html5-qrcode`) y el autocompletado de metadatos/PVP vía `api.letiende.co`/scraping quedan para tareas futuras — son extensiones independientes de este mismo formulario, no bloqueantes para tener un flujo de catalogación funcional de punta a punta.

**Archivos:** `src/app/core/api/estantes.service.ts` (nuevo, cliente de `GET /api/estantes` autenticado, mismo patrón que `usuarios.service.ts`), `src/app/features/catalogar/catalogar-libro.component.ts` (nuevo), ruta nueva protegida con `RoleGuard` (rol `vendedor` o `administrador` — ver nota abajo).

**Qué hacer:**
1. Crear `EstantesService` (`src/app/core/api/estantes.service.ts`): cliente autenticado (`Authorization: Bearer <idToken>`, mismo patrón que `UsuariosService`) de `GET /api/estantes`, expone la lista como Signal de solo lectura, nunca lanza.
2. **Decidir y documentar** cómo `RoleGuard` (hoy parametrizado por un único rol exacto — ver `MEMORY.md` §9, tarea de `RoleGuard`) admite "`vendedor` **o** `administrador`" para esta ruta, ya que `POST /api/libros` en el backend acepta ambos roles pero el guard actual no soporta una lista. Extender `RoleGuard` para aceptar uno o varios roles válidos (cambio mínimo, cubrir con test unitario nuevo) en vez de duplicar el guard.
3. Implementar `CatalogarLibroComponent` (standalone, ruta nueva p. ej. `/catalogar`, protegida por el `RoleGuard` extendido): formulario reactivo con todos los campos de `POST /api/libros` (`isbn`, `titulo`, `autor`, `editorial`, `portadaUrl`, `pvp`, `porcentajeDescuentoEditorial`, `cantidadTotal`, `estanteId` — este último como `<select>` poblado por `EstantesService`), validación básica en el cliente (UX, la autoridad real sigue siendo el backend — `CLAUDE.md` A01), envío con el ID Token real, mensaje de éxito/error, limpieza del formulario tras guardar para agilizar la catalogación en serie (caso de uso: cientos de libros seguidos).
4. Enlazar la ruta nueva desde algún punto de navegación accesible para `vendedor`/`administrador` (p. ej. un enlace en el header o en `/` tras iniciar sesión — decidir el mínimo necesario, sin rediseñar la navegación completa, eso es alcance de otra tarea).
5. Cubrir con `npm test -- --watch=false`: `EstantesService` (éxito/error, mismo patrón que `LibrosService`), la extensión de `RoleGuard` (nuevo caso de múltiples roles válidos), y al menos los casos principales de `CatalogarLibroComponent` (envío válido llama a `POST /api/libros`, error de red se muestra, formulario se limpia tras éxito).

**Definition of done:**
- [ ] `npm run build` y `npm test -- --watch=false` pasan sin errores
- [ ] Tests unitarios cubren `EstantesService`, la extensión multi-rol de `RoleGuard`, y los casos principales de `CatalogarLibroComponent`
- [ ] Verificado manualmente contra `staging`: dado que requiere un login real de Google (no automatizable en este entorno, mismo caso ya resuelto para `RoleGuard` — ver `MEMORY.md` §9), decidir con el usuario cómo verificar (opciones ya usadas antes: combinar evidencia de endpoints ya verificados en vivo + tests unitarios, o pedir al usuario una verificación manual puntual desde su propio navegador)
- [ ] Ningún dato sensible (`pvp`/`costo`) se calcula ni se confía desde el cliente — el formulario solo envía lo que `POST /api/libros` ya valida y recalcula en el backend (`CLAUDE.md` A08)

---

## Tarea 2 — [FEATURE]: CRUD `/api/editoriales-descuentos` (administrador)

**Origen:** `PRD.md` §6 (roadmap, Media) y `tech-specs.md` §5 (`GET`/`POST`/`PUT`/`DELETE` `/api/editoriales-descuentos`, "Admin") y §4.3 (modelo `DescuentoEditorial`) y §4.2 (`/admin/editoriales`, `DescuentosEditorialesComponent`, fuera de alcance de esta tarea — solo backend). Hoy `porcentajeDescuentoEditorial` se elige a mano libremente al catalogar cada libro (`POST /api/libros`, sin restricción); este CRUD permite que el administrador configure por editorial un porcentaje por defecto y alternativas válidas, para que el flujo de catalogación (Tarea 1 y sus extensiones futuras) pueda sugerirlas en vez de dejar el campo completamente libre.

**Archivos:** `server/api/handlers/editoriales-descuentos.ts` (nuevo), `serverless.yml` (nueva función Lambda `editorialesDescuentos` con su propio rol IAM, ADR-008).

**Qué hacer:**
1. Implementar los 4 handlers: `GET /api/editoriales-descuentos` (lista todos), `POST /api/editoriales-descuentos` (crea, recibe `{ editorial, porcentajePorDefecto, porcentajesDisponibles }` — `editorial` es la clave primaria, no se genera), `PUT /api/editoriales-descuentos/:editorial` (actualiza `porcentajePorDefecto`/`porcentajesDisponibles`), `DELETE /api/editoriales-descuentos/:editorial` (elimina). Los 4 exigen rol `administrador` exclusivamente — mismo patrón que `estantes.ts`/`usuarios.ts` (`verificarTokenDesdeHeader` + consulta a `babel-usuarios`, con `escanearTodo`/`obtenerPorClave`/`guardar`/`eliminar` ya existentes en `dynamodb.ts`).
2. Validar el body: `editorial` no vacío, `porcentajePorDefecto` un número entre 0 y 100, `porcentajesDisponibles` un array de números cada uno entre 0 y 100 (puede ser vacío). `POST` sobre una `editorial` que ya existe: seguir la misma decisión ya tomada en el CRUD de usuarios (`TODO.md`/`MEMORY.md` ADR-009) por consistencia — responder `409` en vez de sobrescribir en silencio.
3. Actualizar `serverless.yml` (ADR-008): nueva función Lambda `editorialesDescuentos` con rol IAM propio — `dynamodb:GetItem`/`PutItem`/`DeleteItem`/`Scan` sobre `babel-editoriales-descuentos` únicamente, más `dynamodb:GetItem` sobre `babel-usuarios` para resolver el rol del token. Recordar el límite de 256 caracteres en `description` y la lección del incidente de `POST /api/libros` (ver `MEMORY.md` §7): incluir `verificar-token.js` en `package.patterns` desde el primer commit.
4. Cubrir con `npm run test:api` los 4 verbos: sin token → `401`; rol `vendedor` → `403`; body inválido → `400`; `POST` sobre una editorial existente → `409`; `PUT`/`DELETE` sobre una editorial inexistente → `404`; caso feliz de cada verbo.

**Definition of done:**
- [ ] `npm run build`, `npm run build:api`, `npm test -- --watch=false` y `npm run test:api` pasan sin errores
- [ ] Tests unitarios cubren los 4 verbos y sus casos de error (401/403/400/404/409)
- [ ] Verificado manualmente contra `staging` con `curl` + un ID Token real (nueva operación `probar-editoriales-descuentos-crud` en `operaciones-staging.yml`, mismo patrón que `probar-usuarios-crud`): `401` sin token, `403` con un usuario `vendedor`, ciclo `POST`→`GET`→`PUT`→`DELETE` con un `administrador` sembrado — sin dejar filas de prueba en `babel-editoriales-descuentos-staging` al terminar
- [ ] El rol IAM de la función `editorialesDescuentos` sigue el principio de mínimo privilegio (`CLAUDE.md` A05, ADR-008)
