# Esquema de eventos v1.0

## Tabla de contenidos

- [Principio: procedencia de cada dato](#principio-procedencia-de-cada-dato)
- [Evento completo](#evento-completo)
- [Granularidad: turno vs. unidad de trabajo](#granularidad-turno-vs-unidad-de-trabajo)
- [Los cuatro ejes de `actor` + `execution`](#los-cuatro-ejes-de-actor--execution)
- [Costo y régimen de facturación](#costo-y-régimen-de-facturación)
- [Enums](#enums)
- [Validación](#validación)
- [Compatibilidad con un CSV heredado](#compatibilidad-con-un-csv-heredado)

---

## Principio: procedencia de cada dato

Cada campo pertenece a exactamente una clase, declarada en `provenance`:

| Clase | Definición | Quién lo escribe | Regla |
|---|---|---|---|
| `measured` | Derivado de un artefacto de máquina | Un adaptador | El agente **nunca** lo escribe de memoria. Sin adaptador → `null` |
| `declared` | Afirmado por una persona sobre su propio trabajo | El humano | Debe ir en `provenance.declared` |
| `derived` | Calculado con fórmula documentada | Un script | Debe declarar la referencia usada |

Esto convierte "no inventes datos" en una propiedad verificable del archivo: un evento con un campo `measured` sin `provenance.adapter` es inválido y el validador lo rechaza.

Pedirle a un LLM cuántos tokens consumió, cuánto costó o a qué hora empezó es pedirle justo el tipo de dato que no puede conocer y sí puede confabular de forma plausible. La solución no es un prompt más severo: es quitarle el campo de las manos.

---

## Evento completo

```jsonc
{
  "schema_version": "1.0",
  "event_id": "01J9F2K8XYZ...",           // ULID: ordenable por tiempo
  "project_id": "agora-letiende",
  "corrects": null,                        // event_id que este evento corrige

  "unit": {
    "type": "work_unit",                   // turn | work_unit
    "turn_ids": ["01J9F2...", "01J9F3..."],
    "aggregates": 3
  },

  // Unión con la capa de documentación
  "trace_id": "T-0042",                    // tarea de TODO.md
  "spec_ref": ["PRD.md#OBJ-3", "tech-specs.md#5.2"],
  "stage": "backend",
  "task_type": "feature",

  "actor": {
    "role": "ai",                          // ai | human
    "id": "claude-sonnet-5",               // model id exacto | iniciales humanas
    "provider": "anthropic",               // quién factura
    "surface": "claude-code-cli",          // qué harness
    "device": "cli",                       // dónde estaba LA PERSONA
    "effort": "high",                      // medido: low|medium|high|xhigh|max
    "session_id": "3cd12527-...",
    "is_subagent": false
  },
  "execution": {
    "host": "local"                        // dónde corrió EL TRABAJO
  },

  "time": {
    "start": "2026-08-27T19:30:00Z",
    "end":   "2026-08-27T19:56:00Z",
    "tz_display": "America/Bogota",
    "wall_s": 1560,
    "agent_active_s": 1180,
    "human_active_s": 380,
    "human_review_s": 240,                 // el peaje
    "human_wait_s": 0,
    "review_measurement": "focus_based"    // focus_based | gap_based | declared
  },

  // Vocabulario canónico, NO nativo. Ver adapter-contract.md
  "tokens": {
    "input_uncached": 2,                   // disjunto de cache_read
    "cache_read": 0,
    "cache_write_short": 0,
    "cache_write_long": 55967,
    "output": 181,
    "thinking": 0                          // subconjunto de output
  },

  "cost": {
    "usd": 0.2257,                         // precio sombra a tarifa de lista
    "marginal_usd": 0,                     // 0 bajo flat_rate
    "allocated_usd": 0.41,                 // parte de la cuota mensual
    "regime": "flat_rate",                 // flat_rate | metered_api
    "basis": "subscription_shadow",        // list_price | invoice | subscription_shadow
    "cost_model": "anthropic",
    "pricing_ref": "pricing.json@2026-06-24",
    "method": "computed"
  },

  "outcome": {
    "status": "accepted",                  // accepted | reworked | rejected | abandoned
    "iterations": 3,
    "tool_errors": 2,
    "rejected_edits": 1,
    "cognitive_load": "medium"             // declarado por el humano (SPACE)
  },

  "change": {
    "files_touched": 4,
    "lines_added": 210,
    "lines_removed": 38,
    "commits": ["a1b2c3d"],
    "pr": 56,
    "reverted": false
  },

  "milestone": "Borra el evento espejo de Calendar al cancelar un evento",

  "provenance": {
    "measured": ["tokens", "time.agent_active_s", "actor.effort", "change"],
    "declared": ["outcome.cognitive_load", "milestone", "task_type"],
    "derived":  ["cost.usd", "time.wall_s"],
    "adapter": "claude-code-transcript@1.0.0",
    "capture_level": "N2",                 // N0 | N1 | N2 | N3
    "confidence": "measured"               // measured | mixed | declared | legacy
  }
}
```

Todo campo bajo `tokens`, `cost`, `change` y los `*_s` de `time` acepta `null`. `null` significa "no se pudo medir" y es siempre preferible a una estimación.

---

## Granularidad: turno vs. unidad de trabajo

Un **turno** es un intercambio prompt → respuesta: exacto y automático. Una **unidad de trabajo** es una tarea cerrada: legible por humanos y comparable con un histórico de hoja de horas.

El sistema hace las dos cosas. N2 captura turnos; `capture` los agrega en un `work_unit` al cerrar la tarea; `report` y la vista CSV operan sobre `work_unit`.

**Regla de agregación fácil de equivocar:**

| Campo | Cómo se agrega |
|---|---|
| `time.wall_s` | **Lapso** del primer `start` al último `end` |
| `time.agent_active_s`, `human_*_s` | Suma de los turnos |
| `tokens.*` | Suma de los turnos |
| `outcome.iterations` | Número de turnos agregados |

Sumar turnos para obtener `wall_s` cuenta dos veces los huecos entre ellos — que es exactamente donde vive el peaje de revisión — e infla el total.

---

## Los cuatro ejes de `actor` + `execution`

Un solo campo `device` mezcla tres preguntas distintas. La confusión solo se vuelve visible al salir de la CLI:

| Campo | Qué responde | Determina |
|---|---|---|
| `actor.provider` | Quién factura | La función de costo |
| `actor.surface` | Qué harness | El adaptador |
| `actor.device` | Dónde estaba la persona | Nada técnico: es análisis |
| `execution.host` | Dónde corrió el trabajo | Dónde vive el registro |

| Escenario | `device` | `execution.host` |
|---|---|---|
| Terminal en el portátil | `cli` | `local` |
| Sesión cloud desde el teléfono | `mobile` | `cloud-vm` |
| Remote Control desde el teléfono | `mobile` | `local` |
| Dispatch desde el teléfono | `mobile` | `local` |
| Cliente propio contra API de DeepSeek | `desktop` | `api` |

Las tres filas de móvil serían indistinguibles con un solo campo, y sin embargo la de en medio corre en una VM que no toca la máquina del usuario mientras las otras dos sí.

---

## Costo y régimen de facturación

`cost.regime` determina qué significa cada cifra:

| Régimen | Ejemplos | `marginal_usd` | `usd` |
|---|---|---|---|
| `flat_rate` | Claude Code Max, Codex con plan ChatGPT, Gemini Code Assist | `0` | Precio sombra a tarifa de lista |
| `metered_api` | Cline, OpenCode, Antigravity, Hermes o cliente propio con API key | tokens × tarifa | Gasto real facturable |

Bajo `flat_rate`, `allocated_usd` reparte la cuota mensual entre los eventos del mes por participación de tokens:

```
allocated_usd(e) = cuota_mensual × tokens_facturables(e) / Σ tokens_facturables(mes)
```

donde `tokens_facturables = input_uncached + cache_read + cache_write_* + output`. Se recalcula al cerrar el mes, porque el denominador no se conoce antes. Hasta entonces, `allocated_usd` es `null`.

**Por qué las tres cifras.** `marginal_usd` es la verdad económica bajo suscripción: un token más no cuesta nada, y decidir como si costara lleva a subutilizar lo ya pagado. `usd` es lo que hace comparable una suscripción con una API. `allocated_usd` es lo que responde "¿qué me costó de verdad este proyecto este mes?".

Si la tarifa no está verificada: registra los tokens y deja `usd` en `null` con `pricing.status: "unverified"`. Los tokens sin costo son un dato incompleto; un costo inventado es un dato falso.

---

## Enums

**`stage`** — `specs_definition` · `workspace_setup` · `scaffold` · `cloud_infrastructure` · `auth` · `frontend` · `backend` · `testing` · `deployment` · `maintenance`. Extensible en `config.json`.

**`task_type`** — ortogonal a `stage`. Es la dimensión que responde "¿en qué *tipo* de tarea me sale caro el modelo grande?": `spec` · `feature` · `bugfix` · `refactor` · `test` · `docs` · `infra` · `review` · `research` · `chore`.

**`actor.provider`** — `anthropic` · `openai` · `google` · `deepseek` · `alibaba` · `moonshot` · `local` · `human`

**`actor.surface`** — `claude-code-cli` · `claude-code-web` · `claude-desktop` · `codex-cli` · `gemini-cli` · `antigravity` · `cline` · `opencode` · `hermes` · `custom-api-client` · `aws-console` · `editor` · `other`

**`actor.device`** — `cli` · `web` · `desktop` · `mobile`

**`execution.host`** — `local` · `cloud-vm` · `self-hosted` · `api`

**`outcome.status`** — `accepted` · `reworked` · `rejected` · `abandoned`

---

## Validación

```bash
node scripts/core/ledger.mjs validate --dir metrics/events/
```

Comprueba, en este orden:

1. Campos obligatorios presentes y enums válidos.
2. **Todo campo listado en `provenance.measured` tiene `provenance.adapter`.**
3. `cache_read` y `input_uncached` no se solapan (ninguno es `null` si el otro no lo es).
4. `thinking <= output`.
5. `unit.type: "work_unit"` con `turn_ids` no vacío tiene `aggregates == turn_ids.length`.
6. `cost.usd` no nulo exige `pricing_ref` y `cost_model`.
7. `corrects` apunta a un `event_id` existente.
8. `time.end >= time.start`.

---

## Compatibilidad con un CSV heredado

| Columna típica | Campo v1.0 |
|---|---|
| `stage` | `stage` (normalizado) |
| `start` / `finish` | `time.start` / `time.end` (a UTC) |
| `time` | `time.wall_s` |
| `role` | `actor.role` |
| `model` | `actor.id` + `actor.provider` (inferido) |
| `milestone` | `milestone` |
| `tool` | `actor.surface` (inferido) |
| `device` | `actor.device` |
| `effort` | `outcome.cognitive_load` — era una apreciación, no una medición |

Toda fila migrada lleva `capture_level: "N0"`, `confidence: "legacy"`, `unit.type: "work_unit"`, y `tokens`/`cost` en `null`.
