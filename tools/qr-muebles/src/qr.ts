import QRCode from 'qrcode';

/**
 * Genera el PNG de un código QR en memoria, con corrección de errores alta.
 * `margin: 4` (no 1) — es el mínimo de "zona silenciosa" recomendado por el
 * estándar ISO/IEC 18004; con margin=1 algunos contenidos de QR (depende del
 * patrón exacto de módulos, no del tamaño) fallan de forma reproducible con
 * decodificadores reales como `@zxing/library`, incluso con suficiente DPI.
 */
export async function generarPngQr(url: string, tamanoPx: number): Promise<Buffer> {
  return QRCode.toBuffer(url, {
    errorCorrectionLevel: 'H',
    width: tamanoPx,
    margin: 4,
  });
}
