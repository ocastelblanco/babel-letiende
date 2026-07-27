# TODO.md — Babel

Motor JIT: este documento mantiene **siempre exactamente 2 tareas atómicas** activas. Al completar cualquiera, se elimina, se mueve el resumen a `MEMORY.md` §2, y se calcula la siguiente tarea más prioritaria comparando `PRD.md` (roadmap) contra `MEMORY.md` (estado actual).

**Prioridad de selección aplicada (2026-07-27):** el usuario cerró su ronda de pruebas manuales en `staging` (pausa iniciada 2026-07-25 tras `ajustes-finales.md` Tareas A-G) y entregó un nuevo lote de ajustes en `ajustes-2026-07-27.md`. El motor JIT se retoma con las 3 tareas que ese documento describe para Babel, en el orden en que aparecen en el documento, **antes** de las 2 últimas piezas del roadmap (modo offline, producción) que quedaron en pausa — instrucción explícita del usuario. La cuarta pieza de `ajustes-2026-07-27.md` — el generador de QR para imprimir — es una herramienta fuera de Babel (no vive en la app, no consume su API) y el usuario la excluyó deliberadamente de este orden: se rastrea aparte, en su propia pista independiente (ver sección al final), sin ocupar ninguno de los 2 slots activos.

**Tarea 1 completada (2026-07-27):** vista Lista/Tarjetas + orden Título/Autor/Precio en `CatalogoPublicoComponent` (PR #67, fusionado por el usuario). Se promueve el siguiente ítem del backlog (Reporte de ventas — Descuento de venta) al segundo slot activo.

**Tarea 1 (Gestionar > Editar) completada (2026-07-27):** todos los campos del libro editables + paneles como Catalogar (PR #69, probado por el usuario). Con esto se cierra el backlog completo de `ajustes-2026-07-27.md` salvo la pista independiente del generador de QR (ver más abajo). Queda un solo ajuste pendiente de esta ronda (Reporte de ventas) — se promueve **Modo offline** al segundo slot activo como siguiente pieza del roadmap, pero no debe iniciarse hasta cerrar también el Reporte de ventas y confirmar con el usuario que no hay más ajustes de esta ronda.

**Reporte de ventas completado (2026-07-27):** columna "Descuento de venta" en `handlerExportar` (PR #70, probado por el usuario en `staging`). Con esto se cierra el backlog completo de `ajustes-2026-07-27.md` — solo queda pendiente la pista independiente del generador de QR (ver más abajo), que el usuario confirmó dejar para después. El roadmap principal retoma sus últimas 2 piezas (`PRD.md` §6): el usuario eligió explícitamente **Modo offline primero**, luego Producción — se llenan los 2 slots activos en ese orden.

**Modo offline CANCELADO (2026-07-27, decisión explícita del usuario):** antes de planear la implementación (se llegó a producir un plan completo, descartado sin código), el usuario decidió cancelarlo por completo — los cortes de wifi en la librería son muy infrecuentes (menos de 1 al mes) y ya se resuelven compartiendo datos móviles del celular con el que se cataloga; no se justifica el costo de mantener una cola de sincronización. Ver `PRD.md` §6/§9 para el detalle. En su lugar, el usuario trajo 2 ajustes nuevos a los reportes, que ocupan los 2 slots activos antes de retomar Producción.

---

## Tarea 1 — Reporte de ventas: nuevas columnas y reordenamiento

`server/api/handlers/ventas.ts` (`handlerExportar`/`consultarVentasFiltradas`):

- Agregar columnas: **Descuento editorial** (`Libro.porcentajeDescuentoEditorial` resuelto por `bookId`, mismo criterio "valor actual" ya usado para Título/Editorial — decisión confirmada del usuario), **Ejemplares vendidos** (`Venta.cantidad`), **Venta total** (`Venta.precioFinal`), **Vendedor** (`Venta.vendidoPor`, el email es suficiente).
- Cambiar **PVP** → **PVP unitario** (mismo campo, `Venta.pvp`).
- Cambiar **Costo** para que refleje el costo TOTAL de la transacción (`Venta.costoLibro * Venta.cantidad`), no el costo unitario actual — decisión confirmada del usuario, va entre "Venta total" y "Utilidad".
- Orden final de columnas: Fecha de venta, ISBN, Título, Editorial, Descuento editorial, PVP unitario, Ejemplares vendidos, Descuento de venta, Venta total, Costo, Utilidad, Forma de pago, Vendedor.
- `Utilidad` ya está correctamente calculada a nivel de transacción completa (`precioFinal - costoLibro*cantidad`) — no requiere cambios, solo reordenar.

## Tarea 2 — Reporte de inventario: fecha de catalogación y catalogador

`server/api/handlers/libros.ts` (`handlerExportarInventario`):

- Agregar **Fecha de catalogación** (`Libro.creadoEn`) al INICIO de las columnas.
- Agregar **Catalogado por** (`Libro.creadoPor`, el email es suficiente) al FINAL de las columnas.
- La columna **Cantidad** ya refleja `Libro.cantidadDisponible` (no `cantidadTotal`) vía un `escanearTodo` completo (no filtra libros agotados) — confirmado leyendo el código, ya cumple lo pedido, sin cambios.

---

## Backlog

1. **Primer despliegue a producción** (`PRD.md` §6) — sin desglosar todavía en pasos atómicos; incluye al menos decidir dominio personalizado, revisar el objetivo de costo $0 con tráfico real, y una checklist de lo ya verificado en `staging` vs. lo que falta confirmar en producción.

No iniciar producción sin antes cerrar las Tareas 1 y 2 de arriba y confirmar con el usuario que no hay más ajustes pendientes.

---

## Pista independiente (fuera de Babel) — Generador de QR para muebles

No ocupa los 2 slots activos del motor JIT (decisión explícita del usuario). Se implementa cuando el usuario lo pida, en paralelo o después de las tareas de arriba, sin bloquear ni ser bloqueada por ellas.

**Qué:** script Node.js standalone en `tools/qr-muebles/` (carpeta propia dentro del repo de Babel, con su propio `package.json`, **excluida del build/deploy de Angular/Lambda** — no se referencia desde `angular.json` ni `serverless.yml`) que:

1. Lee `babel-espacios` y `babel-muebles` de DynamoDB directamente (AWS SDK v3, perfil `default` de `~/.aws/config`, región `us-east-1` — decisión confirmada del usuario, sin pasar por la API de Babel).
2. Genera un único PDF (decisión confirmada: un solo PDF combinado, no uno por espacio), tamaño carta, con una estampilla circular por mueble:
   - QR centrado con la URL `https://babel.letiende.co/?espacio={espacioId}&mueble={muebleId}` (mismo contrato de query params que la Tarea F de `ajustes-finales.md`).
   - Arco superior: "¿QUÉ TESOROS SE ESCONDEN AQUÍ?".
   - Arriba del QR: nombre del Espacio.
   - Debajo del QR: nombre del Mueble.
   - Arco inferior: "¡ESCANEA Y DESCÚBRELOS!".
   - Ver ejemplo en `/Users/ocastelblanco/Documents/LeTiende/letiende.co/fuentes/QR-ejemplo.png`.
3. Diámetro configurable (default 8cm) — el usuario va a comprar un cortador de círculos para papel autoadhesivo y puede querer ajustar el tamaño después.

**Por definir al implementar** (nada de esto se decidió todavía): librería de generación de PDF/QR/texto en arco, cuántas estampillas caben por página carta según el diámetro elegido, si se agregan guías de corte.

Detalle completo de las decisiones ya confirmadas en `ajustes-2026-07-27.md` ("Decisiones técnicas confirmadas") y `MEMORY.md` (`babel-herramienta-qr-decisiones`).
