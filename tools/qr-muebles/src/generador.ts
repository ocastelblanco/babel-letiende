import { generarPngQr } from './qr';
import { generarSvgEstampilla } from './estampilla';
import { rasterizarSvgAPng } from './rasterizar';
import type { Espacio, Mueble } from './tipos';

const MM_POR_PULGADA = 25.4;
const DPI_ESTAMPILLA = 300;
const FRACCION_QR_EN_DIAMETRO = 0.52; // debe coincidir con el qrLado usado en estampilla.ts

const URL_BASE_CATALOGO = 'https://babel.letiende.co/';

/**
 * Arma la URL del catálogo público filtrado por espacio+mueble, genera el
 * QR, arma el SVG completo de la estampilla y lo rasteriza a PNG final.
 */
export async function generarEstampillaPng(
  espacio: Espacio,
  mueble: Mueble,
  diametroMm: number,
): Promise<Buffer> {
  const url = new URL(URL_BASE_CATALOGO);
  url.searchParams.set('espacio', espacio.espacioId);
  url.searchParams.set('mueble', mueble.muebleId);

  const qrLadoMm = diametroMm * FRACCION_QR_EN_DIAMETRO;
  const qrTamanoPx = Math.round((qrLadoMm / MM_POR_PULGADA) * DPI_ESTAMPILLA);

  const qrPng = await generarPngQr(url.toString(), qrTamanoPx);
  const svg = generarSvgEstampilla(espacio, mueble, diametroMm, qrPng.toString('base64'));

  return rasterizarSvgAPng(svg, diametroMm, DPI_ESTAMPILLA);
}
