# qr-muebles

Herramienta standalone (fuera del build/deploy de Angular/Lambda de Babel) que genera un único PDF tamaño carta con estampillas circulares de código QR — una por cada mueble catalogado — para imprimir y pegar físicamente en los muebles de la librería.

Cada QR apunta al catálogo público de Babel filtrado por espacio y mueble:

```
https://babel.letiende.co/?espacio={espacioId}&mueble={muebleId}
```

> ⚠️ **Antes de imprimir el lote completo:** escanea al menos una estampilla impresa con un celular real. Cada corrida de `npm run generar` ya verifica automáticamente que cada QR decodifique correctamente (ver [Verificación automática de escaneo](#verificación-automática-de-escaneo)), pero eso no reemplaza la prueba física — ver esa sección para el detalle.

## Prerequisito: credenciales AWS

Esta herramienta lee directo de DynamoDB (tablas `babel-espacios-{stage}` y `babel-muebles-{stage}`) usando el perfil `default` de `~/.aws/config`, región `us-east-1`. **Nunca** usa los perfiles `acg`/`ct` del repo (esos son roles asumidos de otras cuentas).

Si no tienes el perfil `default` configurado:

```bash
aws configure
# AWS Access Key ID: ...
# AWS Secret Access Key: ...
# Default region name: us-east-1
# Default output format: json
```

Verifica que funciona con:

```bash
aws sts get-caller-identity
```

## Instalación

```bash
cd tools/qr-muebles
npm install
```

## Uso

```bash
npm run generar -- [--stage staging] [--diametro 80] [--salida salida/estampillas-qr.pdf] [--plantilla plantillas/estampilla.svg] [--sin-logo]
```

| Flag | Default | Descripción |
|---|---|---|
| `--stage` | `staging` | Stage de las tablas DynamoDB (`babel-espacios-{stage}`, `babel-muebles-{stage}`). Usa `--stage production` para generar las estampillas reales con los espacios/muebles ya catalogados en producción. |
| `--diametro` | `80` | Diámetro de cada estampilla circular, en milímetros. |
| `--salida` | `salida/estampillas-qr.pdf` (relativo al cwd — al correrlo con `npm run generar` desde `tools/qr-muebles/`, termina en `tools/qr-muebles/salida/estampillas-qr.pdf`) | Ruta del PDF generado. Se crea el directorio si no existe. |
| `--plantilla` | `plantillas/estampilla.svg` (relativo al cwd, igual que `--salida`) | Ruta a la plantilla SVG editable (ver sección siguiente). |
| `--sin-logo` | `false` (es decir, CON logo por defecto) | Si se pasa, el QR se genera sin el logo mono de Le Tiende encima. |

Ejemplo con diámetro distinto y sin logo:

```bash
npm run generar -- --diametro 60 --sin-logo --salida salida/prueba-60mm.pdf
```

El comando:
1. Trae todos los espacios y muebles del stage indicado (en paralelo).
2. Imprime por consola cuántos espacios/muebles encontró.
3. Si algún mueble referencia un `espacioId` que no existe, lo avisa por consola y lo omite (no rompe la corrida).
4. Genera cada estampilla (QR con logo opcional, rellenando la plantilla) y **verifica automáticamente que el QR generado decodifique** al contenido esperado (ver sección de escaneabilidad) — si alguna falla, avisa fuerte por consola con qué mueble revisar, pero no detiene la corrida (las demás estampillas pueden ser válidas).
5. Reparte todas las estampillas en una cuadrícula sobre páginas tamaño carta, paginando cuando no caben todas en una sola hoja.
6. Escribe el PDF e imprime la ruta final, y un resumen de la verificación de escaneo.

Si fallan las credenciales de AWS, o la plantilla está rota (le falta algún campo `campo:*`), se muestra un mensaje claro en español en vez del stack trace crudo.

## Plantilla editable (`plantillas/estampilla.svg`)

El diseño de la estampilla ya NO se calcula en código — vive en un archivo SVG editable con cualquier herramienta vectorial (recomendado: [Inkscape](https://inkscape.org/), gratis, preserva `id`s de forma confiable al guardar SVG nativo — evita "Optimized SVG" al exportar, que puede reescribir los `id`).

**Convención:** cualquier elemento con `id="campo:*"` es un placeholder que la herramienta rellena en tiempo de ejecución. Todo lo demás en la plantilla (círculo guía, arcos de texto) es contenido fijo, se copia tal cual.

El diseño final (confirmado con el usuario) tiene exactamente estos elementos, sin ningún adorno adicional:
1. Circunferencia externa (línea de guía de corte).
2. Texto curvado superior, fijo: "¿QUÉ TESOROS SE ESCONDEN AQUÍ?".
3. Texto curvado inferior, fijo: "¡ESCANEA Y DESCÚBRELOS!".
4. Nombre del espacio, arriba del QR (`campo:nombreEspacio`).
5. Nombre del mueble, debajo del QR (`campo:nombreMueble`).
6. Código QR con el monograma de Le Tiende embebido en el centro (`campo:qr`).

| id | Tipo de elemento | Qué hace la herramienta |
|---|---|---|
| `campo:nombreEspacio` | `<text>` (puede tener `<tspan>` hijos) | Reemplaza su `textContent` por el nombre real del espacio. |
| `campo:nombreMueble` | `<text>` | Igual, con el nombre del mueble. |
| `campo:qr` | `<rect x="…" y="…" width="…" height="…">` | Marca posición y tamaño (cuadrado) donde va el QR. Se reemplaza el nodo completo por el QR real (+ logo opcional). |

Reglas importantes si editas la plantilla:
- El `viewBox` del `<svg>` raíz debe ser cuadrado (`ancho == alto`) — ese ancho es el "diámetro de diseño nativo" de la plantilla.
- El `campo:qr` también debe ser cuadrado (`width == height`).
- Si borras o renombras por accidente alguno de los 3 `id="campo:*"`, la herramienta falla con un mensaje explícito indicando cuál falta — no genera nada a medias.
- Si `--diametro` pedido es distinto al `viewBox` nativo de la plantilla, la herramienta escala TODO el diseño proporcionalmente (no hay que rediseñar por cada tamaño).

## Logo (`assets/logo-mono.svg`)

Monograma "lt" de Le Tiende (copiado de `fuentes/logos_monos_svg/mono_negro.svg`, vive dentro del paquete para no depender de rutas fuera del repo de Babel). Por defecto se incrusta centrado sobre el QR, con un fondo blanco circular detrás (para no tocar directamente los módulos negros). Usa `--sin-logo` para omitirlo.

## Verificación automática de escaneo

Cada corrida de `npm run generar` decodifica el PNG de cada estampilla recién generada (con `jsqr`) y confirma que el QR corresponde exactamente a la URL esperada — si alguna no decodifica, avisa fuerte por consola (`⚠️ AVISO DE ESCANEO`) indicando qué mueble revisar, tanto por estampilla como en el resumen final. No detiene la corrida: las demás estampillas válidas igual se generan y quedan en el PDF.

**Por qué existe este chequeo:** durante el desarrollo de esta herramienta, un problema real de escaneabilidad se coló DOS VECES sin que la revisión visual (de dos personas distintas) lo detectara — la inspección visual de un QR no basta para confirmar que es escaneable. Solo se detectó decodificando los PNG con un lector de QR de verdad. Se investigaron y corrigieron dos causas raíz reales:
1. **Marcas decorativas cerca del QR** (ya eliminadas del diseño — ver arriba, fueron un malentendido del diseño de referencia).
2. **DPI y "zona silenciosa" (quiet zone) insuficientes**: a diámetros pequeños (60mm) con URLs largas (UUIDs reales → QR de versión 10, 57×57 módulos), 300dpi no le daba a cada módulo suficientes píxeles nativos para una decodificación confiable; y `margin: 1` en la generación del QR (menos que el mínimo de 4 módulos recomendado por el estándar ISO/IEC 18004) hacía fallar contenidos específicos de forma reproducible. Corregido: `src/rasterizar.ts`/`src/generador.ts` ahora rasterizan a 600dpi (no 300), y `src/qr.ts` usa `margin: 4` (no 1).

**Por qué `jsqr` y no `@zxing/library` para el chequeo permanente:** se probaron ambos contra más de 60 estampillas reales generadas contra `staging` (distintos muebles/espacios/diámetros/con-sin logo). `jsqr` decodificó correctamente el 100% de los casos en todas las rondas de prueba. `@zxing/library`, en cambio, mostró fallas reproducibles para contenidos QR específicos — se aisló con certeza que estas fallas son un problema **inherente al algoritmo de `@zxing/library` para ciertos patrones de bits exactos**, no un defecto real de la estampilla: se probó el PNG del QR crudo (sin ninguna plantilla, logo ni renderizado de por medio) contra 12 combinaciones distintas de tamaño/margen y falló en TODAS, mientras que el mismo contenido con `jsqr` (y visualmente) se ve perfectamente válido. Usar `@zxing/library` como chequeo automático produciría falsos negativos ruidosos sobre estampillas genuinamente correctas, así que no se agregó como dependencia permanente (se instaló solo temporalmente, con `--no-save`, para el diagnóstico).

**Aun así, esto no reemplaza escanear una estampilla impresa con la cámara de un celular real** — ni `jsqr` ni `@zxing/library` son representativos de la visión por computador mucho más robusta (multi-escala, tolerante a ángulo/distorsión) que usan las cámaras de los celulares reales. Antes de imprimir el lote completo, escanea al menos una estampilla impresa (con y sin `--sin-logo`, idealmente a más de un diámetro) con un celular real.

## Pruebas

```bash
npm test
```

Corre tests unitarios aislados (`vitest`, config propia — no comparte nada con `vitest.config.ts` de la raíz del repo):
- Matemática pura de la cuadrícula (`calcularCuadricula` en `src/pdf.ts`): confirma 2 columnas × 3 filas (6 por página) con 80mm/10mm margen/2mm separación, que la cuadrícula cambia con otro diámetro, y que no hay off-by-one.
- Carga y relleno de plantilla (`src/plantilla.test.ts`): confirma que el escalado a un `--diametro` distinto compensa correctamente el origen del `viewBox` cuando no es `(0,0)` (caso típico al editar en Inkscape).

## Estructura

- `plantillas/estampilla.svg` — plantilla editable del diseño (ver sección de arriba).
- `assets/logo-mono.svg` — logo mono de Le Tiende.
- `assets/fuentes/Poppins-Black.ttf`, `assets/fuentes/Poppins-Bold.ttf` — fuentes reales embebidas (Google Font, licencia OFL).
- `src/tipos.ts` — copia propia de los tipos `Espacio`/`Mueble` (no importa de `src/app/core/models/`).
- `src/dynamo.ts` — acceso a DynamoDB (`ScanCommand` paginado).
- `src/qr.ts` — genera el PNG del QR (`qrcode`, corrección de errores alta, `margin: 4`).
- `src/plantilla.ts` — carga y valida la plantilla (`cargarPlantilla`), y la rellena por mueble (`rellenarPlantilla`) usando `@xmldom/xmldom` (parser XML real, preserva mayúsculas/minúsculas de `viewBox`/`textPath`, a diferencia de un parser HTML).
- `src/logo.ts` — arma el fragmento SVG del QR + fondo blanco + logo, que reemplaza el placeholder `campo:qr`.
- `src/rasterizar.ts` — rasteriza el SVG final a PNG a 600dpi (`@resvg/resvg-js`, sin navegador headless), con las fuentes Poppins reales embebidas vía `fontFiles` (`loadSystemFonts: false` — resultado 100% reproducible sin depender de qué fuentes tenga instaladas la máquina).
- `src/generador.ts` — orquesta: arma la URL (`construirUrlCatalogo`), genera QR, arma el fragmento con logo, rellena la plantilla (cacheada), rasteriza.
- `src/verificacion.ts` — `verificarQrDecodifica`: decodifica un PNG ya generado con `jsqr` y confirma que coincide con la URL esperada (ver sección de escaneabilidad).
- `src/pdf.ts` — cuadrícula (función pura) y composición del PDF final (`pdf-lib`).
- `src/cli.ts` — entrada de línea de comandos (`node:util` `parseArgs`), incluye la verificación automática de escaneo por cada estampilla.

## Notas de diseño

- El texto fijo de la plantilla usa Poppins real (Black para los arcos fijos, Bold para los nombres variables) — embebida explícitamente vía `fontFiles` en `rasterizar.ts`, no depende de que el sistema tenga la fuente instalada.
- El arco de texto inferior de la plantilla semilla usa un `<path>` con sentido de barrido (`sweep-flag`) opuesto al del arco superior para que el texto se lea de izquierda a derecha y no quede espejado ni boca abajo.
- El texto de los arcos está envuelto palabra por palabra en `<tspan>` (con `xml:space="preserve"` en el `<text>`) para evitar que `resvg-js` colapse espacios dentro de `<textPath>`.
