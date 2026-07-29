import { fileURLToPath } from 'node:url';
import { Resvg } from '@resvg/resvg-js';

const MM_POR_PULGADA = 25.4;

// Fuentes reales embebidas explícitamente (rutas resueltas relativas a este
// módulo, no al cwd — mismo patrón que `RUTA_LOGO` en `logo.ts`). Con las
// fuentes reales cargadas, `loadSystemFonts: false` hace el resultado 100%
// reproducible sin importar qué fuentes tenga instaladas la máquina donde
// se corra la herramienta.
const RUTA_POPPINS_BLACK = fileURLToPath(new URL('../assets/fuentes/Poppins-Black.ttf', import.meta.url));
const RUTA_POPPINS_BOLD = fileURLToPath(new URL('../assets/fuentes/Poppins-Bold.ttf', import.meta.url));

/**
 * Rasteriza un SVG cuadrado (viewBox `0 0 diametroMm diametroMm`) a PNG, al
 * dpi indicado (600 por defecto — a diámetros pequeños con QR de módulos
 * finos, 300dpi no alcanza para una decodificación confiable, ver
 * `generador.ts`).
 */
export function rasterizarSvgAPng(svg: string, diametroMm: number, dpi = 600): Buffer {
  const tamanoPx = Math.round((diametroMm / MM_POR_PULGADA) * dpi);
  const resvg = new Resvg(svg, {
    fitTo: { mode: 'width', value: tamanoPx },
    font: {
      loadSystemFonts: false,
      fontFiles: [RUTA_POPPINS_BLACK, RUTA_POPPINS_BOLD],
      defaultFontFamily: 'Poppins',
    },
  });
  return Buffer.from(resvg.render().asPng());
}
