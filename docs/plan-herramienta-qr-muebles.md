# Plan de implementación: Generador de QR para muebles — `tools/qr-muebles/`

> Plan producido en sesión de planeación (2026-07-27), pendiente de ejecución. Pista independiente del motor JIT — ver `TODO.md` ("Pista independiente (fuera de Babel) — Generador de QR para muebles") y `ajustes-2026-07-27.md` ("Decisiones técnicas confirmadas") para el pedido original y las decisiones de producto ya cerradas con el usuario. Este documento es el plan técnico completo, listo para ejecutar en una sesión nueva sin tener que rederivar nada de lo ya decidido.

## Contexto

El usuario va a imprimir estampillas circulares autoadhesivas (~8cm) con un código QR por cada mueble de la librería, para pegarlas físicamente y que un visitante que escanee vea el catálogo público ya filtrado a ese mueble (`?espacio=&mueble=`, contrato ya existente desde `ajustes-finales.md` Tarea F). Es la última pieza de `ajustes-2026-07-27.md`, deliberadamente independiente de Babel — no vive en la app Angular/Lambda, no consume su API, y no ocupa los 2 slots del motor JIT (`TODO.md`).

Decisiones ya confirmadas con el usuario (no se vuelven a preguntar): vive en `tools/qr-muebles/` dentro de este repo, con su propio `package.json`, excluido del build/deploy de Angular/Lambda; lee `babel-espacios`/`babel-muebles` de DynamoDB directamente (perfil `default` de `~/.aws/config`, región `us-east-1`, nunca `acg`/`ct`); genera un solo PDF combinado, tamaño carta; diámetro configurable (default 8cm/80mm).

Investigación confirmada en el propio repo: `tools/` no existe todavía; el `.gitignore` raíz solo tiene patrones anclados a la raíz (`/dist/`, `/node_modules/`, etc.) — nada cubre un `tools/qr-muebles/node_modules` nuevo, hay que agregarlo. `server/api/services/dynamodb.ts` usa `@aws-sdk/client-dynamodb`/`@aws-sdk/lib-dynamodb` con `new DynamoDBClient({})` (sin región/credenciales explícitas — cadena de credenciales por defecto, exactamente lo que necesita esta herramienta corriendo fuera de Lambda). `serverless.yml` confirma el patrón de nombres de tabla `babel-espacios-${stage}`/`babel-muebles-${stage}`; **producción todavía no existe** (última tarea pendiente del roadmap), así que `staging` es el único stage con datos reales hoy — la herramienta debe poder apuntar a cualquiera, con `staging` por defecto. `Espacio { espacioId, nombre }` y `Mueble { muebleId, espacioId, nombre }` confirmados contra los modelos reales.

## Enfoque

### Stack elegido
- **`qrcode`** — genera cada QR como PNG en memoria (`errorCorrectionLevel: 'H'`, la más alta — las estampillas son físicas, se van a ensuciar/desgastar con el tiempo).
- **Plantilla SVG a mano** por estampilla (no una librería de PDF con dibujo vectorial directo): SVG soporta texto curvo nativo vía `<path>` + `<textPath>`, mucho más simple y mejor espaciado que calcular la rotación de cada letra a mano.
- **`@resvg/resvg-js`** — rasteriza cada SVG a PNG a resolución de impresión (~300dpi), sin depender de un navegador headless.
- **`pdf-lib`** — solo para componer el PDF final: coloca los PNG ya rasterizados en una cuadrícula sobre páginas tamaño carta. No dibuja texto ni vectores él mismo.

Las 3 librerías existen y están confirmadas en npm (`qrcode@1.5.4`, `@resvg/resvg-js@2.6.2`, `pdf-lib@1.17.1`) — reconfirmar versiones vigentes al implementar, pueden haber avanzado.

### Riesgo técnico a validar primero
El `<textPath>` (texto curvo) es lo único realmente incierto: antes de construir todo lo demás, hacer una prueba rápida y desechable — un SVG de una sola estampilla con el arco de texto, rasterizarlo con `resvg-js`, y mirar el PNG. Dos cosas a confirmar ahí mismo: que el texto curvo realmente se renderiza (no todos los renderizadores soportan `textPath`), y que el arco inferior no queda invertido/al revés (el sentido del `path` del arco de abajo determina si el texto queda legible o espejado — esto solo se confirma mirando el resultado, no se puede saber solo leyendo el spec).

### Estructura del paquete

`tools/qr-muebles/` — paquete npm propio, TypeScript con `tsx` (ejecución directa, sin paso de build — es una herramienta manual de uso ocasional, no un artefacto desplegado; migrable a `tsc` si se prefiere después pero no se justifica el paso extra ahora), `tsconfig.json` propio (no extiende el de Angular ni el de `server/`).

**`src/tipos.ts`** — copia propia de `Espacio`/`Mueble` (sin importar de `src/app/core/models/`, cruzar ese límite de paquete no aporta nada).

**`src/dynamo.ts`** — `obtenerEspacios(stage)`/`obtenerMuebles(stage)`, un `ScanCommand` genérico sobre `babel-espacios-${stage}`/`babel-muebles-${stage}`, mismo patrón que `escanearTodo` de `server/api/services/dynamodb.ts` pero escrito de cero (sin importar `server/`).

**`src/qr.ts`** — `generarPngQr(url, tamanoPx): Promise<Buffer>` vía `QRCode.toBuffer`.

**`src/estampilla.ts`** — `generarSvgEstampilla(espacio, mueble, diametroMm, qrPngBase64): string`. Geometría proporcional al diámetro `D` (nada hardcodeado a 80mm): círculo exterior como guía de corte; dos `<path>` de arco (invisibles, solo de apoyo para `textPath`) para "¿QUÉ TESOROS SE ESCONDEN AQUÍ?" arriba y "¡ESCANEA Y DESCÚBRELOS!" abajo (frases fijas, arco de barrido ajustado una sola vez a ojo contra la imagen de referencia); nombre del Espacio centrado arriba del QR; QR centrado (~50% del diámetro); nombre del Mueble centrado debajo; 3 marcas tipo diana decorativas cerca de las esquinas del QR (arriba-izq, arriba-der, abajo-izq), igual que la referencia. Fuente: usar fuentes del sistema vía `resvg` (`loadSystemFonts: true`) para la v1 — Poppins solo se carga por CDN en este repo (`src/index.html`), no hay un `.ttf` local a mano; si el resultado no luce lo bastante parecido a la marca, empaquetar `Poppins-Bold.ttf` después es un cambio pequeño y aislado a este archivo.

**`src/rasterizar.ts`** — `rasterizarSvgAPng(svg, diametroMm, dpi=300): Buffer` vía `Resvg`.

**`src/generador.ts`** — orquesta: arma la URL `https://babel.letiende.co/?espacio={espacioId}&mueble={muebleId}`, genera el QR, arma el SVG, rasteriza. `generarEstampillaPng(espacio, mueble, diametroMm): Promise<Buffer>`.

**`src/pdf.ts`** — `calcularCuadricula(diametroMm, opciones?): Cuadricula` (función pura, sin I/O — fácil de romper con matemática de off-by-one, vale la pena un test unitario aislado). Carta = 612×792pt; con margen 10mm y separación 2mm entre círculos (para que el cortador de círculos tenga margen de maniobra), `columnas`/`filas` se calculan a partir del diámetro, no se hardcodea "6 por página" — verificado a mano que con 80mm/10mm de margen da 2×3=6, consistente con lo esperado, pero la fórmula generaliza a cualquier diámetro. `componerPdf(pngs, diametroMm): Promise<Buffer>` reparte los PNG ya rasterizados en la cuadrícula, paginando cuando hay más estampillas de las que caben en una página.

**`src/cli.ts`** — entrada por línea de comandos (`node:util` `parseArgs`, sin dependencia nueva tipo `commander`). Flags: `--stage` (default `staging`), `--diametro` en mm (default `80`), `--salida` (default `tools/qr-muebles/salida/estampillas-qr.pdf`). Flujo: trae espacios+muebles en paralelo, imprime conteos; por cada mueble cuyo `espacioId` no resuelva a un Espacio conocido, **no rompe la corrida** — avisa por consola y lo salta (mismo criterio de todo el repo, CLAUDE.md A08); genera cada estampilla, compone el PDF, imprime la ruta final. Si fallan las credenciales de AWS, mensaje claro en español en vez del stack trace crudo del SDK.

### `.gitignore`
Agregar (el archivo raíz solo tiene patrones anclados, nada cubre esto hoy):
```
/tools/qr-muebles/node_modules/
/tools/qr-muebles/salida/
```
`tools/qr-muebles/package-lock.json` sí se commitea (mismo criterio de todo el repo, CLAUDE.md A08).

## Archivos nuevos

`tools/qr-muebles/package.json`, `package-lock.json`, `tsconfig.json`, `README.md` (uso, flags, prerequisito de credenciales AWS), `src/{tipos,dynamo,qr,estampilla,rasterizar,generador,pdf,cli}.ts`, `src/pdf.test.ts` (unitario de `calcularCuadricula` con `vitest`, corre solo dentro de este paquete — no se conecta a `npm test`/`npm run test:api` de la raíz). Modificado: `.gitignore` (raíz del repo).

## Verificación

No hay suite de pruebas automatizada requerida por el producto (herramienta manual, no parte de la app) — solo `pdf.test.ts` para la matemática de la cuadrícula, por ser la única pieza pura y fácil de romper en silencio. Todo lo demás (dirección del arco, fuente, que el QR escanee bien) es inherentemente visual/físico:

1. `npm install` + `npm run generar` (defaults) desde `tools/qr-muebles/`.
2. Confirmar conteos de espacios/muebles en consola, sin crashear si hay algún mueble huérfano.
3. Abrir el PDF: página carta, 2×3 estampillas a 80mm por defecto, sin traslapes, grilla centrada.
4. Comparar unas cuantas estampillas contra `/Users/ocastelblanco/Documents/LeTiende/letiende.co/fuentes/QR-ejemplo.png`: arco superior e inferior legibles (no espejados/al revés — el riesgo señalado arriba), nombres de Espacio/Mueble correctos, marcas decorativas en las 3 esquinas esperadas.
5. Escanear un par de QR con el celular y confirmar que abren la URL correcta con los IDs correctos.
6. Repetir con `--diametro 60` y con suficientes muebles para forzar 2+ páginas, confirmar que la cuadrícula recalcula (no queda fija en 6) y que la paginación no duplica/pierde estampillas.
7. Probar con credenciales AWS rotas a propósito, confirmar el mensaje de error en español en vez del stack trace del SDK.
