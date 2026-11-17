---
name: ai-effort-tracking
description: >
  Mide esfuerzo y costo real del desarrollo asistido por IA: tiempo humano vs. tiempo
  de agente, peaje de revisión, tokens y USD por tarea, en cualquier superficie
  (CLI, web, escritorio, móvil, API) y con cualquier proveedor (Anthropic, OpenAI,
  Google, DeepSeek, Qwen, Kimi). Úsala cuando pidan "registra el tracking", "anota
  esta tarea", "cuánto costó esta sesión", "reporte de esfuerzo", "métricas del
  proyecto", "configura el tracking", "track effort", "how much did this cost",
  "effort report", o al cerrar cualquier unidad de trabajo en un proyecto que tenga
  metrics/events/. Modos: init, capture, report, migrate.
allowed-tools: Read, Glob, Grep, Write, Edit, AskUserQuestion, Bash(node:*), Bash(git log:*), Bash(git diff:*), Bash(git rev-parse:*)
---

# AI Effort Tracking

Registra qué costó cada tarea —en tiempo humano, tiempo de agente, tokens y dólares— y lo vincula a la especificación que la originó.

**Regla que define la skill:** los datos medibles se extraen de artefactos, nunca se declaran de memoria. Si no hay adaptador disponible, el campo va en `null`. Nunca estimado.

> Fundamento completo, con el análisis y las fuentes verificadas: [`references/`](references/). Empieza por [`schema.md`](references/schema.md).

---

## Los cuatro modos

| Modo | Cuándo | Qué hace |
|---|---|---|
| `init` | una vez por proyecto | Crea `metrics/`, pregunta lo indeducible, instala hooks |
| `capture` | al cerrar cada unidad de trabajo | Extrae, valida y registra el evento |
| `report` | a demanda o al cierre de hito | Calcula los 8 indicadores |
| `migrate` | una vez | Convierte un CSV de tracking heredado |

Si el usuario no especifica modo: hay `metrics/` → `capture`; no hay → `init`.

---

## Modo `init`

1. **Detecta la superficie y el nivel de captura.** Ver [`references/capture-levels.md`](references/capture-levels.md). Propón el nivel más alto que funcione.

2. **Pregunta con `AskUserQuestion`** (no en prosa) lo que no puedes deducir:
   - Zona horaria de visualización.
   - **Régimen de facturación** — es la pregunta que más afecta a los números. Ver [Régimen de facturación](#régimen-de-facturación).
   - `human_hourly_rate`: tarifa facturada o valor de oportunidad. Sin este dato, VT se reporta en horas y el punto de equilibrio entre modelos queda deshabilitado. **Nunca asumas un valor.**
   - Etapas propias del proyecto, si las hay además de las del enum.

3. **Crea `metrics/`** copiando [`templates/config.json`](templates/config.json) y [`references/pricing.json`](references/pricing.json).

4. **Instala los hooks** copiando [`templates/settings.hooks.json`](templates/settings.hooks.json) en `.claude/settings.json` **del repositorio**.

   > Nunca en `~/.claude/settings.json`. El ámbito de usuario no viaja a sesiones cloud, así que un hook instalado ahí funciona en la CLI y falla en silencio en web y móvil — el registro queda incompleto sin avisar.

5. **Agrega a `CLAUDE.md`** la sección `## Registro de esfuerzo` (plantilla al final de este archivo), para que el contrato sobreviva a sesiones futuras sin reinvocar la skill.

6. **Verifica la frescura de `pricing.json`.** Si `as_of` supera 90 días, avisa y pide reverificar contra la fuente oficial antes de calcular ningún costo.

7. **Registra tu propia ejecución** como primer evento, con `stage: "workspace_setup"`.

---

## Modo `capture`

```bash
node scripts/adapters/claude-code-transcript.mjs --session <id> --since <ISO>
node scripts/core/ledger.mjs append --file <evento.json>
```

1. **Ejecuta el adaptador** de la superficie activa para los campos medidos. Sin excepción: no hay ruta que permita escribirlos a mano.
2. **Agrega los turnos** en un evento `work_unit`. `wall_s` del agregado es el **lapso** del primer al último turno, no la suma — sumar turnos cuenta dos veces los huecos, que es donde vive el peaje de revisión.
3. **Pregunta solo lo indecidible:** `milestone` (≤15 palabras), `task_type`, `cognitive_load`. El `trace_id` infiérelo del `TODO.md` activo.
4. **Valida y escribe** en `metrics/events/<fecha>--<sesión>.jsonl`. Cada sesión escribe solo su propio archivo.
5. **Confirma en una línea** el costo y el peaje del evento. La retroalimentación inmediata es lo que sostiene el hábito de registro.

---

## Modo `report`

```bash
node scripts/core/report.mjs --from 2026-08-01 --to 2026-08-31 --out metrics/reports/2026-08.md
```

Los 8 indicadores están en [`references/metrics-catalog.md`](references/metrics-catalog.md). Tres reglas que el reporte hace cumplir:

- **Estratifica por `capture_level`.** VT y CPAC sobre muestra mixta (N0 declarado + N2 medido) no significan nada. Repórtalos por nivel o no los reportes.
- **Segmenta por `provider` antes de comparar costos.** Los regímenes de caché difieren; un proveedor sin costo de escritura parece más barato por token aunque gaste más tokens.
- **Incluye "qué no se puede afirmar".** Muestra insuficiente, `confidence` mayoritariamente `declared`, o proporción alta de `review_measurement: gap_based`.

---

## Modo `migrate`

```bash
node scripts/core/ledger.mjs migrate --csv tracking.csv --out metrics/events/
```

Cada fila heredada → un evento con `confidence: "legacy"`, `capture_level: "N0"`, `unit.type: "work_unit"`.

**No retro-estimes tokens ni costo.** Van en `null`. Un costo inventado para un mes pasado contamina toda serie temporal posterior, y es exactamente el fallo que esta skill existe para evitar.

Reporta al humano las filas inconsistentes (duración que no cuadra, intervalos solapados) para que decida. No las corrijas en automático.

---

## Régimen de facturación

**Determina el significado de cada cifra en dólares, y hay que preguntarlo en `init`.** Dos regímenes:

| Régimen | Ejemplos | Costo marginal de un token | Qué significa `cost.usd` |
|---|---|---|---|
| `flat_rate` | Claude Code con plan Max, Codex con plan ChatGPT, Gemini Code Assist | **cero** | Precio sombra: lo que ese trabajo habría costado a tarifa de lista |
| `metered_api` | Cline, OpenCode, Antigravity o Hermes con API key propia; cliente propio | tokens × tarifa | Gasto real facturable |

Bajo `flat_rate` se registran **tres** cifras y cada una responde una pregunta distinta:

- `cost.usd` — precio sombra a tarifa de lista. Es lo que permite comparar contra un régimen medido.
- `cost.marginal_usd` — `0`. Es la verdad económica: consumir un token más no cuesta nada.
- `cost.allocated_usd` — la parte proporcional de la cuota mensual que le toca a este evento, repartida por participación de tokens en el mes. Es lo que hace comparable una suscripción con una API.

> **Indaga la tarifa, no la inventes.** Pregunta al usuario su plan y su cuota mensual; para API, pídele la tarifa vigente o la fuente donde consultarla. Si no la puedes verificar, registra los tokens (que son un hecho medido) y deja `cost.usd` en `null` con `pricing.status: "unverified"`. Los tokens sin costo son un dato incompleto; un costo inventado es un dato falso.

Las tarifas de proveedores distintos de Anthropic vienen en `pricing.json` con estructura completa y **valores en `null`**: son supuestos pendientes de validación empírica. Complétalos con el usuario y marca `as_of` y `source_url` cuando lo hagas.

---

## Reglas no negociables

| # | Regla |
|---|---|
| 1 | Un campo medido sin `provenance.adapter` es un evento inválido |
| 2 | Los precios salen de `pricing.json`, jamás de tu conocimiento previo |
| 3 | Falta de dato ⇒ `null` y baja `capture_level`. Jamás estimación |
| 4 | Append-only. Para corregir, emite un evento nuevo con `corrects: <event_id>` |
| 5 | Timestamps en UTC ISO-8601; `tz_display` aparte |
| 6 | `cost.basis` y `cost.regime` siempre explícitos |
| 7 | **`input_uncached` y `cache_read` son disjuntos; `thinking` va dentro de `output`.** Los proveedores cuentan la caché de formas incompatibles — ver [`references/adapter-contract.md`](references/adapter-contract.md). Equivocarlo no lanza error: produce cifras presentables y falsas |
| 8 | Niveles de captura distintos no se promedian |
| 9 | Nunca escribas contenido de prompts ni de respuestas en el registro |

---

## Plantilla para `CLAUDE.md`

Insértala en el `CLAUDE.md` del proyecto durante `init`:

```markdown
## Registro de esfuerzo

Este proyecto lleva un registro de esfuerzo y costo en `metrics/events/`,
un archivo JSONL por sesión, versionado en git.

**Al cerrar cualquier unidad de trabajo**, invoca `/ai-effort-tracking capture`.

Reglas no negociables:
- Nunca escribas tokens, costo, duraciones ni nivel de esfuerzo de memoria.
  Ejecuta siempre el adaptador de la superficie activa.
- Si un dato no se puede medir, escribe `null` y baja `capture_level`. No lo estimes.
- Los precios salen de `metrics/pricing.json`, jamás de tu conocimiento previo.
  Si el proveedor está `unverified`, deja `cost.usd` en `null`.
- `input_uncached` y `cache_read` son disjuntos; `thinking` va dentro de `output`.
- El registro es append-only y cada sesión escribe solo su archivo.
  Para corregir, emite un evento nuevo con `corrects`.
- Referencia siempre el `trace_id` de la tarea de `TODO.md` (formato `T-NNNN`).
```

---

## Referencias

| Archivo | Cuándo leerlo |
|---|---|
| [`references/schema.md`](references/schema.md) | Al escribir o validar cualquier evento |
| [`references/adapter-contract.md`](references/adapter-contract.md) | Al escribir un adaptador o depurar un costo raro |
| [`references/capture-levels.md`](references/capture-levels.md) | En `init`, para elegir nivel; al trabajar fuera de la CLI |
| [`references/metrics-catalog.md`](references/metrics-catalog.md) | En `report` |
| [`references/evidence.md`](references/evidence.md) | Antes de citar cualquier cifra de industria |
