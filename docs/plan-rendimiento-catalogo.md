# Plan — Rendimiento de la carga del catálogo

**Origen (2026-09-17):** el usuario reportó que la carga del catálogo tarda demasiado, tanto en la pantalla inicial (catálogo público) como en Catalogar > Editar. Se investigó el código real (frontend, handlers Lambda y `serverless.yml`) con un agente de exploración antes de escribir cualquier tarea — la causa es **estructural**, no coyuntural (ni latencia de AWS ni conectividad del usuario).

## 1. Hallazgos

- `GET /api/libros` (catálogo público, `libros.ts:151-162`) y `GET /api/libros/inventario` (Catalogar > Editar, `libros.ts:954-971`) hacen un **`Scan` completo** de `babel-libros` sin paginación real hacia el cliente — devuelven los 3.000+ libros en una sola respuesta.
- `babel-libros` (`serverless.yml:3108-3121`) solo tiene clave primaria `bookId` y GSI por `isbn`. No existe ningún índice que calce con "disponibles" (`cantidadDisponible > 0`) ni con "por ubicación" — el backend está obligado a escanear toda la tabla y filtrar en memoria.
- Con 3.000+ libros el `Scan` supera el límite de ~1 MB por página, así que DynamoDB lo pagina internamente (`escanearPaginado`, `dynamodb.ts`) — varias llamadas `Scan` secuenciales por request. Por eso esos endpoints ya tienen timeout de 25s en vez de 10s (`serverless.yml:164`, `:604`): un parche al síntoma, no a la causa.
- El frontend (`editar-libro.component.html:54`, `catalogo-publico.component.ts`) recibe el arreglo completo y lo renderiza **sin virtual scrolling** — 3.000+ nodos al DOM de una vez — y recalcula filtrado/agrupado/orden (`computed` signals) sobre el arreglo completo en cada tecla de búsqueda.
- `GET /api/libros/indice` (`libros.ts:1298-1318`, ya usado por Catalogar para buscar candidatos por título/autor) sí usa `ProjectionExpression` (8 campos, ~300 KB comprimido a 3.000 libros) — es la referencia correcta de payload liviano, pero tampoco pagina ni usa índice.
- `resolverEjemplares` (`libros.ts:272-287`, ficha de detalle de un libro) tiene un patrón N+1: 1 `Query` al GSI `isbn-index` + 3 `GetItem` por cada ejemplar disponible del mismo ISBN.

Detalle completo del agente de exploración en el historial de la conversación del 2026-09-17 (no se persiste aparte por ser hallazgos de código, verificables releyendo los archivos citados).

## 2. Tareas atómicas (orden de mayor a menor impacto percibido)

1. **Virtual scrolling en Catálogo público y Catalogar > Editar** — frontend puro, sin riesgo de backend. **COMPLETA (2026-09-17, PR #131)**: renderizado incremental con `IntersectionObserver` (`ScrollInfinitoDirective`), ver `TODO.md`.
2. **Paginación real de `GET /api/libros` y `GET /api/libros/inventario`** — cursor `lastEvaluatedKey`, tamaño de página a definir. **Pregunta abierta resuelta con el usuario (2026-09-17):** paginar la respuesta de red rompe el modelo de búsqueda instantánea en memoria que ya usan ambas pantallas (mismo patrón que `GET /api/libros/indice`). El usuario eligió **aplazar esta tarea** y hacer primero la Tarea 3 (más pequeña y de bajo riesgo), para medir si esa mejora ya es suficiente antes de invertir en una paginación real con las 3 opciones evaluadas (progresiva en segundo plano / real con búsqueda en backend / aplazar). Queda en backlog, sin fecha, a la espera de esa medición.
3. **Reducir campos de `GET /api/libros`** a los que usa el listado (proyección, igual que ya hace `/api/libros/indice` — de hecho el mismo tipo `LibroIndice` del frontend, 8 campos: `bookId`, `isbn`, `titulo`, `autor`, `ubicacionId`, `pvp`, `portadaUrl`, `cantidadDisponible`, ya cubre exactamente los campos que usa `CatalogoPublicoComponent`, confirmado leyendo el componente completo). **Promovida al slot activo (2026-09-17)**, por decisión del usuario, por delante de la Tarea 2.
4. **Resolver el N+1 de `resolverEjemplares`** — batch de los `GetItem` de ubicación o pre-carga de la jerarquía en memoria.
5. **GSI disperso por `cantidadDisponible`** en `babel-libros` para convertir el `Scan` de `/api/libros` en `Query`.

Cada tarea se entrega en su propia rama/PR, siguiendo el flujo ya establecido del proyecto. El detalle exacto de las tareas 2, 4 y 5 se termina de precisar (con el usuario, si hay decisiones de producto/UX de por medio) cuando se promuevan al motor JIT.
