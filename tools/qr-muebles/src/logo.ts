import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { DOMParser, XMLSerializer } from '@xmldom/xmldom';

// Ruta al asset, resuelta relativa a este módulo (no al cwd) — el logo vive
// dentro del propio paquete (`tools/qr-muebles/assets/`) para no depender de
// `fuentes/`, que está fuera del repo de Babel.
const RUTA_LOGO = fileURLToPath(new URL('../assets/logo-mono.svg', import.meta.url));

const FRACCION_LOGO_EN_QR = 0.2; // ~20% del lado del QR, per la tarea
const FRACCION_FONDO_EN_QR = 0.24; // ~24% del lado del QR, per la tarea

interface LogoCargado {
  viewBoxMinX: number;
  viewBoxMinY: number;
  viewBoxAncho: number;
  viewBoxAlto: number;
  /** Contenido interno del <svg> del logo (sus hijos), ya serializado. */
  contenidoInterno: string;
}

let logoCacheado: LogoCargado | undefined;

/** Carga y parsea `assets/logo-mono.svg` una sola vez (cacheado en memoria). */
function cargarLogo(): LogoCargado {
  if (logoCacheado) return logoCacheado;

  const xml = readFileSync(RUTA_LOGO, 'utf-8');
  const doc = new DOMParser().parseFromString(xml, 'image/svg+xml');
  const raiz = doc.documentElement;

  const viewBox = raiz?.getAttribute('viewBox');
  if (!raiz || !viewBox) {
    throw new Error(`El logo en "${RUTA_LOGO}" no tiene un <svg> raíz con atributo viewBox válido.`);
  }

  const partes = viewBox.trim().split(/[\s,]+/).map(Number);
  if (partes.length !== 4 || partes.some((n) => !Number.isFinite(n))) {
    throw new Error(`El viewBox del logo en "${RUTA_LOGO}" no tiene el formato esperado "minX minY ancho alto".`);
  }
  const [viewBoxMinX, viewBoxMinY, viewBoxAncho, viewBoxAlto] = partes;

  const serializadoCompleto = new XMLSerializer().serializeToString(raiz);
  const coincidencia = serializadoCompleto.match(/^<svg[^>]*>([\s\S]*)<\/svg>$/);
  if (!coincidencia) {
    throw new Error(`No se pudo extraer el contenido interno del logo en "${RUTA_LOGO}".`);
  }

  logoCacheado = {
    viewBoxMinX,
    viewBoxMinY,
    viewBoxAncho,
    viewBoxAlto,
    contenidoInterno: coincidencia[1],
  };
  return logoCacheado;
}

/**
 * Arma el fragmento SVG que reemplaza el placeholder `campo:qr` de la
 * plantilla: el QR en sí, y opcionalmente un fondo blanco + el logo mono de
 * Le Tiende centrado encima. Coordenadas LOCALES `0..qrLadoMm` — quien llama
 * (`rellenarPlantilla`) ubica este fragmento en la posición real del
 * placeholder dentro de la plantilla.
 */
export function fragmentoQrConLogo(qrPngBase64: string, qrLadoMm: number, incluirLogo: boolean): string {
  const imagenQr = `<image x="0" y="0" width="${qrLadoMm}" height="${qrLadoMm}" href="data:image/png;base64,${qrPngBase64}"/>`;

  if (!incluirLogo) {
    return `<g>${imagenQr}</g>`;
  }

  const logo = cargarLogo();

  const logoLadoMm = qrLadoMm * FRACCION_LOGO_EN_QR;
  const fondoLadoMm = qrLadoMm * FRACCION_FONDO_EN_QR;

  // "Contain" dentro de un cuadro logoLadoMm x logoLadoMm, preservando la
  // proporción original del logo (más ancho que alto).
  const escala = Math.min(logoLadoMm / logo.viewBoxAncho, logoLadoMm / logo.viewBoxAlto);
  const anchoRenderizado = logo.viewBoxAncho * escala;
  const altoRenderizado = logo.viewBoxAlto * escala;
  const trasladoX = (qrLadoMm - anchoRenderizado) / 2 - logo.viewBoxMinX * escala;
  const trasladoY = (qrLadoMm - altoRenderizado) / 2 - logo.viewBoxMinY * escala;

  const fondoBlanco = `<circle cx="${qrLadoMm / 2}" cy="${qrLadoMm / 2}" r="${fondoLadoMm / 2}" fill="white"/>`;
  const grupoLogo = `<g transform="translate(${trasladoX}, ${trasladoY}) scale(${escala})">${logo.contenidoInterno}</g>`;

  return `<g>${imagenQr}${fondoBlanco}${grupoLogo}</g>`;
}
