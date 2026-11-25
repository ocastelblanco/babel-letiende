# Índice de usos del nombre «BabelBot»

Creado el 24/11/2026. Oliver duda del nombre: «BabelBot» ya existe (un traductor de chat para Discord) y el público no conoce «Babel»: para él es solo el catálogo de la librería de Le Tiende. Este índice lista todos los puntos donde aparece el nombre, para poder cambiarlo de una vez cuando se defina el nombre nuevo o se decida dejar el actual.

## Decisión (25/11/2026): Melquíades

Oliver eligió **Melquíades**, el gitano sabio de *Cien años de soledad*. Se aplicó con este índice en la rama `feature/melquiades-nombre` (Tarea 18 de `docs/TODO.md`, bitácora 08 §11):

| Antes | Ahora |
|---|---|
| Texto visible «BabelBot» (§1) | «Melquíades» (con tilde) |
| Botón con ícono `chat` y la palabra «BabelBot» | Logo `public/logo-melquiades.svg` (1756×365), `alt="Melquíades"` |
| `chat-babelbot/`, `app-chat-babelbot`, `ChatBabelbotComponent`, `AVISO_BABELBOT` | `chat-melquiades/`, `app-chat-melquiades`, `ChatMelquiadesComponent`, `AVISO_MELQUIADES` |
| `RecomendacionBabelbot`, `RespuestaBabelbot` | `RecomendacionMelquiades`, `RespuestaMelquiades` |
| `data-testid` e id `aviso-babelbot`, `error-babelbot` | `aviso-melquiades`, `error-melquiades` |

Los identificadores van sin tilde. Las tablas §1 a §4 de abajo describen el estado **anterior** y se conservan como registro de lo que se cambió; los registros históricos (§5) siguen sin reescribirse. Este archivo conserva su nombre para no romper las referencias que ya lo citan.

## Índice original (24/11/2026)

Búsqueda: `grep -rniE "babel[ _-]?bot"` sobre todo el repositorio (sin `node_modules`, `.git`, `dist*`, `.angular`). Para repetirla antes de renombrar:

```bash
grep -rniE "babel[ _-]?bot" --exclude-dir=node_modules --exclude-dir=.git --exclude-dir=dist --exclude-dir=dist-server --exclude-dir=.angular .
```

**El prompt del modelo no usa el nombre** (`asistente-ia/prompts/` no tiene ninguna coincidencia): el asistente no se presenta con nombre propio, así que renombrar no obliga a re-correr evals ni a subir la versión del prompt.

## 1. Lo que ve el público (cambia el texto visible)

Es lo único que el visitante lee. Son los puntos que importan para la decisión del nombre.

| Archivo | Línea | Qué muestra |
|---|---|---|
| `src/app/features/catalogo-publico/chat-babelbot/chat-babelbot.component.html` | 9 | Botón flotante «BabelBot» |
| ídem | 14 | `aria-label` del diálogo: «BabelBot, asistente de recomendación de libros» |
| ídem | 19 | Título del panel (`<h2>`) |
| ídem | 33 | `aria-label` «Cerrar BabelBot» |
| ídem | 60 | Saludo: «Hola, soy BabelBot. …» |
| ídem | 133 | «BabelBot está buscando en los estantes…» |
| ídem | 158 | `aria-label` del cuadro de texto: «Tu mensaje para BabelBot» |
| `src/app/features/catalogo-publico/chat-babelbot/chat-babelbot.component.ts` | 22 | Aviso (`AVISO_BABELBOT`): «Hablas con BabelBot, una inteligencia artificial…» |

## 2. Identificadores de código (renombrar solo si se quiere coherencia; el público no los ve)

| Identificador | Dónde |
|---|---|
| Carpeta `chat-babelbot/` y archivos `chat-babelbot.component.{ts,html,spec.ts}` | `src/app/features/catalogo-publico/` |
| Selector `app-chat-babelbot`, clase `ChatBabelbotComponent`, constante `AVISO_BABELBOT` | `chat-babelbot.component.ts` (líneas 21, 44, 48, 53) |
| Uso `<app-chat-babelbot />` | `catalogo-publico.component.html:229` |
| Importación `ChatBabelbotComponent` | `catalogo-publico.component.ts:11` y `:123` |
| Tipos `RecomendacionBabelbot`, `RespuestaBabelbot` | `src/app/core/api/asistente.service.ts` (5, 6, 16, 18, 38, 78) y `chat-babelbot.component.ts` (8, 30) |
| `data-testid` `aviso-babelbot`, `error-babelbot`, id `aviso-babelbot` y `aria-controls` | `chat-babelbot.component.html` (46, 54, 142) y su spec |
| Spec | `chat-babelbot.component.spec.ts` (afirmaciones sobre el texto, los `data-testid` y `AVISO_BABELBOT`) |

Las rutas de la API (`/api/asistente`, `/api/asistente/valoracion`), las tablas (`babel-asistente-*`), las variables de entorno (`ASISTENTE_*`) y la carpeta `asistente-ia/` **no** llevan el nombre y no cambian.

## 3. Comentarios en el backend e infraestructura (solo texto, sin efecto)

| Archivo | Línea |
|---|---|
| `server/api/handlers/asistente.ts` | 648 (comentario de `GET /api/asistente`) |
| `server/api/handlers/asistente-valoracion.ts` | 7 (comentario de cabecera) |
| `serverless.yml` | 2553 (comentario) y 2562 (descripción de la ruta de valoración) |

## 4. Documentación viva (conviene actualizar)

| Archivo | Líneas |
|---|---|
| `asistente-ia/PLAN.md` | 205 (Fase 7b) y 213 (decisión del panel «BabelBot») |
| `asistente-ia/bitacora/08-operacion-segura.md` | 112 y 114 (§9 Fase 7b) |
| `docs/TODO.md` | 7, 618, 620, 625 |
| `docs/tech-specs.md` | 285 |
| Este archivo | — |

Pendiente a futuro, ya decidido el 24/11: la sección «Datos del asistente» del panel de administración se renombrará «BabelBot» (`PLAN.md:213`). **Si el nombre cambia, esa sección debe usar el nombre nuevo** (aún no existe en el código, no hay nada que cambiar hoy).

## 5. Registros históricos (no se reescriben)

Describen lo que se llamó así en su momento. Se dejan tal cual salvo que Oliver pida lo contrario.

- `tracking-detail.csv` filas 287–289 (descripciones de hitos del 24/11).
- `asistente-ia/metrics/events/2026-11-24--f796b08c-eb41-47a6-912d-0fe775151645.jsonl` línea 1: el ledger es append-only; si hiciera falta, se corrige con un evento nuevo (`corrects`), no editando.
- Historial de git: mensajes de commit y títulos de PR #174–#177 (p. ej. «chat de BabelBot en el catalogo publico»), y nombres de rama `feature/babelbot-chat-catalogo` (ya fusionada y borrada).

## 6. Fuera del repositorio

- Memoria de Claude Code: `babelbot-nombre-y-objetivos-de-medicion.md` y `MEMORY.md` (índice), más menciones en `babel-asistente-ia-2026-11-16.md`. Se actualiza al decidir el nombre.
- Nada en AWS lleva el nombre (tablas, funciones y variables son `asistente`); tampoco los secretos de GitHub.
- Publicaciones futuras (The Lab, LinkedIn, artículos): aún no existen; el nombre se define antes de escribirlas.

## Procedimiento sugerido al decidir

1. Elegir nombre; confirmar que no choca con productos existentes.
2. Un solo PR: cambiar el texto visible (§1), renombrar identificadores (§2) con `git mv`, actualizar comentarios y documentación viva (§3, §4) y los tests.
3. `npm test -- --watch=false`, `npm run build` y revisar el chat en `staging`.
4. Actualizar la memoria de Claude Code (§6).
5. Si el nombre es el que aparece en el aviso de Ley 1581, que quien responde por los datos de Le Tiende vuelva a leerlo.
