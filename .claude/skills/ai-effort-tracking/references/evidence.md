# Evidencia: qué está verificado y qué no

Un sistema de métricas que se apoya en estadísticas sin verificar contradice su propia razón de ser. Esta página separa lo comprobado de lo que circula sin fuente.

**Regla:** toda cifra de industria que aparezca en un reporte generado por esta skill lleva fuente. Si no está aquí, no se cita.

---

## Verificado (31 de agosto de 2026)

### Sobre Claude Code

| Afirmación | Fuente |
|---|---|
| Métricas, eventos y atributos OTel (`claude_code.*`), incluido `active_time.total` con `type: user \| cli` | [monitoring-usage](https://code.claude.com/docs/en/monitoring-usage) |
| Eventos de hook y sus campos de entrada/salida | [hooks](https://code.claude.com/docs/en/hooks) |
| Estructura del transcripto JSONL y bloque `usage` con desglose de caché por TTL | Inspección directa de `~/.claude/projects/…/*.jsonl`, Claude Code 2.1.251 |
| Los hooks de `.claude/settings.json` del repo se ejecutan en sesiones cloud («part of the clone»); variables de entorno configurables por entorno; `CLAUDE_CODE_REMOTE_SESSION_ID` identifica la sesión | [cloud-environments](https://code.claude.com/docs/en/cloud-environments) |
| La app móvil es cliente, no entorno de ejecución («a client for Claude Code sessions rather than a place where code runs»); sus modos son sesión cloud, Remote Control y Dispatch | [mobile](https://code.claude.com/docs/en/mobile) |
| Las sesiones cloud corren en una VM que clona el repositorio | [claude-code-on-the-web](https://code.claude.com/docs/en/claude-code-on-the-web) |

### Sobre otros proveedores

| Afirmación | Fuente |
|---|---|
| Gemini CLI emite `gen_ai.client.token.usage` (convención GenAI de OTel), configurable en `.gemini/settings.json`, con salida OTLP o a archivo local | [gemini-cli telemetry](https://google-gemini.github.io/gemini-cli/docs/cli/telemetry.html) |
| OpenAI: `prompt_tokens_details.cached_tokens` es **subconjunto** de `prompt_tokens`; `completion_tokens_details.reasoning_tokens` | [developers.openai.com](https://developers.openai.com/api/docs/guides/reasoning), [help.openai.com](https://help.openai.com/en/articles/4936856-understanding-and-counting-tokens) |
| DeepSeek: `prompt_tokens = prompt_cache_hit_tokens + prompt_cache_miss_tokens`, con tarifas distintas para hit y miss | [docs.litellm.ai](https://docs.litellm.ai/docs/completion/prompt_caching) y documentación de contexto en caché de DeepSeek |
| Codex CLI escribe sesiones en `~/.codex/sessions/rollout-*.jsonl` y emite eventos `token_count` | Rastreador de incidencias de [openai/codex](https://github.com/openai/codex) — **no probado empíricamente** |

### Marcos de industria

| Afirmación | Fuente |
|---|---|
| DX Core 4 = Speed, Effectiveness, Quality, Impact; métrica primaria de Impact = % de tiempo en capacidades nuevas | [getdx.com](https://getdx.com/research/measuring-developer-productivity-with-the-dx-core-4/), [newsletter.getdx.com](https://newsletter.getdx.com/p/introducing-the-dx-core-4) |
| METR (jul-2025): desarrolladores experimentados **19 % más lentos** con IA, creyendo ser 20 % más rápidos; el sobrecosto se atribuye a revisar e integrar la salida generada | [metr.org](https://metr.org/blog/2025-07-10-early-2025-ai-experienced-os-dev-study/), [arXiv:2507.09089](https://arxiv.org/abs/2507.09089) |
| DORA 2025: la adopción de IA correlaciona **a la vez** con mayor throughput y mayor inestabilidad; la IA amplifica las condiciones previas | [dora.dev](https://dora.dev/insights/balancing-ai-tensions/), [Google Cloud](https://cloud.google.com/blog/products/ai-machine-learning/announcing-the-2025-dora-report) |

El hallazgo de METR es la justificación empírica del indicador VT: si revisar e integrar puede costar más de lo que la generación ahorra, ese tiempo tiene que ser un campo de primer nivel y no un residuo.

---

## Precios

| Afirmación | Estado |
|---|---|
| Anthropic, por millón de tokens: Opus 5.5 $4/$20 · Opus 5 $5/$25 · Sonnet 5.5 $2/$10 · Sonnet 5 $2/$10 · Haiku 4.5 $1/$5 | Verificado contra la página oficial el 2026-10-02. Los precios cambian: **reverificar antes de usar** |
| Multiplicadores de caché de Anthropic: lectura 0.1× input (0.05× en Opus 5.5); escritura 1.25× (TTL 5 min) y 2× (TTL 1 h) | Verificado contra la página oficial el 2026-10-02. Reverificar |
| OpenAI, Google, DeepSeek, Qwen, Kimi | **Sin verificar.** `pricing.json` trae la estructura con valores en `null` |

`pricing.json` incluye a los proveedores no verificados con estructura completa y precios en `null` a propósito. Escribir ahí un precio recordado sería el fallo exacto que esta skill existe para evitar.

---

## Sin verificar — no incorporar como constantes

Estas cifras circulan en material sobre productividad con IA. **No se pudieron confirmar contra fuente primaria.** No deben quedar codificadas en umbrales, textos de reporte ni comparaciones:

- "+441.5 % en tiempo mediano de revisión de PR"
- "1.7× más errores en código generado por IA"
- "14× aumento en acciones de deshacer/eliminar"
- "$3.24 USD por minuto de burn rate de un fleet activo"
- "31 % de los PRs se mergean sin revisión"
- "85 % de los proyectos de IA fallan por calidad de datos"
- "cambios multi-archivo en el 78 % de las sesiones"

No se afirma que sean falsas. Se afirma que **no tienen respaldo verificado**, y que el propósito de esta skill es precisamente sustituirlas por tus propios números:

| Cifra sin fuente | Indicador que la reemplaza |
|---|---|
| "$3.24/min de burn rate" | **EBR** — tu burn rate real |
| "1.7× más errores" | **RR** — tu tasa de retrabajo real |
| "+441.5 % en revisión" | **VT** — tu peaje real |
