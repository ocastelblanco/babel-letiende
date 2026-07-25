# TODO.md — Babel

Motor JIT: este documento mantiene **siempre exactamente 2 tareas atómicas** activas. Al completar cualquiera, se elimina, se mueve el resumen a `MEMORY.md` §2, y se calcula la siguiente tarea más prioritaria comparando `PRD.md` (roadmap) contra `MEMORY.md` (estado actual).

**Prioridad de selección aplicada (2026-07-25):** la Tarea G (Reporte de Inventario XLSX) se completó (PR #63) — `GET /api/libros/exportar` (administrador exclusivo) + segunda tarjeta "Reporte de inventario" en `ReportesVentasComponent`, verificado en vivo por el usuario en `staging`. **Con esto se cierra el backlog completo de `ajustes-finales.md` (Tareas A–G).** Por decisión explícita del usuario, el motor JIT queda **en pausa deliberada, sin tareas activas**: antes de detallar y arrancar las 2 últimas piezas del roadmap (modo offline/cola de sincronización y primer despliegue a producción, ambas marcadas "Baja — bloqueado hasta cerrar los ajustes de esta sección" en `PRD.md` §6), el usuario va a correr una ronda de pruebas manuales de flujos completos en `staging` y avisará si hace falta algún ajuste antes de continuar. No se redacta contenido especulativo de "Qué hacer" para esas 2 tareas todavía — a diferencia de toda tarea anterior de este documento, ninguna de las dos tiene detalle de producto más allá de la mención de una línea en `PRD.md`/`ajustes-finales.md`, así que corresponde definirlas junto con el usuario (o con lo que sus pruebas encuentren) antes de comprometerse a un plan.

---

## Sin tareas activas — esperando resultado de la ronda de pruebas manuales del usuario

Cuando el usuario confirme que no hace falta ningún ajuste (o tras resolver los que reporte), retomar aquí con las 2 tareas siguientes del roadmap:

1. **Modo offline / cola de sincronización** para catalogación sin señal (`PRD.md` §6) — sin desglosar todavía en pasos atómicos.
2. **Primer despliegue a producción** (`PRD.md` §6) — sin desglosar todavía en pasos atómicos; incluye al menos decidir dominio personalizado, revisar el objetivo de costo $0 con tráfico real, y una checklist de lo ya verificado en `staging` vs. lo que falta confirmar en producción.

No iniciar ninguna de las dos sin antes releer los hallazgos de la ronda de pruebas del usuario — pueden cambiar el alcance o el orden.
