# Plan — Pestaña "Trasladar" en Catalogar (traslado masivo de libros)

**Fecha:** 05/10/2026 · **Estado:** aprobado por el usuario, pendiente de implementar (2 tareas en `TODO.md`).

## 1. Pedido del usuario

En `/catalogar` se agrega una tercera pestaña, **Trasladar**. El usuario elige un Espacio, luego un Mueble, y una, varias o todas las Ubicaciones de ese mueble. El sistema lista los libros de esas ubicaciones, **todos preseleccionados**; el usuario puede deseleccionar/volver a seleccionar. Un botón flotante con el ícono `moving` (Material Symbols) abre un diálogo con tres desplegables Espacio > Mueble > Ubicación; al presionar **Trasladar**, los libros seleccionados quedan en la nueva ubicación.

## 2. Decisiones de producto (resueltas con el usuario el 05/10/2026)

| # | Pregunta | Decisión |
|---|---|---|
| 1 | Un libro trasladado con el mismo ISBN que otro ya presente en la ubicación destino | **Fusionar automáticamente** (opción a) — ver §4 |
| 2 | ¿Listar libros agotados (`cantidadDisponible = 0`)? | **Ocultos por defecto**, con un interruptor "Mostrar agotados" |
| 3 | ¿Quién puede trasladar? | **Vendedor y administrador** (mismo criterio que el resto de `/catalogar`) |
| 4 | Confirmación | El diálogo muestra el resumen ("Vas a trasladar N libros a Espacio › Mueble › Ubicación"); el botón **Trasladar** ES la confirmación, sin segundo paso |
| 5 | Destino | Una sola ubicación destino para todos los libros seleccionados |

## 3. Lo que se reutiliza (verificado en el código el 05/10/2026)

- `GestionarComponent` (`src/app/features/gestionar/`): patrón de pestañas por `signal<Pestaña>` + `TITULOS_PESTANA` — se agrega `'trasladar'`.
- `LibrosService.cargarInventario()` (`GET /api/libros/inventario`): ya trae TODOS los libros (incluidos agotados) al cliente → la lista de origen se filtra en memoria por `ubicacionId`, **sin endpoint ni índice nuevo** para leer.
- Cascada Espacio → Mueble → Ubicación ya usada en Catalogar/Editar (servicios de ubicación física existentes).
- `ScrollInfinitoDirective` (`appScrollInfinito`) para el renderizado incremental de la lista.
- Botón flotante: mismo estilo que "Volver arriba" del catálogo público (`fixed bottom-6 right-6 z-40 h-12 w-12 rounded-full bg-primary text-neutral ...`). La fuente Material Symbols Outlined se carga completa en `src/index.html` → `moving` funciona sin cambios.

## 4. Diseño del backend — `POST /api/libros/trasladar`

**Por qué un endpoint nuevo** y no N llamadas a `PUT /api/libros/:bookId`: trasladar 200 libros serían 200 invocaciones Lambda, ese endpoint exige el libro completo en el body, y la fusión de duplicados requiere lógica en el servidor (CLAUDE.md A01/A08).

- Nueva función Lambda propia `trasladarLibros` (ADR-008), handler `handlerTrasladar` en `server/api/handlers/libros.ts`. Ruta estática, sin conflicto con `/api/libros/{bookId}` (mismo criterio que `/api/libros/inventario`).
- Body: `{ bookIds: string[], ubicacionIdDestino: string }`. Validaciones: token Firebase (`verifyIdToken`) + rol `vendedor`/`administrador` resuelto en `babel-usuarios`; `bookIds` no vacío, sin repetidos, **tope de 500** por petición; `ubicacionIdDestino` existe en `babel-ubicaciones` (`400` si no).
- Por cada libro (lectura con `GetItem`; `404`-por-ítem → va a `fallidos`):
  - **Ya está en el destino** → `sinCambios`.
  - **Sin ISBN** o **sin duplicado en el destino** → `UpdateItem` `SET ubicacionId, actualizadoEn` con `ConditionExpression attribute_exists(bookId)` → `trasladados`.
  - **Con duplicado por ISBN en el destino** (`Query` sobre `isbn-index`, filtrando `ubicacionId = destino`) → **fusión**, ver abajo → `fusionados`.
- **Duplicados dentro del mismo lote** (dos libros seleccionados con el mismo ISBN y sin registro previo en el destino): se agrupan por ISBN en memoria ANTES de escribir — el primero del grupo se traslada y los demás se fusionan sobre él. No se depende de releer el GSI (`isbn-index` es eventualmente consistente).
- **Fusión — regla (decisión de diseño tomada al detallar la opción a):**
  - El registro del **destino conserva sus datos** (título, PVP, descuento editorial, portada); del trasladado solo se suman ejemplares.
  - Se suman **solo los ejemplares disponibles** del trasladado: `ADD cantidadTotal :n, cantidadDisponible :n` sobre el destino (`n = cantidadDisponible` del origen; atómico, mismo mecanismo que `fusionarLibroDuplicado`), y `SET disponibleParaCatalogo = 'SI'` si `n > 0` (GSI disperso `disponible-index`).
  - El registro de origen: si **no tiene historial** (`cantidadTotal === cantidadDisponible`) se **elimina**; si tiene ejemplares vendidos (`cantidadTotal > cantidadDisponible`) **se conserva** en su ubicación original como agotado (`cantidadTotal -= n`, `cantidadDisponible = 0`, `REMOVE disponibleParaCatalogo`). **Por qué:** `babel-ventas` referencia el `bookId`; borrar un libro con ventas haría que los reportes muestren `'—'` en título/editorial de esas ventas históricas.
  - Ambas escrituras van en una sola `TransactWriteItems` (Update destino + Delete/Update origen), con `ConditionExpression` sobre el origen `cantidadDisponible = :leido` (y `cantidadTotal = :leidoTotal`) → si una venta concurrente cambió el origen, la transacción falla entera y ese libro va a `fallidos` (el usuario reintenta), sin perder ni duplicar inventario.
  - Si el PVP del destino y del trasladado difieren, la respuesta lo informa (`pvpDestino`, `pvpTrasladado`) para que el vendedor lo revise en Editar.
- Respuesta `200`: `{ trasladados: string[], fusionados: { bookId, bookIdDestino, pvpDestino, pvpTrasladado }[], sinCambios: string[], fallidos: { bookId, motivo }[] }`. Errores 500 sin detalles internos (CLAUDE.md A05).
- Concurrencia acotada (p. ej. 10 libros en paralelo) para no exceder los ~29 s de API Gateway con 500 libros.
- **`serverless.yml`:** función nueva con su propio rol IAM de mínimo privilegio: `GetItem`/`UpdateItem`/`DeleteItem` sobre `babel-libros`, `Query` sobre `babel-libros/index/isbn-index`, `GetItem` sobre `babel-usuarios` y `babel-ubicaciones` (`TransactWriteItems` se autoriza con los permisos de cada acción). `package.patterns` con **todos** los módulos que importe `libros.js` (gotcha del PR #137, CLAUDE.md §7 — `npm run build:api` y revisar los patterns antes de abrir el PR). Descripción de la función < 256 caracteres (gotcha ya documentado).

## 5. Diseño del frontend — `TrasladarLibrosComponent`

- Nuevo `src/app/features/gestionar/trasladar-libros.component.{ts,html,spec.ts}`; tercera pestaña "Trasladar" en `GestionarComponent` (título `Trasladar - Le Tiende`).
- **Origen:** desplegables Espacio → Mueble; luego las Ubicaciones del mueble como casillas, con atajo "Todas" (todas marcadas por defecto al elegir el mueble).
- **Lista:** libros del inventario cuyo `ubicacionId` está en las ubicaciones marcadas (agotados ocultos salvo "Mostrar agotados"). Selección por `Set<bookId>` en un signal; al cambiar el filtro de origen, todos los visibles quedan preseleccionados. Controles "Seleccionar todos / ninguno" y contador "N de M seleccionados". Renderizado incremental con `appScrollInfinito`.
- **Botón flotante `moving`:** deshabilitado si no hay selección; abre un diálogo modal (mismo patrón visual que el modal de escaneo del catálogo público) con la cascada de destino y el resumen; **Trasladar** deshabilitado hasta elegir una ubicación destino.
- **Al terminar:** mensaje con el resultado (trasladados / fusionados / sin cambios / fallidos, y los PVP distintos en fusiones), recarga del inventario (`cargarInventario`) y limpieza de la selección.
- `LibrosService.trasladarLibros(bookIds, ubicacionIdDestino)`.
- Interfaz en español (Colombia), interpolación estándar (CLAUDE.md A03), sin `any`.

## 6. Tareas atómicas (una rama/PR cada una, en secuencia por el staging compartido)

1. **Backend** — `feature/endpoint-trasladar-libros`: `handlerTrasladar` + función/IAM/patterns en `serverless.yml` + pruebas (traslado simple, ya-en-destino, sin ISBN, fusión con y sin historial, duplicados dentro del lote, condición fallida por venta concurrente, 400/401/403, tope de 500) + docs.
2. **Frontend** — `feature/pestana-trasladar`: `TrasladarLibrosComponent` + pestaña + método de servicio + pruebas + docs. Se abre solo cuando el PR 1 esté fusionado y desplegado.
