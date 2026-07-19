# TODO.md — Babel

Motor JIT: este documento mantiene **siempre exactamente 2 tareas atómicas** activas. Al completar cualquiera, se elimina, se mueve el resumen a `MEMORY.md` §2, y se calcula la siguiente tarea más prioritaria comparando `PRD.md` (roadmap) contra `MEMORY.md` (estado actual).

**Prioridad de selección aplicada:** `POST /api/ventas` se completó y se verificó **en vivo contra `staging`** con `curl` + un ID Token real (`401` sin token; `403` con un correo sin fila en `babel-usuarios-staging`, detectado ya en el primer `POST /api/libros` del script de prueba, sin llegar a intentar la venta; ciclo feliz completo con un usuario `vendedor` sembrado: se catalogó un libro de prueba (`201`), se vendió (`201`, snapshot correcto: `pvp` 50000, `costoLibro` 32500, `precioFinal` 45000 con 10% de descuento, `utilidad` 12500), y se confirmó que `cantidadDisponible` bajó a 0 — ver `MEMORY.md` §2 y §9). Sube a Tarea 1 el CRUD de `/api/usuarios` (ya estaba en el TODO, sin cambios). Se agrega como Tarea 2 el primer recorte vertical del **flujo de catalogación en el frontend** (`PRD.md` §6, roadmap Alta — es el caso de uso fundacional del proyecto: catalogar el inventario inicial de 3.000+ libros): un formulario que consuma `POST /api/libros` y `GET /api/estantes`, ambos ya existentes en el backend, con captura manual de ISBN (sin cámara ni metadatos automáticos todavía — esas son extensiones atómicas separadas de la misma feature Alta). Ambas tareas son independientes entre sí: una es backend puro sobre `babel-usuarios`, la otra es frontend puro consumiendo endpoints ya desplegados.

---

## Tarea 1 — [FEATURE]: CRUD `/api/usuarios` (administrador)

**Origen:** `PRD.md` §6 (roadmap, prioridad Media pero gap de seguridad/operación real) y `tech-specs.md` §5 (`GET`/`POST`/`PUT`/`DELETE` `/api/usuarios`, "Admin") y §4.2 (`/admin/usuarios`, `GestionUsuariosComponent`, fuera de alcance de esta tarea — solo backend). Cierra un gap real: hoy la única forma de dar de alta/baja un `vendedor`/`administrador` en `babel-usuarios` es la operación interna `sembrar-usuario-prueba`/`eliminar-usuario-prueba` de `operaciones-staging.yml` (pensada para pruebas de CI, no para uso real del administrador de Le Tiende).

**Archivos:** `server/api/handlers/usuarios.ts` (nuevo — el `GET /api/usuarios/me` actual vive en `usuarios-me.ts`, un archivo distinto; no confundir ni fusionar), `serverless.yml` (nueva función Lambda `usuarios` con su propio rol IAM, ADR-008).

**Qué hacer:**
1. Implementar los 4 handlers: `GET /api/usuarios` (lista todos), `POST /api/usuarios` (crea, recibe `{ email, nombre, rol }` — `email` es la clave primaria, no se genera), `PUT /api/usuarios/:email` (actualiza `nombre`/`rol`), `DELETE /api/usuarios/:email` (elimina). Los 4 exigen rol `administrador` exclusivamente — mismo patrón que `estantes.ts` (`verificarTokenDesdeHeader` + consulta a `babel-usuarios`, con `escanearTodo`/`obtenerPorClave`/`guardar`/`eliminar` ya existentes en `dynamodb.ts`).
2. Validar el body: `email` con formato válido, `nombre` no vacío, `rol` uno de `'vendedor' | 'administrador'`. `POST` sobre un `email` que ya existe: decidir si sobrescribe (comportamiento actual de `guardar`/`PutCommand`) o responde `409` — evaluar al implementar, documentar la decisión.
3. **Caso límite de seguridad a decidir explícitamente (no dejarlo implícito):** ¿qué pasa si un administrador se degrada a `vendedor` o se elimina a sí mismo vía `PUT`/`DELETE`? Ninguna corrección impide dejar la tabla sin ningún `administrador` (bloqueo total del panel admin). Decidir si se bloquea esa operación sobre el propio email del token (`403` o `400` explicativo) o si se acepta el riesgo y se documenta como responsabilidad operativa — no implementar sin decidir esto primero.
4. Actualizar `serverless.yml` (ADR-008): nueva función Lambda `usuarios` con rol IAM propio — `dynamodb:GetItem`/`PutItem`/`DeleteItem`/`Scan` sobre `babel-usuarios` únicamente (ya es la misma tabla que usa para resolver el rol del token, no hace falta permiso adicional a otra tabla). Recordar el límite de 256 caracteres en `description`. Recordar la lección del incidente de `POST /api/libros` (ver `MEMORY.md` §7): incluir `verificar-token.js` en `package.patterns` desde el primer commit.
5. Cubrir con `npm run test:api` los 4 verbos: sin token → `401`; rol `vendedor` → `403`; body inválido → `400`; caso feliz de cada verbo; el caso límite del punto 3.

**Definition of done:**
- [ ] `npm run build`, `npm run build:api`, `npm test -- --watch=false` y `npm run test:api` pasan sin errores
- [ ] Tests unitarios cubren los 4 verbos, sus casos de error (401/403/400) y el caso límite de auto-degradación/auto-eliminación del punto 3
- [ ] Verificado manualmente contra `staging` con `curl` + un ID Token real (nueva operación `probar-usuarios-crud` en `operaciones-staging.yml`, mismo patrón que `probar-estantes`): `401` sin token, `403` con un usuario `vendedor`, ciclo `POST`→`GET`→`PUT`→`DELETE` con un `administrador` sembrado — sin dejar filas de prueba adicionales en `babel-usuarios-staging` al terminar (más allá del propio usuario administrador de prueba, que se limpia con `eliminar-usuario-prueba` como siempre)
- [ ] El rol IAM de la función `usuarios` sigue el principio de mínimo privilegio (`CLAUDE.md` A05, ADR-008)

---

## Tarea 2 — [FEATURE]: Catalogación manual en el frontend (formulario `POST /api/libros` + `GET /api/estantes`)

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
