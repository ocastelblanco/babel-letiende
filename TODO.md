# TODO.md — Babel

Motor JIT: este documento mantiene **siempre exactamente 2 tareas atómicas** activas. Al completar cualquiera, se elimina, se mueve el resumen a `MEMORY.md` §2, y se calcula la siguiente tarea más prioritaria comparando `PRD.md` (roadmap) contra `MEMORY.md` (estado actual).

**Prioridad de selección aplicada:** la sección `/admin` se completó (PR #29): `AdminInicioComponent` (índice con las 4 secciones futuras, ninguna implementada todavía), ruta `/admin` guardada con `RoleGuard('administrador')` y enlace "Administración" condicional en el header (`computed()` sobre `authService.usuario()` + `usuariosService.usuarioActual()?.rol`, para que desaparezca de inmediato al cerrar sesión). 7 tests unitarios nuevos (5 de `App` + 2 de `AdminInicioComponent`). Verificado con un login real elegido explícitamente por el usuario ("Verificación manual tuya"): confirmó en vivo contra `staging` que el enlace y `/admin` funcionan con la cuenta `administrador`, y que un `vendedor` no ve el enlace ni puede acceder. Sube a Tarea 1 el escaneo de código de barras con cámara (ya estaba en el TODO como Tarea 2, sin cambios de contenido). Se agrega como Tarea 2 `GestionEstantesComponent` — primer CRUD real de administración (`PRD.md` §6, "Configuración de estantes (CRUD)", prioridad Media, ahora desbloqueada porque `/admin` ya existe como punto de entrada): el backend (`CRUD /api/estantes`) ya está implementado y verificado en vivo desde hace varias tareas, pero ningún frontend lo consume para escritura (`EstantesService` hoy solo tiene `GET`, usado por `CatalogarLibroComponent`/`CambiarEstanteComponent`). Ambas tareas son independientes entre sí: una toca únicamente `CatalogarLibroComponent`/`/catalogar`, la otra agrega una pantalla nueva bajo `/admin/estantes`.

---

## Tarea 1 — [FEATURE]: escaneo de código de barras con cámara en `CatalogarLibroComponent`

**Origen:** `PRD.md` §5.2 ("Flujo de catalogación completo": escanear ISBN con la cámara es el primer paso, antes del autocompletado de metadatos), prioridad Alta en la tabla de roadmap (`PRD.md` §6). `tech-specs.md` línea 86 ya decide la librería (`@zxing/browser`, alternativa `html5-qrcode`) — no queda pendiente de diseño, solo de implementación. Independiente de la Tarea 2 (`GestionEstantesComponent`): esta tarea solo toca `CatalogarLibroComponent`/`/catalogar`, ya existente y guardado con `RoleGuard(['vendedor', 'administrador'])`.

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

---

## Tarea 2 — [FEATURE]: `GestionEstantesComponent` — CRUD real de estantes en `/admin/estantes`

**Origen:** `PRD.md` §6 ("Configuración de estantes (CRUD)", prioridad Media) y `tech-specs.md` §4.2 (ruta `/admin/estantes`, `AuthGuard` + `RoleGuard(admin)`). El backend (`CRUD /api/estantes`, administrador exclusivo para escritura) ya está implementado y verificado en vivo desde hace varias tareas — esta es la primera pantalla real de administración que lo consume, ahora que `/admin` existe como punto de entrada (`TODO.md` histórico, PR #29). Primer CRUD de los 3 pendientes (`estantes`, `usuarios`, `editoriales-descuentos`) — se elige `estantes` primero por ser el más simple (3 campos: `espacio`, `mueble`, `ubicacion`, sin relaciones con otras tablas) y porque `EstantesService` ya existe (hoy solo lectura).

**Archivos:** `src/app/core/api/estantes.service.ts` (extender con métodos autenticados `crearEstante`/`actualizarEstante`/`eliminarEstante`, mismo patrón que `cargarEstantes`), `src/app/features/admin/gestion-estantes.component.ts` (nuevo), ruta nueva `/admin/estantes` en `app.routes.ts` (guardada con `RoleGuard('administrador')`, mismo patrón que `/admin`), `src/app/features/admin/admin-inicio.component.html` (cambiar la card "Estantes" de placeholder deshabilitado a `routerLink="/admin/estantes"` real).

**Qué hacer:**
1. Extender `EstantesService` con `crearEstante(datos)`/`actualizarEstante(estanteId, datos)`/`eliminarEstante(estanteId)` — peticiones autenticadas (`Authorization: Bearer <idToken>`) a `POST`/`PUT`/`DELETE /api/estantes`, mismo patrón de manejo de error que el resto de servicios de `core/api`. Recargar `estantes` (Signal existente) tras cada operación exitosa.
2. Implementar `GestionEstantesComponent` (standalone, ruta `/admin/estantes`): lista los estantes existentes (reutilizando `cargarEstantes()`), formulario reactivo para crear uno nuevo, edición y borrado por fila, mensajes de éxito/error.
3. Agregar la ruta a `app.routes.ts` (`RoleGuard('administrador')`) y a `app.routes.server.ts` (`RenderMode.Client`, mismo motivo que `/admin`/`/catalogar`). Activar el enlace real desde `AdminInicioComponent`.
4. Cubrir con `npm test -- --watch=false`: los 3 métodos nuevos de `EstantesService` (éxito/error) y los casos principales de `GestionEstantesComponent` (lista, crea, edita, elimina, error).

**Definition of done:**
- [ ] `npm run build` y `npm test -- --watch=false` pasan sin errores
- [ ] Tests unitarios cubren los métodos nuevos del servicio y los casos principales del componente
- [ ] Verificado manualmente contra `staging` (misma decisión de verificación que las tareas de frontend anteriores: combinar evidencia o pedir verificación manual al usuario — ya existe una cuenta `administrador` real sembrada, `letiende.co@gmail.com`)
- [ ] Un `vendedor` no puede acceder a `/admin/estantes` (`RoleGuard`, misma protección ya usada en `/admin`)
