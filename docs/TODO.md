# TODO.md — Babel

Motor JIT: este documento mantiene **siempre exactamente 2 tareas atómicas** activas. Al completar cualquiera, se elimina, se mueve el resumen a `MEMORY.md` §2, y se calcula la siguiente tarea más prioritaria comparando `PRD.md` (roadmap) contra `MEMORY.md` (estado actual).

**Prioridad de selección aplicada (2026-07-27):** el usuario cerró su ronda de pruebas manuales en `staging` (pausa iniciada 2026-07-25 tras `ajustes-finales.md` Tareas A-G) y entregó un nuevo lote de ajustes en `ajustes-2026-07-27.md`. El motor JIT se retoma con las 3 tareas que ese documento describe para Babel, en el orden en que aparecen en el documento, **antes** de las 2 últimas piezas del roadmap (modo offline, producción) que quedaron en pausa — instrucción explícita del usuario. La cuarta pieza de `ajustes-2026-07-27.md` — el generador de QR para imprimir — es una herramienta fuera de Babel (no vive en la app, no consume su API) y el usuario la excluyó deliberadamente de este orden: se rastrea aparte, en su propia pista independiente (ver sección al final), sin ocupar ninguno de los 2 slots activos.

**Tarea 1 completada (2026-07-27):** vista Lista/Tarjetas + orden Título/Autor/Precio en `CatalogoPublicoComponent` (PR #67, fusionado por el usuario). Se promueve el siguiente ítem del backlog (Reporte de ventas — Descuento de venta) al segundo slot activo.

**Tarea 1 (Gestionar > Editar) completada (2026-07-27):** todos los campos del libro editables + paneles como Catalogar (PR #69, probado por el usuario). Con esto se cierra el backlog completo de `ajustes-2026-07-27.md` salvo la pista independiente del generador de QR (ver más abajo). Queda un solo ajuste pendiente de esta ronda (Reporte de ventas) — se promueve **Modo offline** al segundo slot activo como siguiente pieza del roadmap, pero no debe iniciarse hasta cerrar también el Reporte de ventas y confirmar con el usuario que no hay más ajustes de esta ronda.

**Reporte de ventas completado (2026-07-27):** columna "Descuento de venta" en `handlerExportar` (PR #70, probado por el usuario en `staging`). Con esto se cierra el backlog completo de `ajustes-2026-07-27.md` — solo queda pendiente la pista independiente del generador de QR (ver más abajo), que el usuario confirmó dejar para después. El roadmap principal retoma sus últimas 2 piezas (`PRD.md` §6): el usuario eligió explícitamente **Modo offline primero**, luego Producción — se llenan los 2 slots activos en ese orden.

**Modo offline CANCELADO (2026-07-27, decisión explícita del usuario):** antes de planear la implementación (se llegó a producir un plan completo, descartado sin código), el usuario decidió cancelarlo por completo — los cortes de wifi en la librería son muy infrecuentes (menos de 1 al mes) y ya se resuelven compartiendo datos móviles del celular con el que se cataloga; no se justifica el costo de mantener una cola de sincronización. Ver `PRD.md` §6/§9 para el detalle. En su lugar, el usuario trajo 2 ajustes nuevos a los reportes, que ocupan los 2 slots activos antes de retomar Producción.

**Reportes de ventas e inventario completados (2026-07-27):** las 2 tareas de arriba se fusionaron (PR #72, PR #73) y el usuario las probó en `staging` — funcionan bien. Con esto se cierra por completo `ajustes-2026-07-27.md`, salvo la pista independiente del generador de QR (el usuario confirmó dejarla para después). Ya no queda ningún otro ajuste pendiente antes de producción.

**Solo 1 tarea activa (sin item para el segundo slot):** el único ítem que le queda al roadmap principal (`PRD.md` §6) es "Primer despliegue a producción" — no hay un segundo ítem que promover (mismo caso ya documentado el 2026-07-25 al cerrar `ajustes-finales.md`). La pista del generador de QR sigue deliberadamente fuera de los slots del motor JIT por decisión del usuario.

**Pista independiente del generador de QR — COMPLETA (2026-07-29):** `tools/qr-muebles/` implementado, revisado (2 rondas de `architect`) y fusionado (PR #76) — detalle completo movido a `MEMORY.md` §2. Sin pendientes salvo que el usuario confirme el escaneo físico con celular real antes de imprimir el lote completo (no bloquea nada de este documento).

**Prioridad de selección aplicada (2026-07-29):** el usuario trajo un nuevo lote de 4 ajustes a Babel (3 fixes + 1 pregunta/fix, ninguno documentado antes en `PRD.md`/`ajustes-*.md`). Se investigó el código real (desplegables de ubicación física, componente Catalogar, librería de escaneo `@zxing/browser`, modelo de datos `Libro`) antes de escribir las tareas — hallazgo clave: `bookId` es la clave primaria real, `isbn` es un índice secundario nullable SIN validación de unicidad hoy (el mismo ISBN puede tener N registros). Se resolvieron 2 preguntas de producto con el usuario antes de detallar el alcance.

**Tarea 1 (orden alfabético) y Tarea 2 (mejoras a Catalogar) — COMPLETAS (2026-07-30/31, PR #78 y PR #79 fusionados):** detalle completo movido a `MEMORY.md` §2. La Tarea 2 incluyó una revisión de `architect` que encontró y corrigió una condición de carrera real (pérdida de inventario al fusionar el mismo duplicado desde 2 sesiones casi simultáneas) y un hotfix de deploy (descripción de función Lambda excedía 256 caracteres, reincidencia del gotcha ya documentado — ver `MEMORY.md` §7 reforzado). El usuario ajustó manualmente el aspect ratio de la cámara de 3:1 a 2:1 tras probarlo.

**Prioridad de selección aplicada (2026-07-31):** con las 4 tareas de este lote cerradas y sin más ajustes pendientes, el único ítem que le queda al roadmap principal (`PRD.md` §6) es "Primer despliegue a producción" — se promueve al único slot activo (sin segundo ítem que promover, mismo caso ya documentado el 2026-07-25 y el 2026-07-29). **El usuario pidió explícitamente dejar todo listo (repo sincronizado, documentación al día) pero NO iniciar la implementación/despliegue hasta que él lo indique** — respeta la regla ya vigente de no arrancar esta pieza sin confirmación explícita.

---

## Tarea 1 — Primer despliegue a producción

`PRD.md` §6 — sin desglosar todavía en pasos atómicos; incluye al menos decidir dominio personalizado, revisar el objetivo de costo $0 con tráfico real, y una checklist de lo ya verificado en `staging` vs. lo que falta confirmar en producción.

**NO INICIAR sin que el usuario lo indique explícitamente** — es la pieza más costosa de revertir de todo el roadmap (`ajustes-finales.md`/`ajustes-2026-07-27.md` ya establecieron este criterio) y el usuario lo reconfirmó el 2026-07-31 ("cuando te lo indique"). Cuando dé la señal de arrancar, desglosarla en pasos atómicos antes de tocar código — no asumir el alcance exacto de antemano.

---

## Backlog

Sin ítems — "Primer despliegue a producción" es la última pieza del roadmap principal. Al cerrarla, revisar `PRD.md` completo antes de dar por terminado el roadmap.
