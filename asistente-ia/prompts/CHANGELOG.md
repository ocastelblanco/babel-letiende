# Historial de versiones del prompt del asistente

Cada versión vive en su propio archivo (`asistente-vN.md`) con un encabezado que dice la versión, el modelo con el que se probó, la fecha y el motivo del cambio. **No se edita una versión ya usada:** un cambio es una versión nueva, y la Lambda carga la que indica `VERSION_PROMPT_ASISTENTE`. El encabezado `herramientas: true` indica que el prompt está escrito para usar herramientas; sin él, la Lambda no las ofrece al modelo (así v1 sigue siendo comparable). Desde la Fase 4 todo cambio exige correr la suite de evaluación contra la línea base y anotar aquí el efecto medido.

| Versión | Fecha | Modelo | Motivo | Efecto medido |
|---|---|---|---|---|
| v1 | 2026-11-18 | `gemini-3.5-flash-lite` | Primera versión: reglas de grounding (solo libros de la lista), formato de salida, rechazo de temas ajenos y datos-no-instrucciones. | Pendiente: será la línea base de la Fase 4. |
| v2 | 2026-11-18 | `gemini-3.5-flash-lite` | Agrega herramientas (`buscar_libros`, `consultar_disponibilidad`, `consultar_politicas`) y su criterio de uso; el encabezado `herramientas: true` las activa. Las reglas de v1 no cambian. | Pendiente: Fase 4 la compara contra v1. |
