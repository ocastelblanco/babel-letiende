import { Resvg } from '@resvg/resvg-js';

const MM_POR_PULGADA = 25.4;

/**
 * Rasteriza un SVG cuadrado (viewBox `0 0 diametroMm diametroMm`) a PNG, al
 * dpi indicado (300 por defecto — calidad de impresión).
 */
export function rasterizarSvgAPng(svg: string, diametroMm: number, dpi = 300): Buffer {
  const tamanoPx = Math.round((diametroMm / MM_POR_PULGADA) * dpi);
  const resvg = new Resvg(svg, {
    fitTo: { mode: 'width', value: tamanoPx },
    font: { loadSystemFonts: true, defaultFontFamily: 'sans-serif' },
  });
  return Buffer.from(resvg.render().asPng());
}
