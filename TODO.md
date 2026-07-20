# TODO.md — Babel

Motor JIT: este documento mantiene **siempre exactamente 2 tareas atómicas** activas. Al completar cualquiera, se elimina, se mueve el resumen a `MEMORY.md` §2, y se calcula la siguiente tarea más prioritaria comparando `PRD.md` (roadmap) contra `MEMORY.md` (estado actual).

**Prioridad de selección aplicada:** `GET /api/ventas` se completó y se verificó **en vivo contra `staging`** con un ID Token real: primero `403` con un correo sin fila en `babel-usuarios-staging` (el script se detuvo ahí sin efectos secundarios); luego, con ese mismo correo sembrado como `administrador`, ciclo completo `GET`(200 `[]`)→`POST /api/libros`×2(201)→`POST /api/ventas`×2(201)→`GET` sin filtro (200, aparecen ambas)→`GET?formaDePago=tarjeta` (200, solo la venta con esa forma de pago)→`GET?editorial=...` (200, solo la venta de esa editorial, la otra correctamente excluida), sin dejar datos de prueba (ver `MEMORY.md` §2 y §9). Sube a Tarea 1 `CambiarEstanteComponent` (ya estaba en el TODO como Tarea 2, sin cambios de contenido). Se agrega como Tarea 2 `RoleGuard` sobre `/admin/*` — primer paso del panel de administración: hoy `RoleGuard` existe y está probado (tarea histórica) pero ninguna ruta real lo usa todavía; los 4 CRUDs de administrador ya desplegados (`estantes`, `usuarios`, `editoriales-descuentos`) no tienen ningún frontend de consumo. Mismo patrón atómico: un placeholder de navegación admin primero, antes de construir cada pantalla CRUD como tareas futuras independientes. Ambas tareas son independientes entre sí: una es la ruta `/libros/:bookId/estante` (ya guardada solo con `AuthGuard`), la otra es la nueva sección `/admin` (guardada con `RoleGuard('administrador')`).

---

## Tarea 1 — [FEATURE]: `CambiarEstanteComponent` — frontend de consumo de `PATCH /api/libros/:bookId/estante`

**Origen:** `tech-specs.md` §4.2 (ruta `/libros/:bookId/estante`, guard `AuthGuard`) y §5.3 del `PRD.md` — primer consumo desde el frontend del endpoint backend ya cerrado y verificado en vivo (`PATCH /api/libros/:bookId/estante`, `TODO.md` histórico). Mismo patrón backend-luego-frontend ya usado (`RoleGuard`/`CatalogarLibroComponent` tras `POST /api/libros`).

**Archivos:** `src/app/core/api/libros.service.ts` (extender con un método `cambiarEstante(bookId, estanteId)`, mismo patrón autenticado que `EstantesService`), `src/app/features/libros/cambiar-estante.component.ts` (nuevo), ruta nueva `/libros/:bookId/estante` en `app.routes.ts` (guardada con `AuthGuard` — no `RoleGuard`, ya que tanto `vendedor` como `administrador` pueden usarla, igual que `/libros`, ver `tech-specs.md` §4.2), enlace desde `ListaLibrosCatalogadosComponent` (o el punto de navegación mínimo necesario, sin rediseñar la lista completa — evaluar durante la implementación si ya existe una lista real de libros catalogados o solo el placeholder actual).

**Qué hacer:**
1. Extender `LibrosService` (o crear un servicio dedicado si `LibrosService` hoy es específico del catálogo público sin autenticación — revisar antes de decidir) con un método autenticado `PATCH /api/libros/:bookId/estante` (`Authorization: Bearer <idToken>`, mismo patrón que `CatalogarLibroComponent`/`EstantesService`).
2. Implementar `CambiarEstanteComponent` (standalone, ruta `/libros/:bookId/estante`, `bookId` desde el route param): muestra los datos actuales del libro (título, autor, estante actual) y un `<select>` de estante poblado por `EstantesService` (ya existente), envía el cambio con el ID Token real, mensaje de éxito/error, redirige o confirma visualmente tras guardar.
3. Agregar el enlace/acción "Cambiar estante" desde el punto de navegación mínimo necesario (revisar el estado real de `ListaLibrosCatalogadosComponent` — hoy puede seguir siendo el placeholder del scaffold, en cuyo caso decidir el alcance mínimo junto con esta tarea, sin construir una lista completa de libros catalogados si esa es una tarea de roadmap separada).
4. Cubrir con `npm test -- --watch=false`: el método nuevo del servicio (éxito/error, mismo patrón que el resto de servicios de `core/api`) y los casos principales del componente (carga el estante actual, envío válido llama al `PATCH`, error se muestra, éxito confirma visualmente).

**Definition of done:**
- [ ] `npm run build` y `npm test -- --watch=false` pasan sin errores
- [ ] Tests unitarios cubren el método nuevo del servicio y los casos principales del componente
- [ ] Verificado manualmente contra `staging`: dado que requiere un login real de Google, decidir con el usuario cómo verificar (combinar evidencia ya verificada en vivo del backend + tests unitarios, o pedir al usuario una verificación manual puntual — mismas dos opciones ya usadas antes en el proyecto)
- [ ] Ningún dato sensible se calcula ni se confía desde el cliente — el componente solo envía `estanteId`, que el backend ya valida (`CLAUDE.md` A08)

---

## Tarea 2 — [FEATURE]: sección `/admin` — placeholder de navegación + `RoleGuard('administrador')`

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
- [ ] Verificado manualmente contra `staging` (misma decisión de verificación que la Tarea 1: combinar evidencia o pedir verificación manual al usuario)
- [ ] Un `vendedor` no puede ver ni acceder a `/admin` (UX del header oculta el enlace, `RoleGuard` bloquea la navegación directa — recordando que la autorización real siempre vive en el backend, `CLAUDE.md` A01)
