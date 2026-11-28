# Suite de evaluación del asistente

Fase 4 del plan (`T-0041` base sin LLM, `T-0042` ejecutor y línea base, `T-0043` compuerta). Explicación completa, cifras y decisiones en [`../bitacora/06-evaluacion.md`](../bitacora/06-evaluacion.md).

## Qué hay aquí

| Ruta | Qué es | ¿En git? |
|---|---|---|
| `casos/*.json` | Los casos, un archivo por categoría (A aceptables, R restricciones, S sin respuesta, M ambiguos, ID inyección directa, II inyección indirecta, P políticas) | Sí |
| `casos/parches-congelado.json` | Sinopsis envenenadas que se aplican **en memoria** a la copia congelada para los casos de inyección indirecta | Sí |
| `congelado/` | Copia del inventario de producción, su índice y los candidatos a validar | **No** (sinopsis de terceros, ADR-018) |
| `resultados/` | Resultados crudos de las corridas (con las respuestas del modelo) | **No** |
| `resumenes/` | Resumen agregado de cada corrida, sin respuestas | Sí |

## Flujo de la Fase 4a

```text
congelar-inventario.mjs   producción (solo lectura, lista blanca) ──► congelado/{libros,conocimiento,ubicaciones,manifiesto}.json
construir-indice-evals.mjs  copia + parches ──► Gemini embeddings ──► congelado/indice.bin
evaluar-recuperador.mjs --candidatos  ──► congelado/candidatos.md   (tú marcas los aceptables)
importar-validacion.mjs   candidatos.md ──► casos/*.json (solo bookId)
evaluar-recuperador.mjs   Recall@8, Recall@40, Hit@8, Hit@40
```

Todos los scripts están en [`../scripts/`](../scripts/) y requieren `npm run build:api`. Los que llaman a Gemini necesitan `GEMINI_API_KEY` en el entorno o en `.env` (ignorado por git).

## Flujo de la Fase 4b

```text
evaluar-recuperador.mjs --complemento   libros que los límites del caso hacen aparecer ──► congelado/candidatos-complemento.md
importar-validacion.mjs --complemento   los suma a los aceptables (no los reemplaza)
ejecutar-evals.mjs --prompt v5,v4 --repeticiones 3   responder() en el proceso ──► resultados/<sello>.jsonl + resumenes/<sello>.md
```

Las corridas usan la clave del perfil que pidas: `EVALS_CLAVE=production` toma la de pago del `.env` (la de `staging` es gratuita y su cuota diaria no alcanza para el índice ni para una corrida completa). Con la de pago: `--rpm 60 --max-llamadas 900`. Una corrida completa (276 ejecuciones) tarda unos 6 minutos.

## Fase 5: recalificar sin llamar a la API

```text
ejecutar-evals.mjs --repuntuar resultados/<corrida>.jsonl   respuestas guardadas + casos de hoy ──► resumenes/<corrida>-repuntuada.md
```

Sirve cuando cambian los casos o los aceptables (por ejemplo, después de importar una validación): vuelve a calificar las respuestas guardadas sin gastar cuota. Un caso renombrado lleva `antes` con su id anterior (A16 era S06) para seguir calificando las corridas viejas. El resumen cuenta también las búsquedas que forzó el servidor (bitácora 07).

Campos nuevos de los casos: `avisoCercanos` (solo en «sin respuesta»: expresiones que, si el texto las cumple, permiten recomendar libros cercanos) y `antes`.

## Cómo validar los candidatos (tu parte)

Abre `congelado/candidatos.md`. Cada pregunta trae unos 15 a 20 libros: los que encontró el recuperador y los que encontró una búsqueda por palabras. Marca con `x` los que serían una buena respuesta y agrega con `+ ISBN` o `+ Título exacto` los que conozcas y falten. El orden está barajado a propósito, para que los primeros no pesen más. Cuando termines, avísame.

## Fase 6: preguntas libres con `preguntar.mjs`

```text
preguntar.mjs "una novela por menos de $30.000"     pregunta suelta
preguntar.mjs --idioma en --precio-maximo 50000 "…"   con filtros
preguntar.mjs                                        conversación de varios turnos
```

Corre `responder()` (el código de la Lambda) sobre la copia congelada de producción y el índice local, sin tocar AWS ni escribir nada en disco: tus preguntas no se guardan (los embeddings de las consultas de las evaluaciones se leen, nunca se escriben). Imprime el texto, las recomendaciones con precio e idioma y una línea con `meta` (herramientas usadas, búsqueda forzada, latencia, descartados). Sirve para probar a mano con el catálogo completo, porque `staging` tiene muy pocos libros. Opciones: `--prompt v6` (otra versión), `--sin-adultos`, `--json` (respuesta cruda). En la conversación: `/nueva`, `/filtros idioma=en precio=30000 adultos=no` y `/salir`. Usa la clave de `staging` (gratuita) salvo que pongas `EVALS_CLAVE=production`.

Casos P09 y P10 (21/11/2026): regresión de existencias y ubicación inventadas (bitácora 07, §6). P09 es una conversación en la que el asistente recomendó un libro (campo `libros` del mensaje, que es como lo reenvía el cliente) y la persona pregunta dónde está y cuántos quedan; P10 lo pregunta en un solo turno. Piden la ubicación real de la copia congelada y prohíben pisos, estanterías o cantidades inventadas y las respuestas del tipo «consúltalo en la librería».

## Fase 4c: la compuerta

```text
ejecutar-evals.mjs --prompt v7 --repeticiones 3    resultados/<corrida>.jsonl ──► resumenes/<corrida>.md + resumenes/<corrida>.json
comparar-evals.mjs resumenes/<corrida>.json         línea base (linea-base.json) ──► PASA (0) o FALLA (1)
```

**Regla:** antes de cambiar el prompt vigente o el modelo, corre la suite con 3 repeticiones, sube el `.json` del resumen en el PR y pasa la compuerta (`npm run evals:comparar -- asistente-ia/evals/resumenes/<corrida>.json`, o el workflow *Asistente - compuerta de evaluación* en GitHub Actions). Si falla, no se cambia. Las reglas y sus límites están en la [bitácora 06 §7](../bitacora/06-evaluacion.md).

- `linea-base.json`: el resumen de referencia (v5, corrida `20261124-1020`). Para fijar otra: `npm run evals:comparar -- --fijar <resumen.json> --version vN --nota "motivo"`, en un PR aparte.
- Una corrida que trae varias versiones (`--prompt v7,v5`) se compara versión por versión con `--version`.
- Tolerancias opcionales: `--tolerancia-categoria 0.15`, `--tolerancia-global 0.05`, `--max-errores 0.1`, `--permitir-casos-distintos`.
- Códigos de salida: 0 pasa, 1 falla, 2 uso o archivo inválido.

