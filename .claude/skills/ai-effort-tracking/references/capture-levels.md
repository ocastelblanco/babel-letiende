# Niveles de captura y superficies

Los niveles describen **cuánta evidencia hay**, no qué herramienta se usa. Qué herramienta se usa lo resuelve el adaptador.

## Tabla de contenidos

- [Dónde corre cada superficie](#dónde-corre-cada-superficie)
- [N0 — Asistido](#n0--asistido)
- [N1 — Extracción de transcripto](#n1--extracción-de-transcripto)
- [N2 — Hooks](#n2--hooks)
- [N3 — OpenTelemetry](#n3--opentelemetry)
- [El peaje de revisión no se mide igual en todas partes](#el-peaje-de-revisión-no-se-mide-igual-en-todas-partes)

---

## Dónde corre cada superficie

La pregunta que determina todo lo demás: **¿dónde vive el sistema de archivos que la captura necesita?**

| Superficie | Dónde corre el trabajo | ¿Alcanza el repo? | Nivel máximo |
|---|---|---|---|
| Claude Code CLI | máquina local | sí | N3 |
| Claude Code web | VM cloud, repo clonado | sí | N3 |
| Claude Desktop | máquina local | sí | N3 |
| Móvil → sesión cloud | VM cloud, repo clonado | sí | N3 |
| Móvil → Remote Control | máquina local | sí | N3 |
| Móvil → Dispatch | máquina local (Desktop) | sí | N3 |
| Cliente API de terceros | proceso propio | sí | N1 equivalente |
| Consola web (AWS, Firebase…) | navegador, sin repo | no | N0 |

**La portabilidad entre superficies de Claude está resuelta por dos decisiones de diseño, no por un adaptador especial:** los hooks viven en `.claude/settings.json` *del repositorio* y el registro vive en `metrics/` *del repositorio*. Cuando una sesión cloud clona el repo, clona el instrumento y el registro juntos.

Dos hechos verificados que lo sostienen (ver `evidence.md`):

1. **Los hooks del repo sí se ejecutan en sesiones cloud** — la documentación de entornos cloud los lista como «part of the clone». Las variables de entorno del cloud environment también permiten `CLAUDE_CODE_ENABLE_TELEMETRY` y `OTEL_*`, así que N3 funciona ahí.
2. **La app móvil no ejecuta código** — es «un cliente de sesiones de Claude Code, no un lugar donde el código corre». Sus tres modos ejecutan en una VM cloud con el repo clonado o en la máquina local. El teléfono nunca captura nada.

> **Requisito para `init`:** commitea los hooks en el `.claude/settings.json` del repositorio, nunca en `~/.claude/settings.json`. El ámbito de usuario no viaja a la nube: un hook instalado ahí funciona en la CLI y falla en silencio en las demás superficies, que es la peor forma de fallar porque el registro queda incompleto sin avisar.

La única superficie que se queda en N0 es la consola web de un tercero, y no por una carencia del diseño: no hay nada que instrumentar en el navegador de otro. Es trabajo humano declarado y así debe registrarse.

---

## N0 — Asistido

Funciona en cualquier herramienta. El agente escribe el evento al cerrar la tarea, **obligado a ejecutar el adaptador correspondiente para los campos medidos**. Si no hay adaptador para esa superficie, esos campos van en `null` con `capture_level: "N0"` y `confidence: "declared"`.

Es el suelo garantizado del sistema y el nivel correcto para el trabajo humano fuera de cualquier agente.

---

## N1 — Extracción de transcripto

Cero infraestructura. Verificado contra `~/.claude/projects/<slug>/<session_id>.jsonl`, Claude Code 2.1.251.

Cada registro `type: "assistant"` contiene:

```jsonc
{
  "type": "assistant",
  "timestamp": "2026-08-31T17:34:39.680Z",
  "sessionId": "3cd12527-...",
  "cwd": "/Users/.../mi-proyecto",
  "gitBranch": "main",
  "version": "2.1.251",
  "effort": "high",
  "isSidechain": false,               // true => el mensaje es de un subagente
  "requestId": "req_...",
  "message": {
    "model": "claude-opus-5",
    "usage": {
      "input_tokens": 2,
      "output_tokens": 181,
      "output_tokens_details": { "thinking_tokens": 0 },
      "cache_read_input_tokens": 0,
      "cache_creation_input_tokens": 55967,
      "cache_creation": {
        "ephemeral_5m_input_tokens": 0,
        "ephemeral_1h_input_tokens": 55967
      },
      "service_tier": "standard",
      "speed": "standard"
    }
  }
}
```

Cada registro `type: "user"` trae `timestamp`, `promptId`, `isMeta` y `userType`.

De ahí se deriva, sin instrumentar nada:

| Campo | Cómo se obtiene |
|---|---|
| `tokens.*` | Suma de `message.usage` sobre los mensajes del turno |
| `actor.id`, `actor.effort` | `message.model`, `effort` |
| `actor.is_subagent` | `isSidechain` |
| `time.start` / `end` | Primer y último `timestamp` del turno (agrupado por `promptId`) |
| `time.human_review_s` | **Hueco entre el último `assistant` y el siguiente `user` no-meta** |
| `change.commits` | `git log` acotado a la ventana temporal |

> El peaje de revisión ya está en el disco: es el hueco entre el fin de una respuesta y el envío del siguiente prompt. Solo hay que leerlo.

---

## N2 — Hooks

Convierte la captura en un evento y elimina el paso manual. Nombres verificados contra la documentación oficial de hooks.

| Hook | Campos relevantes | Qué aporta |
|---|---|---|
| `SessionStart` | `session_id`, `cwd`, `how` | Abre la sesión |
| `UserPromptSubmit` | `session_id`, `prompt_id` | **Cierra la ventana de revisión** abierta por el `Stop` anterior |
| `PostToolUse` | `tool_name`, `tool_input`, `tool_response`, `agent_id` | `change.files_touched` con matcher `Edit\|Write` |
| `PostToolUseFailure` | `tool_error` | `outcome.tool_errors` |
| `PermissionDenied` | `tool_name`, `reason` | `outcome.rejected_edits` |
| `SubagentStart` / `SubagentStop` | `agent_id`, `agent_type` | Atribución por subagente |
| `TaskCreated` / `TaskCompleted` | `task_id`, `completion_note` | Enlace con `trace_id` |
| `Stop` | `session_id`, `prompt_id`, `effort` | **Abre la ventana de revisión** |
| `SessionEnd` | `why` | Consolida y hace flush |

El par `Stop → UserPromptSubmit` es la medición limpia del peaje: el agente terminó, el humano está leyendo. Con N2, `human_review_s` deja de ser `declared` y pasa a `measured`.

---

## N3 — OpenTelemetry

El nivel que alimenta un tablero en tiempo real.

```bash
export CLAUDE_CODE_ENABLE_TELEMETRY=1
export OTEL_METRICS_EXPORTER=otlp
export OTEL_LOGS_EXPORTER=otlp
export OTEL_EXPORTER_OTLP_PROTOCOL=grpc
export OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4317
```

| Métrica | Atributos clave | Uso |
|---|---|---|
| `claude_code.token.usage` | `type` (`input`/`output`/`cacheRead`/`cacheCreation`), `model`, `query_source`, `effort`, `agent.name`, `skill.name` | Tokens con atribución por agente y skill |
| `claude_code.cost.usage` | `model`, `query_source`, `effort`, `agent.name` | Costo por sesión y subagente |
| **`claude_code.active_time.total`** | **`type`: `user` (teclado) \| `cli` (ejecución)** | **La separación humano/IA, medida en la fuente** |
| `claude_code.lines_of_code.count` | `type`, `model` | `change.*` |
| `claude_code.code_edit_tool.decision` | `decision`, `source`, `language` | Rework y rechazo |
| `claude_code.commit.count`, `claude_code.pull_request.count` | — | Base de DORA |

Eventos útiles: `claude_code.api_request` (con `cost_usd`, `duration_ms`, `input_tokens`, `output_tokens`, `cache_read_tokens`, `cache_creation_tokens`), `claude_code.api_error` (con `attempt`, para detectar reintentos descontrolados), `claude_code.tool_result`.

Atributos estándar: `session.id`, `app.version`, `terminal.type`, `organization.id`, `user.account_uuid`, y `prompt.id` para correlacionar los eventos de un turno.

> `claude_code.active_time.total` con `type = user | cli` es la proporción humano/IA medida en la fuente. Lo que muchos equipos anotan a mano, la herramienta ya lo emite.

**No es exclusivo de Claude.** Gemini CLI también emite OTLP, con `gen_ai.client.token.usage` de la convención semántica GenAI de OpenTelemetry, configurable en `.gemini/settings.json`. Dos agentes de dos empresas distintas pueden alimentar el mismo colector — por eso alinearse con esa convención es el mecanismo central de un tablero unificado, no un detalle de estilo.

---

## El peaje de revisión no se mide igual en todas partes

El hueco `Stop → UserPromptSubmit` es una medición limpia en la CLI: el agente terminó y el humano está delante leyendo. En una sesión cloud o desde el móvil, ese mismo hueco puede significar que el humano guardó el teléfono y volvió al día siguiente. **El hueco dejó de ser revisión y pasó a ser ausencia.**

| `time.review_measurement` | Cuándo | Fiabilidad |
|---|---|---|
| `focus_based` | N2 en local: hay señal de interacción de teclado | alta |
| `gap_based` | sesión cloud o móvil: solo se conoce el hueco | media, con umbral |
| `declared` | N0 | baja, pero honesta |

`config.json` define `review_gap_max_s` (sugerido: 900). Por encima de ese umbral el tiempo se contabiliza como `human_wait_s`, no como `human_review_s`. El valor del umbral se registra en el reporte, porque cambia el resultado y quien lea las cifras tiene derecho a saberlo.

Sin esto, el indicador estrella del sistema —el peaje de revisión— queda inflado por cada noche que una sesión cloud pasa esperando.
