# qr-muebles

Herramienta standalone (fuera del build/deploy de Angular/Lambda de Babel) que genera un único PDF tamaño carta con estampillas circulares de código QR — una por cada mueble catalogado — para imprimir y pegar físicamente en los muebles de la librería.

Cada QR apunta al catálogo público de Babel filtrado por espacio y mueble:

```
https://babel.letiende.co/?espacio={espacioId}&mueble={muebleId}
```

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
npm run generar -- [--stage staging] [--diametro 80] [--salida tools/qr-muebles/salida/estampillas-qr.pdf]
```

| Flag | Default | Descripción |
|---|---|---|
| `--stage` | `staging` | Stage de las tablas DynamoDB (`babel-espacios-{stage}`, `babel-muebles-{stage}`). Producción todavía no existe. |
| `--diametro` | `80` | Diámetro de cada estampilla circular, en milímetros. |
| `--salida` | `salida/estampillas-qr.pdf` (relativo al cwd — al correrlo con `npm run generar` desde `tools/qr-muebles/`, termina en `tools/qr-muebles/salida/estampillas-qr.pdf`) | Ruta del PDF generado. Se crea el directorio si no existe. |

Ejemplo con diámetro distinto:

```bash
npm run generar -- --diametro 60 --salida salida/prueba-60mm.pdf
```

El comando:
1. Trae todos los espacios y muebles del stage indicado (en paralelo).
2. Imprime por consola cuántos espacios/muebles encontró.
3. Si algún mueble referencia un `espacioId` que no existe, lo avisa por consola y lo omite (no rompe la corrida).
4. Genera cada estampilla (QR + textos + marcas decorativas) y las reparte en una cuadrícula sobre páginas tamaño carta, paginando cuando no caben todas en una sola hoja.
5. Escribe el PDF e imprime la ruta final.

Si fallan las credenciales de AWS (o cualquier otro error de acceso a DynamoDB), se muestra un mensaje claro en español en vez del stack trace crudo del SDK.

## Pruebas

```bash
npm test
```

Corre un test unitario aislado (`vitest`, config propia — no comparte nada con `vitest.config.ts` de la raíz del repo) de la matemática pura de la cuadrícula (`calcularCuadricula` en `src/pdf.ts`): confirma 2 columnas × 3 filas (6 por página) con 80mm/10mm margen/2mm separación, que la cuadrícula cambia con otro diámetro, y que no hay off-by-one.

## Estructura

- `src/tipos.ts` — copia propia de los tipos `Espacio`/`Mueble` (no importa de `src/app/core/models/`).
- `src/dynamo.ts` — acceso a DynamoDB (`ScanCommand` paginado).
- `src/qr.ts` — genera el PNG del QR (`qrcode`, corrección de errores alta).
- `src/estampilla.ts` — arma el SVG completo de una estampilla (círculo guía, arcos de texto curvo, nombres, QR, marcas decorativas). Toda la geometría se deriva proporcionalmente del diámetro recibido.
- `src/rasterizar.ts` — rasteriza el SVG a PNG a 300dpi (`@resvg/resvg-js`, sin navegador headless).
- `src/generador.ts` — orquesta: arma la URL, genera QR, arma SVG, rasteriza.
- `src/pdf.ts` — cuadrícula (función pura) y composición del PDF final (`pdf-lib`).
- `src/cli.ts` — entrada de línea de comandos (`node:util` `parseArgs`).

## Notas de diseño

- El texto de las estampillas usa una fuente bold del sistema (`loadSystemFonts: true` en `resvg-js`) — no hay un `.ttf` de Poppins local en el repo (Poppins solo se carga por CDN en `src/index.html`). Si en el futuro se agrega un `.ttf` local, se puede pasar vía la opción `fontFiles` de `resvg-js` en `src/rasterizar.ts`.
- El arco de texto inferior usa un `<path>` con sentido de barrido (`sweep-flag`) opuesto al del arco superior para que el texto se lea de izquierda a derecha y no quede espejado ni boca abajo — confirmado visualmente durante el desarrollo rasterizando un SVG de prueba con un solo QR.
