# Plan de implementación — Obtención automatizada de info de libros (metadatos + PVP)

> Documento de diseño aprobado. La catalogación es el flujo **crítico** de Babel (`PRD.md` §5.2):
> >3.000 libros a cargar, debe ser lo más automático y expedito posible. Este documento define
> cómo se obtiene la información de un libro (metadatos bibliográficos **y** PVP) mediante una
> cadena de fuentes con fallbacks, y cómo se administra la lista de sitios de scraping.

---

## 1. Estado actual (punto de partida)

`GET /api/metadatos/:isbn` resuelve **solo metadatos bibliográficos** (título, autor, editorial, portada) consultando el proxy `api.letiende.co/libros?barcode=<isbn>` (pass-through de Google Books API) con **un reintento** ante fallos transitorios. Funciona, pero:

- La fuente es **intermitentemente inestable** (Google Books responde `503` aguas arriba; confirmado en vivo).
- El **PVP se ingresa 100% manualmente** — no hay ninguna búsqueda automática de precio.
- No existe código de scraping (`server/api/services/scraping.ts` no existe; `cheerio` no está instalado).

## 2. Objetivo

Añadir una **cadena de fallbacks** para metadatos y **conectar con el flujo de PVP**:

1. `api.letiende.co` (con reintento — ya existe).
2. **Web scraping** de una lista de librerías **administrable**, buscando por **ISBN**, que aporta
   info **y/o** PVP según los permisos de cada sitio.

Se reemplaza el modelo previo de *lista blanca + lista negra* por **una sola lista** donde cada
sitio tiene dos banderas booleanas: `info` y `pvp`. Un sitio puede ser fuente confiable de datos
bibliográficos pero no de precio. `{info:false, pvp:false}` = completamente prohibido.

## 3. Decisiones tomadas

- **Fuente de metadatos:** se mantiene `api.letiende.co` (su Lambda ya soporta `?barcode=`,
  `?titulo=` y `?autor=`). **No** se añade una API key propia de Google Books: la inestabilidad
  es aguas arriba (de Google Books), así que una key directa no la resolvería y sí añadiría un
  secreto nuevo que gestionar. Reafirma **ADR-001**. Para la inestabilidad está la cadena de scraping.
- **Lista de sitios:** vive en **DynamoDB** (`babel-sitios-scraping`), editable por el administrador
  desde `/admin` (igual que estantes/editoriales), con una **guardia SSRF fija** que valida toda URL
  saliente sin importar lo que el admin agregue. → **ADR-010** y **ADR-011**.
- **Alcance de esta iniciativa:** hasta **scraping por ISBN** (info + PVP). La búsqueda por
  **título/autor** + una **UI de selección de candidato** (elegir el libro exacto por portada y
  datos) queda **diferida** como iniciativa futura separada.

> **Nota de seguridad (acción del usuario, fuera del código):** el archivo
> `prompt-sobre-obtención-de-info-de-libros.md` contiene una **API key real de Google Books** en
> texto plano (es la key de la Lambda `letiende-api`). No debe commitearse; conviene borrarlo o
> añadirlo a `.gitignore`, y evaluar rotar esa key si el archivo llegó a subirse a algún remoto.

## 4. Decisiones de arquitectura nuevas (ADRs)

### ADR-010 — Lista única de sitios de scraping en DynamoDB, administrable, con banderas `info`/`pvp`
Reemplaza el modelo lista-blanca + lista-negra (config estática del repo) por una tabla
`babel-sitios-scraping` editable desde `/admin`. Cada fila:
`{ dominio (PK), nombre, url, info: boolean, pvp: boolean, prioridad: number }`. **Supersede** la
decisión de `tech-specs.md` §6 ("lista mantenida como configuración estática en el repo, no editable
desde la UI de administración") y la consecuencia de ADR-004. Razón: el administrador necesita
añadir/quitar fuentes sin un deploy, y algunos sitios sirven para info pero no para PVP.

### ADR-011 — Guardia SSRF fija e independiente de la lista administrable
Como la lista pasa a ser editable por **datos** (no código), la garantía anti-SSRF **no** puede
depender de ella. Toda URL saliente de scraping pasa SIEMPRE, en tiempo de `fetch`, por
`validarHostSeguro()`: exige `https:`, resuelve el hostname y **rechaza** IPs privadas / loopback /
link-local y `169.254.169.254` (metadata service de AWS), y no sigue redirecciones a hosts no
validados. La tabla expresa *intención* (qué sitios y para qué); la guardia estática impone
*seguridad*. Mantiene intacta la regla `CLAUDE.md` A10 aunque el allowlist sea data-driven.

### Separación datos vs. mecánica (clave del diseño)
La fila de DynamoDB guarda **política** editable por el admin (`dominio`, `info`, `pvp`,
`prioridad`). El **adaptador de extracción** por sitio (plantilla de URL de búsqueda por ISBN +
selectores CSS) vive en **código** (`scraping.ts`), indexado por `dominio`. Un sitio en la lista sin
adaptador de código simplemente no se puede scrapear (se registra y se omite). Así el admin controla
*si/para qué* se usa un sitio; el desarrollador aporta el *cómo* (selectores) — y **nada** se
fetchea sin lista + adaptador + guardia SSRF.

## 5. Modelo de datos

`src/app/core/models/sitio-scraping.model.ts` (+ copia local en el handler):

```ts
export interface SitioScraping {
  dominio: string;      // PK natural, hostname normalizado (ej. "www.librerialerner.com.co")
  nombre: string;       // etiqueta legible (ej. "Librería Lerner")
  url: string;          // URL base (ej. "https://www.librerialerner.com.co")
  info: boolean;        // autorizado para extraer título/autor/editorial/portada
  pvp: boolean;         // autorizado para extraer precio de venta al público
  prioridad: number;    // orden en la cola de fallback (menor = primero)
}
```

Sitios semilla (aportados por el usuario):

| Nombre | URL | info | pvp |
|---|---|---|---|
| Librería Lerner | https://www.librerialerner.com.co | ✅ | ✅ |
| Tornamesa | https://www.tornamesa.co/ | ✅ | ✅ |
| Librería Nacional | https://www.librerianacional.com/ | ✅ | ✅ |
| Busca Libre | https://www.buscalibre.com.co/ | ✅ | ❌ |

## 6. Backlog ordenado

> **Step 0 (este PR):** documentación y decisiones — solo `.md`. Deja `TODO.md` con las 2 tareas
> atómicas activas (Task A y Task B). Task C sigue después vía el motor JIT.

### Step 0 — Documentación (este PR)
- `MEMORY.md` §3: añadir **ADR-010** y **ADR-011**.
- `PRD.md`: §5.2 (cadena de fallback metadatos + PVP por ISBN; título/autor marcado como futuro),
  §5.6 (añadir "Gestión de sitios de scraping/PVP (CRUD)"), §6 roadmap (fila nueva), §9 y §10
  (reemplazar "lista blanca/lista negra" por "lista única con permisos info/pvp").
- `tech-specs.md`: §2 (scraping ya no es config estática; cheerio), §5 (tabla `babel-sitios-scraping`,
  orquestación de `/api/metadatos/:isbn`), §6 (supersede de la línea de config estática), §9 (sin key
  de Google Books; Custom Search fuera de alcance ahora), §11.
- `TODO.md`: reescribir a Task A + Task B.
- **Reconciliar desfases** de `MEMORY.md`: §2 (metadatos ya implementado → `[x]`), §4 (`@zxing/browser`
  ya instalado; `cheerio` sigue pendiente hasta Task B), §5 (estado real de `API_LETIENDE_BASE_URL`),
  y borrar la frase obsoleta "Ningún flujo de negocio está implementado todavía".

### Task A — CRUD admin de sitios de scraping (`/admin/sitios`)
Plantilla backend: `editoriales-descuentos` (clave natural, `409` en duplicado). Plantilla frontend:
`estantes`.
- **Backend:** `server/api/handlers/sitios-scraping.ts` (+ `.spec.ts`) — un Lambda, 4 verbos,
  `exigirAdministrador`, validación (`dominio` hostname válido; `info`/`pvp` booleanos; `url` https;
  `prioridad` número), `409` POST duplicado, `404` PUT/DELETE inexistente. Reusa `dynamodb.ts`.
- **serverless.yml:** `custom.nombresTablas.sitiosScraping`, env `TABLA_SITIOS_SCRAPING`,
  `functions.sitiosScraping` (rutas `GET/POST /api/sitios-scraping`,
  `PUT/DELETE /api/sitios-scraping/{dominio}`, con el bloque de exclusiones `node_modules/**`
  literal), `SitiosScrapingLambdaRole` (GetItem/PutItem/DeleteItem/Scan sobre la tabla nueva +
  GetItem sobre `babel-usuarios`), `TablaSitiosScraping` (PK `dominio`, PROVISIONED 25/25).
- **Frontend:** `src/app/core/api/sitios-scraping.service.ts` (+ `.spec.ts`),
  `src/app/features/admin/gestion-sitios-scraping.component.{ts,html,spec.ts}` (lista + formulario
  único crear/editar con checkboxes `info`/`pvp` + eliminar con `confirm`), ruta `admin/sitios` en
  `app.routes.ts` + `app.routes.server.ts` (`RenderMode.Client`), card en `admin-inicio.component.html`.
- **Semilla:** cargar los 4 sitios (vía la UI ya desplegada o una operación en `operaciones-staging.yml`).

### Task B — Motor de scraping + guardia SSRF (`server/api/services/scraping.ts`)
- Instalar `cheerio` (dependency de producción); **no** excluirlo del empaquetado (es runtime de
  backend); verificar tamaño del paquete < 250 MB tras añadirlo.
- `validarHostSeguro(url)`: https obligatorio; resolver hostname; rechazar IP literal o resuelta en
  rangos privados/loopback/link-local + `169.254.169.254`; `fetch` con `redirect: 'manual'`
  revalidando cada salto. Nunca lanza hacia afuera → los fallos degradan a "no encontrado".
- Adaptadores por `dominio` (Lerner, Tornamesa, Librería Nacional, Busca Libre): plantilla de URL de
  búsqueda por ISBN + selectores CSS que extraen **solo texto/números** (cheerio, nodos específicos —
  nunca HTML crudo, A03). Parseo de precio colombiano `$45.000` → entero COP.
- Devuelve por sitio `{ titulo?, autor?, editorial?, portadaUrl?, pvp? }` respetando las banderas de
  la fila. PVP validado: número positivo ≤ `PVP_MAXIMO` (5.000.000, A08).
- Tests con **fixtures HTML guardados** (no sitios en vivo) + tests de la guardia SSRF + parseo de precio.

### Task C (siguiente, tras A+B) — Integrar la cadena en `/api/metadatos/:isbn` + PVP
- `server/api/handlers/metadatos.ts`: orquestar api.letiende (reintento) → si faltan campos de info o
  falta PVP, iterar `babel-sitios-scraping` por `prioridad` (sitios con `info=true` para info
  faltante, `pvp=true` para PVP, con adaptador y que pasen la guardia), llenar huecos. Responder
  `{ titulo, autor, editorial, portadaUrl, pvp }` (todos nullables). Siempre `200`.
- serverless.yml `functions.metadatos`: env `TABLA_SITIOS_SCRAPING`, IAM `GetItem`/`Scan` sobre esa
  tabla, `cheerio` presente en el paquete.
- Frontend `metadatos.service.ts` (añadir `pvp` a `MetadatosLibro`) y
  `catalogar-libro.component.{ts,html}` (pre-cargar `pvp` como sugerencia editable; nunca pisa lo que
  el vendedor escribió; A08).

### Diferido (registrar en roadmap, no construir ahora)
Búsqueda por **título/autor** (vía `api.letiende.co?titulo=/?autor=` y adaptadores de scraping) +
**UI de selección de candidato** (elegir el libro exacto por portada + datos). Es la pieza más
grande y especulativa; se aborda como iniciativa separada.

## 7. Verificación (por tarea)

- **Unit:** `npm run test:api` (handlers + scraping con fixtures + guardia SSRF + parseo de precio) y
  `npm test -- --watch=false` (servicios/componentes Angular).
- **Empaquetado:** `npx serverless package --stage staging` y confirmar cada función < 250 MB
  (crítico al añadir `cheerio`; no excluirlo).
- **Staging (por PR):** CRUD de sitios con la cuenta `administrador` real; un `vendedor` no accede a
  `/admin/sitios`; para Task C, catalogar un ISBN real y confirmar que info y PVP se pre-cargan y
  siguen editables, y que un ISBN inexistente deja el formulario editable sin errores.
- **Seguridad:** tests que prueban que `validarHostSeguro` rechaza `http://169.254.169.254`, IPs
  privadas/link-local y esquemas no-https; confirmar que ningún adaptador devuelve HTML crudo.
