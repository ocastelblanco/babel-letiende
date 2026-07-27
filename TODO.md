# TODO.md — Babel

Motor JIT: este documento mantiene **siempre exactamente 2 tareas atómicas** activas. Al completar cualquiera, se elimina, se mueve el resumen a `MEMORY.md` §2, y se calcula la siguiente tarea más prioritaria comparando `PRD.md` (roadmap) contra `MEMORY.md` (estado actual).

**Prioridad de selección aplicada (2026-07-27):** el usuario cerró su ronda de pruebas manuales en `staging` (pausa iniciada 2026-07-25 tras `ajustes-finales.md` Tareas A-G) y entregó un nuevo lote de ajustes en `ajustes-2026-07-27.md`. El motor JIT se retoma con las 3 tareas que ese documento describe para Babel, en el orden en que aparecen en el documento, **antes** de las 2 últimas piezas del roadmap (modo offline, producción) que quedaron en pausa — instrucción explícita del usuario. La cuarta pieza de `ajustes-2026-07-27.md` — el generador de QR para imprimir — es una herramienta fuera de Babel (no vive en la app, no consume su API) y el usuario la excluyó deliberadamente de este orden: se rastrea aparte, en su propia pista independiente (ver sección al final), sin ocupar ninguno de los 2 slots activos.

**Tarea 1 completada (2026-07-27):** vista Lista/Tarjetas + orden Título/Autor/Precio en `CatalogoPublicoComponent` (PR #67, fusionado por el usuario). Se promueve el siguiente ítem del backlog (Reporte de ventas — Descuento de venta) al segundo slot activo.

---

## Tarea 1 — Gestionar > Editar: todos los campos + paneles como Catalogar

`ajustes-2026-07-27.md`, `src/app/features/gestionar/editar-libro.component.*`, `server/api/handlers/libros.ts`:

- `EditarLibroComponent`/`PUT /api/libros/:bookId` (`DatosEditarLibro`, `validarDatosEditarLibro`) hoy solo permiten editar `ubicacionId`, `cantidadTotal`, `pvp`, `porcentajeDescuentoEditorial`. Extender a TODOS los campos del libro: `titulo`, `autor`, `isbn`, `editorial`, `portadaUrl` (reutilizar el mismo input + lector de código de barras EAN-13 que `CatalogarLibroComponent` para el ISBN).
- Reorganizar el formulario de edición en dos paneles separados, igual que `CatalogarLibroComponent`: primero un panel **Ubicación del libro** (Espacio/Mueble/Ubicación en cascada, ya existe) y, debajo, un panel **Información del libro** (los campos de arriba).
- `bookId` (uuid) sigue siendo la clave primaria real en `babel-libros` — editar el ISBN es un cambio de dato seguro, no toca ninguna clave.

## Tarea 2 — Reporte de ventas: columna Descuento de venta

`ajustes-2026-07-27.md`, `server/api/handlers/ventas.ts`:

- En `handlerExportar`, agregar `'Descuento de venta': venta.porcentajeDescuentoVenta` a las `filas` del `.xlsx`. El campo ya existe en `VentaConLibro`/`Venta` (`porcentajeDescuentoVenta`, no confundir con `porcentajeDescuentoEditorial`) — no requiere cambios de backend más allá de esta columna.

---

## Backlog (siguiente, tras cerrar la Tarea 1 y 2)

1. **Modo offline / cola de sincronización** para catalogación sin señal (`PRD.md` §6) — sin desglosar todavía en pasos atómicos.
2. **Primer despliegue a producción** (`PRD.md` §6) — sin desglosar todavía en pasos atómicos; incluye al menos decidir dominio personalizado, revisar el objetivo de costo $0 con tráfico real, y una checklist de lo ya verificado en `staging` vs. lo que falta confirmar en producción.

No iniciar la tarea de offline ni la de producción sin antes confirmar con el usuario que no hay más ajustes pendientes de esta ronda.

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
