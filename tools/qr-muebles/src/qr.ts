import QRCode from 'qrcode';

/** Genera el PNG de un código QR en memoria, con corrección de errores alta. */
export async function generarPngQr(url: string, tamanoPx: number): Promise<Buffer> {
  return QRCode.toBuffer(url, {
    errorCorrectionLevel: 'H',
    width: tamanoPx,
    margin: 1,
  });
}
