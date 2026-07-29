import { generarPngQr } from './qr';
import { cargarPlantilla, rellenarPlantilla, type PlantillaCargada } from './plantilla';
import { fragmentoQrConLogo } from './logo';
import { rasterizarSvgAPng } from './rasterizar';
import type { Espacio, Mueble } from './tipos';

const MM_POR_PULGADA = 25.4;
// 600dpi (no 300): a diámetros pequeños (ej. 60mm) combinados con URLs largas
// (UUIDs reales -> QR de versión alta, módulos pequeños), 300dpi no le da
// suficientes píxeles nativos a cada módulo del QR y la decodificación con
// lectores de QR reales falla de forma consistente y reproducible. 400dpi ya
// resuelve el problema sistemático; se usa 600dpi como margen de seguridad.
// Diagnóstico completo y evidencia en README.md ("Escaneabilidad").
const DPI_ESTAMPILLA = 600;

const URL_BASE_CATALOGO = 'https://babel.letiende.co/';

/** Arma la URL del catálogo público filtrado por espacio+mueble — la misma que se codifica en el QR. */
export function construirUrlCatalogo(espacio: Espacio, mueble: Mueble): string {
  const url = new URL(URL_BASE_CATALOGO);
  url.searchParams.set('espacio', espacio.espacioId);
  url.searchParams.set('mueble', mueble.muebleId);
  return url.toString();
}

// Cachea la plantilla cargada por ruta — no se relee el archivo por cada
// mueble, solo la primera vez (o si cambia la ruta entre llamadas).
let plantillaCacheada: { ruta: string; plantilla: PlantillaCargada } | undefined;

function obtenerPlantillaCacheada(rutaPlantilla: string): PlantillaCargada {
  if (!plantillaCacheada || plantillaCacheada.ruta !== rutaPlantilla) {
    plantillaCacheada = { ruta: rutaPlantilla, plantilla: cargarPlantilla(rutaPlantilla) };
  }
  return plantillaCacheada.plantilla;
}

/**
 * Arma la URL del catálogo público filtrado por espacio+mueble, genera el
 * QR (con logo opcional), rellena la plantilla del usuario y rasteriza el
 * resultado a PNG final.
 */
export async function generarEstampillaPng(
  espacio: Espacio,
  mueble: Mueble,
  diametroMm: number,
  rutaPlantilla: string,
  incluirLogo: boolean,
): Promise<Buffer> {
  const plantilla = obtenerPlantillaCacheada(rutaPlantilla);
  const url = construirUrlCatalogo(espacio, mueble);

  // El QR se genera al tamaño EFECTIVO final (lado nativo del placeholder
  // escalado al diámetro deseado), no al tamaño nativo — así, si el usuario
  // pide un diámetro mucho mayor al de diseño de la plantilla, el QR
  // incrustado no sale borroso al escalarse.
  const factorEscala = diametroMm / plantilla.diametroNativoMm;
  const qrLadoEfectivoMm = plantilla.qrLadoNativoMm * factorEscala;
  const qrTamanoPx = Math.round((qrLadoEfectivoMm / MM_POR_PULGADA) * DPI_ESTAMPILLA);

  const qrPng = await generarPngQr(url, qrTamanoPx);
  const qrFragmento = fragmentoQrConLogo(qrPng.toString('base64'), plantilla.qrLadoNativoMm, incluirLogo);

  const svg = rellenarPlantilla(plantilla, espacio, mueble, qrFragmento, diametroMm);

  return rasterizarSvgAPng(svg, diametroMm, DPI_ESTAMPILLA);
}
