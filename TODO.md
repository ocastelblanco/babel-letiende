# TODO.md — Babel

Motor JIT: este documento mantiene **siempre exactamente 2 tareas atómicas** activas. Al completar cualquiera, se elimina, se mueve el resumen a `MEMORY.md` §2, y se calcula la siguiente tarea más prioritaria comparando `PRD.md` (roadmap) contra `MEMORY.md` (estado actual).

**Prioridad de selección aplicada:** `CambiarEstanteComponent` se completó (PR #28): `ListaLibrosCatalogadosComponent` dejó de ser el placeholder del scaffold (ahora lista el catálogo real con un enlace "Cambiar estante" por libro) y se implementó `CambiarEstanteComponent` (`bookId` resuelto del catálogo público ya cargado por `LibrosService`, sin nuevo endpoint de detalle; `<select>` de `EstantesService`; `PATCH` autenticado inline en el componente, mismo patrón que `CatalogarLibroComponent`). Verificado con la evidencia combinada que el usuario eligió (recomendada): el backend `PATCH /api/libros/:bookId/estante` ya estaba verificado en vivo contra `staging` (tarea histórica, PR #25) + 10 tests unitarios nuevos del frontend (`CambiarEstanteComponent` 6, `ListaLibrosCatalogadosComponent` 4). Sube a Tarea 1 la sección `/admin` (ya estaba en el TODO como Tarea 2, sin cambios de contenido). Se agrega como Tarea 2 el escaneo de código de barras con cámara en `CatalogarLibroComponent` (`PRD.md` §5.2, primer paso de "Flujo de catalogación completo", prioridad Alta en el roadmap; `tech-specs.md` línea 86 ya decide la librería, `@zxing/browser`). Ambas tareas son independientes entre sí: una es la nueva sección `/admin` (guardada con `RoleGuard('administrador')`), la otra toca únicamente `CatalogarLibroComponent` (ruta `/catalogar`, ya existente).

---

## Tarea 1 — [FEATURE]: sección `/admin` — placeholder de navegación + `RoleGuard('administrador')`

**Origen:** `tech-specs.md` §4.2 (rutas `/admin/estantes`, `/admin/editoriales`, `/admin/usuarios`, `/admin/reportes`, todas guardadas con `AuthGuard` + `RoleGuard(admin)`) y `PRD.md` §5.6 (configuración de la aplicación, solo administrador). Los 4 CRUDs de backend que alimentarán esta sección ya están implementados y verificados en vivo (`estantes`, `usuarios`, `editoriales-descuentos`, y ahora `GET /api/ventas` para reportes), pero ningún administrador tiene hoy una forma de llegar a ellos desde la interfaz — ni siquiera un enlace. Esta tarea es deliberadamente pequeña: un punto de entrada real y protegido a la sección admin, no cada pantalla CRUD (esas quedan como tareas futuras independientes, una por CRUD, siguiendo el mismo patrón atómico ya usado en todo el proyecto).

**Archivos:** `src/app/features/admin/admin-inicio.component.ts` (nuevo, placeholder simple con enlaces a cada futura pantalla — pueden ser `<a>` deshabilitados o rutas que aún no existen, a decidir durante la implementación), ruta nueva `/admin` en `app.routes.ts` (guardada con `RoleGuard('administrador')`, mismo patrón que la extensión multi-rol ya soportada), enlace visible solo para administradores desde el header (`src/app/app.html`, que hoy ya muestra "Mi cuenta"/"Cerrar sesión" condicionalmente según sesión — extender con un enlace "Administración" visible solo si `usuario()?.rol === 'administrador'`, requiere resolver el rol del usuario actual en el header, hoy solo sabe si hay sesión o no).

**Qué hacer:**
1. Decidir cómo el header (`App`, hoy solo usa `AuthService.usuario()` para saber si hay sesión) resuelve el rol del usuario actual para mostrar/ocultar el enlace "Administración" — reutilizar `UsuariosService`/`obtenerUsuarioActual()` (ya existente, usado por `RoleGuard`) en vez de duplicar lógica.
2. Implementar `AdminInicioComponent` (standalone, ruta `/admin`, guardada con `RoleGuard('administrador')`): página simple que liste las secciones futuras (Estantes, Usuarios, Editoriales, Reportes) — sin implementar ninguna todavía, es un índice/placeholder real, no una pantalla vacía sin sentido (ej. puede mostrar conteos básicos si `GET /api/estantes`/`GET /api/usuarios`/`GET /api/editoriales-descuentos` ya devuelven eso fácilmente, a evaluar sin sobrealcanzar la tarea).
3. Cubrir con `npm test -- --watch=false`: el guard sobre la ruta `/admin` (ya cubierto indirectamente por los tests existentes de `RoleGuard`, pero agregar el caso específico de esta ruta si aporta valor) y los casos principales de `AdminInicioComponent`.
4. Verificar que un `vendedor` autenticado NO vea el enlace "Administración" en el header, y que intentar navegar directo a `/admin` lo redirija (mismo comportamiento ya probado de `RoleGuard`).

**Definition of done:**
- [ ] `npm run build` y `npm test -- --watch=false` pasan sin errores
- [ ] Tests unitarios cubren `AdminInicioComponent` y la visibilidad condicional del enlace en el header
- [ ] Verificado manualmente contra `staging` (misma decisión de verificación que las tareas de frontend anteriores: combinar evidencia o pedir verificación manual al usuario)
- [ ] Un `vendedor` no puede ver ni acceder a `/admin` (UX del header oculta el enlace, `RoleGuard` bloquea la navegación directa — recordando que la autorización real siempre vive en el backend, `CLAUDE.md` A01)

---

## Tarea 2 — [FEATURE]: escaneo de código de barras con cámara en `CatalogarLibroComponent`

**Origen:** `PRD.md` §5.2 ("Flujo de catalogación completo": escanear ISBN con la cámara es el primer paso, antes del autocompletado de metadatos), prioridad Alta en la tabla de roadmap (`PRD.md` §6). `tech-specs.md` línea 86 ya decide la librería (`@zxing/browser`, alternativa `html5-qrcode`) — no queda pendiente de diseño, solo de implementación. Independiente de la Tarea 1 (`/admin`): esta tarea solo toca `CatalogarLibroComponent`/`/catalogar`, ya existente y guardado con `RoleGuard(['vendedor', 'administrador'])`.

**Archivos:** `src/app/features/catalogar/catalogar-libro.component.ts` (extender: agregar botón "Escanear" + estado de escaneo activo/inactivo), `src/app/features/catalogar/catalogar-libro.component.html` (elemento de video/vista de cámara, visible solo mientras se escanea), `package.json` (agregar `@zxing/browser` + `@zxing/library` como dependencia de producción, `package-lock.json` actualizado — `CLAUDE.md` A08).

**Qué hacer:**
1. Instalar `@zxing/browser` (`npm install @zxing/browser`, confirmar que trae `@zxing/library` como dependencia, revisar `package-lock.json` generado).
2. Agregar un botón "Escanear ISBN" en `CatalogarLibroComponent` que, **solo al hacer click/tap** (gesto explícito del usuario, requerido por `getUserMedia` — ver gotcha de `CLAUDE.md` §7 "Acceso a cámara... requiere HTTPS y gesto del usuario"), active un `<video>` con `BrowserMultiFormatReader` de `@zxing/browser` apuntando a la cámara trasera (`facingMode: 'environment'`) si está disponible.
3. Al detectar un código de barras EAN-13 (formato estándar de ISBN-13), completar automáticamente el campo `isbn` del formulario reactivo existente y detener el escaneo (liberar la cámara, `reader.reset()` o equivalente) — el usuario sigue pudiendo editar el campo manualmente después, igual que hoy.
4. Manejar el caso sin permiso de cámara / sin cámara disponible (mensaje de error visible, sin romper el resto del formulario que ya funciona por entrada manual del ISBN).
5. Cubrir con `npm test -- --watch=false` lo que sea testeable sin una cámara real (mock de `BrowserMultiFormatReader`): que el botón active/desactive el estado de escaneo, que un resultado simulado del scanner complete el campo `isbn`. La lectura real de un código de barras físico no es testeable en CI/sandbox — queda para la verificación manual.

**Definition of done:**
- [ ] `npm run build` y `npm test -- --watch=false` pasan sin errores
- [ ] Tests unitarios cubren la activación/desactivación del escaneo y el autocompletado del campo `isbn` a partir de un resultado simulado
- [ ] Verificado manualmente por el usuario en su propio navegador/celular contra `staging` (requiere cámara real y HTTPS — no automatizable en este entorno sandbox, mismo criterio que cualquier feature que dependa de `getUserMedia`)
- [ ] El campo `isbn` sigue siendo editable manualmente aunque el escaneo falle o no esté disponible (no se vuelve un flujo obligatorio de cámara)
