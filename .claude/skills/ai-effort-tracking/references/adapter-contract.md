# Contrato de adaptador

Todo lo que el sistema sabe de un proveedor concreto vive aquí. El núcleo (`scripts/core/`) no contiene una sola línea de lógica de proveedor: si algún día aparece, el diseño se rompió.

## Tabla de contenidos

- [`RawUsageRecord`](#rawusagerecord)
- [Las tres reglas](#las-tres-reglas)
- [Mapeo por proveedor](#mapeo-por-proveedor)
- [Por qué esto importa: un error de 3.23×](#por-qué-esto-importa-un-error-de-323)
- [Funciones de costo](#funciones-de-costo)
- [Adaptadores disponibles](#adaptadores-disponibles)
- [Escribir un adaptador nuevo](#escribir-un-adaptador-nuevo)

---

## `RawUsageRecord`

Un adaptador recibe un artefacto nativo —un transcripto, un payload de hook, una métrica OTLP, una respuesta de SDK— y emite:

```jsonc
{
  "provider": "deepseek",
  "surface": "cline",
  "model": "deepseek-chat",
  "started_at": "2026-08-27T19:30:00Z",
  "ended_at":   "2026-08-27T19:31:12Z",
  "tokens": {
    "input_uncached": 1840,
    "cache_read": 12400,
    "cache_write_short": 0,
    "cache_write_long": 0,
    "output": 620,
    "thinking": 180
  },
  "raw": { /* payload nativo íntegro, sin contenido de mensajes */ },
  "capture_level": "N1"
}
```

---

## Las tres reglas

Las tres existen porque su incumplimiento produce errores **silenciosos**.

1. **`input_uncached` y `cache_read` son disjuntos.** El adaptador hace la resta cuando el proveedor no la hace. Si no, el mismo token se cobra dos veces.
2. **`thinking` es subconjunto de `output`.** No se suma aparte al calcular costo. Si no, el razonamiento se cobra dos veces.
3. **`raw` conserva el payload nativo íntegro, menos el contenido de mensajes.** Si mañana se descubre un error de normalización, los eventos se recalculan sin haber perdido nada. Cuesta unos pocos KB por evento y es la póliza de seguro del sistema entero.

---

## Mapeo por proveedor

**Los proveedores cuentan la caché con semánticas mutuamente incompatibles.** Es el punto donde todo se puede romper.

| Proveedor | Campos nativos | Relación entre ellos | Normalización |
|---|---|---|---|
| **Anthropic** | `input_tokens`, `cache_read_input_tokens`, `cache_creation.ephemeral_5m/1h_input_tokens`, `output_tokens`, `output_tokens_details.thinking_tokens` | `input_tokens` **excluye** la caché | directa, campo a campo |
| **OpenAI** | `prompt_tokens`, `prompt_tokens_details.cached_tokens`, `completion_tokens`, `completion_tokens_details.reasoning_tokens` | `cached_tokens` ⊂ `prompt_tokens` | `input_uncached = prompt_tokens − cached_tokens`; sin costo de escritura |
| **DeepSeek** | `prompt_cache_hit_tokens`, `prompt_cache_miss_tokens`, `prompt_tokens` | `prompt_tokens` = hit + miss | `input_uncached = miss`, `cache_read = hit`; tarifas distintas para hit y miss |
| **Google Gemini** | `usageMetadata.*` — nombres exactos **por verificar** | caché explícita | además del precio por token, cobra **almacenamiento por tiempo** |
| **Qwen · Kimi** | compatibles con OpenAI vía gateway | por validar en cada caso | tratar como OpenAI **solo tras verificar** |

> **Compatibilidad de formato no es compatibilidad de facturación.** Que un proveedor acepte el SDK de OpenAI no garantiza que devuelva los mismos campos de `usage` ni que facture igual. Cada uno necesita su fila en `pricing.json` y validación empírica antes de darse por bueno.

---

## Por qué esto importa: un error de 3.23×

Mismo trabajo, mismas tarifas, tres proveedores. Consumo normalizado: **1 840** tokens de entrada sin caché, **12 400** leídos de caché, **620** de salida. Tarifas ilustrativas idénticas para aislar el efecto: entrada $1.00, salida $4.00, lectura de caché $0.10 por millón.

Cada proveedor lo reporta distinto:

| Proveedor | Payload nativo |
|---|---|
| Anthropic | `input_tokens: 1840` · `cache_read_input_tokens: 12400` · `output_tokens: 620` |
| OpenAI | `prompt_tokens: 14240` · `cached_tokens: 12400` · `completion_tokens: 620` |
| DeepSeek | `prompt_tokens: 14240` · `hit: 12400` · `miss: 1840` · `completion: 620` |

Normalizado bien, los tres dan lo mismo:

```
input_uncached:  1 840 × $1.00/1M = $0.001840
cache_read:     12 400 × $0.10/1M = $0.001240
output:            620 × $4.00/1M = $0.002480
                                  ─────────────
                                    $0.005560
```

Ahora el error: un adaptador de OpenAI escrito por analogía con Anthropic copia `prompt_tokens` a `input_uncached` sin restar `cached_tokens` —porque en Anthropic ese campo ya viene limpio— y además cuenta `cache_read` aparte:

```
input_uncached: 14 240 × $1.00/1M = $0.014240   <- incluye la cache, cobrada entera
cache_read:     12 400 × $0.10/1M = $0.001240   <- y contada otra vez
output:            620 × $4.00/1M = $0.002480
                                  ─────────────
                                    $0.017960   ->  3.23x el costo real
```

**No lanza una excepción ni da un absurdo: da $0.0180 donde debía haber $0.0056.** Una cifra perfectamente presentable. Sin la regla de disjunción y sin `raw` para recalcular, ese factor se instala en el histórico y nadie tiene cómo detectarlo.

---

## Funciones de costo

`pricing.json` declara un `cost_model` por proveedor. El núcleo aplica la función que el evento declare; **nunca una fórmula común**.

| `cost_model` | Fórmula (por millón de tokens) |
|---|---|
| `anthropic` | `input_uncached×in + cache_read×in×0.1 + cache_write_short×in×1.25 + cache_write_long×in×2 + output×out`<br>Multiplicadores por defecto; un modelo puede sobrescribirlos en su fila (`cache_multipliers`), p. ej. Opus 5.5 lee caché a 0.05× |
| `openai` | `input_uncached×in + cache_read×cached_in + output×out` |
| `deepseek` | `input_uncached×in_miss + cache_read×in_hit + output×out` |
| `google` | `input_uncached×in + cache_read×cached_in + output×out + almacenamiento×horas` |

---

## Adaptadores disponibles

| Adaptador | Fuente | v1 | Estado |
|---|---|---|---|
| `claude-code-transcript` | `~/.claude/projects/<slug>/<session>.jsonl` | sí | **verificado** contra Claude Code 2.1.251 |
| `claude-code-hooks` | hooks de `.claude/settings.json` del repo | sí | **verificado** en documentación; corre local y cloud |
| `claude-code-otel` | OTLP (`claude_code.*`) | sí | **verificado** en documentación |
| `api-wrapper` | `response.usage` del SDK | sí | máxima fidelidad; cubre Anthropic, OpenAI, DeepSeek, Qwen, Kimi |
| `manual` (N0) | declarado por el humano | sí | siempre disponible |
| `gemini-cli-otel` | `gen_ai.client.token.usage` vía `.gemini/settings.json` | Fase 2.5 | **verificado** en documentación; falta probar |
| `codex-cli-rollout` | `~/.codex/sessions/rollout-*.jsonl`, eventos `token_count` | Fase 2.5 | **plausible; requiere validación empírica** |

El estado de verificación es parte de la tabla, no una nota al pie. Publicar `codex-cli-rollout` como verificado sería exactamente el tipo de afirmación que esta skill existe para evitar.

---

## Escribir un adaptador nuevo

1. Colócalo en `scripts/adapters/<nombre>.mjs`. **Nunca en `core/`.**
2. Exporta `toRawUsageRecords(nativePayload, opts) -> RawUsageRecord[]`.
3. Aplica las tres reglas. En particular, mira si el campo de entrada del proveedor **incluye o excluye** la caché antes de escribir la primera línea.
4. Recorta de `raw` cualquier contenido de mensajes antes de guardarlo.
5. Añade una fila a `pricing.json` con `cost_model`, `as_of`, `source_url` y `status`.
6. Fija un payload real de ejemplo como prueba, para que un cambio de formato del proveedor falle ruidosamente en vez de en silencio.
7. Añade tu fila a la tabla de arriba con su estado honesto de verificación.
