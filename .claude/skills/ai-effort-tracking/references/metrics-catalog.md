# Catálogo de indicadores

Ocho indicadores. Cada uno declara fórmula, marco de industria y —lo más importante— **la decisión que habilita**. Un indicador que no cambia una decisión no entra al tablero.

## Tabla de contenidos

- [Los ocho indicadores](#los-ocho-indicadores)
- [La fórmula que decide el modelo](#la-fórmula-que-decide-el-modelo)
- [Cuándo no son comparables](#cuándo-no-son-comparables)
- [Un indicador que no se debe construir](#un-indicador-que-no-se-debe-construir)
- [Cómo leer un reporte](#cómo-leer-un-reporte)

---

## Los ocho indicadores

| # | Indicador | Fórmula | Marco | Decisión que habilita |
|---|---|---|---|---|
| 1 | **Orchestration Ratio (OR)** | `Σ human_active_s / Σ (human_active_s + agent_active_s)` | SPACE / DX Impact | Cuánto del trabajo es realmente tuyo, sin la supervisión escondida dentro del tiempo de IA |
| 2 | **Verification Tax (VT)** | `Σ human_review_s / Σ agent_active_s` | "Senior Engineer Tax" | *El peaje.* Segmentado por modelo y `task_type`: dónde revisar cuesta más que hacer |
| 3 | **Cost per Accepted Change (CPAC)** | `Σ cost.usd / count(status = accepted)` | FinOps / DX Core 4 | Costo unitario real de entrega, comparable entre etapas y proyectos |
| 4 | **Rework Rate (RR)** | `count(status ∈ {reworked, rejected}) / count(*)` | DORA / DX Quality | Salud del contexto: RR alto significa que el `CLAUDE.md` no dice lo suficiente |
| 5 | **Cache Efficiency (CE)** | `Σ cache_read / Σ (input_uncached + cache_read)` | FinOps | La palanca de costo más directa que existe: CE baja indica prompts que se invalidan solos |
| 6 | **Model Routing Efficiency (MRE)** | matriz `task_type × modelo` → `(CPAC, VT, RR)` | FinOps | Detecta el modelo caro haciendo trabajo de plantilla, con evidencia propia |
| 7 | **Change Failure Rate (CFR)** | `count(change.reverted) / count(commits)` | DORA | Estabilidad. La velocidad no es ganancia si el CFR sube |
| 8 | **Effective Burn Rate (EBR)** | `Σ cost.usd / Σ wall_s` (USD/hora) | FinOps | Sustituye cualquier cifra de industria por tu número real |

---

## La fórmula que decide el modelo

De todos los cálculos, el que justifica el sistema entero. Cambiar del modelo A al B se paga si:

```
Δcosto_tokens  <  Δ(human_review_s) × human_hourly_rate / 3600
```

**Un modelo más caro es más barato si te ahorra más tiempo de revisión del que cuesta en tokens.** Es la única forma rigurosa de responder "¿me conviene el modelo grande?", y requiere exactamente los dos campos que un tracking de horas no tiene: `cost.usd` y `human_review_s`.

`config.json` guarda `human_hourly_rate` —tarifa facturada o valor de oportunidad—, preguntado al humano en `init`. **Si no está definido, VT se reporta en horas y este cálculo queda deshabilitado.** Nunca se asume una tarifa por defecto: una tarifa inventada convierte un indicador en una opinión disfrazada de dinero.

### Bajo régimen `flat_rate`

Con suscripción, el costo marginal de un token es cero, así que la fórmula de arriba siempre daría "cambia al modelo más caro". No es un error del indicador: es la verdad económica. Lo que cambia es la restricción — deja de ser el dinero y pasa a ser el límite de uso del plan.

El reporte, bajo `flat_rate`, lidera con `allocated_usd` y con el consumo de tokens contra el límite del plan, no con `marginal_usd`.

---

## Cuándo no son comparables

Dos advertencias que el reporte hace cumplir, no solo menciona:

- **Entre proveedores.** CPAC y EBR solo son comparables bajo el mismo régimen de caché. Un proveedor que no cobra la escritura de caché parece más barato por token aunque necesite más tokens para el mismo trabajo. Segmenta por `actor.provider` antes de comparar.
- **Entre niveles de captura.** Mezclar eventos `N0` declarados con `N2` medidos produce indicadores sin significado. Estratifica por `provenance.capture_level` y niégate a calcular VT y CPAC sobre muestra mixta.
- **Entre regímenes de facturación.** Un evento `flat_rate` y uno `metered_api` solo se comparan por `cost.usd` (precio sombra), nunca por `marginal_usd`.

---

## Un indicador que no se debe construir

**Líneas de código por dólar.** El dato está disponible (`change.lines_added`) y es tentador. No entra al tablero: en desarrollo asistido por IA premia exactamente el comportamiento equivocado, que es generar más código. Se registra como dato crudo para análisis, nunca como indicador de rendimiento.

---

## Cómo leer un reporte

El reporte lidera con tres indicadores. Los otros cinco van en anexo — ocho métricas en portada es garantía de que nadie mire ninguna.

| Si ves | Probablemente significa | Qué mirar después |
|---|---|---|
| VT alto en un `task_type` concreto | El contexto para ese tipo de tarea es insuficiente | `CLAUDE.md`, y RR en el mismo segmento |
| CE baja (< 0.5) sostenida | Algo invalida el prefijo de caché en cada turno | Contenido volátil al principio del prompt |
| RR alto con VT bajo | Se está aceptando trabajo sin revisarlo | CFR en las semanas siguientes |
| CPAC subiendo con OR estable | El modelo o la ruta cambió, no tu forma de trabajar | MRE por modelo |
| OR muy por debajo de lo esperado | Probablemente falta registrar trabajo humano fuera del agente | Cobertura de eventos N0 |

Ese último es el error más común al empezar: el trabajo humano fuera del CLI se sub-registra, y el ratio humano/IA sale artificialmente bajo. No es un hallazgo sobre productividad; es un hallazgo sobre cobertura del registro.
