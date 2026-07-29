import { PDFDocument } from 'pdf-lib';

const PT_POR_MM = 72 / 25.4;
const CARTA_ANCHO_PT = 612; // 8.5in * 72pt/in
const CARTA_ALTO_PT = 792; // 11in * 72pt/in
const MARGEN_MM_DEFECTO = 10;
const SEPARACION_MM_DEFECTO = 2;

export interface OpcionesCuadricula {
  margenMm?: number;
  separacionMm?: number;
  anchoPaginaPt?: number;
  altoPaginaPt?: number;
}

export interface Cuadricula {
  columnas: number;
  filas: number;
  porPagina: number;
  diametroPt: number;
  margenPt: number;
  separacionPt: number;
  anchoPaginaPt: number;
  altoPaginaPt: number;
}

/**
 * Calcula cuántas estampillas circulares de `diametroMm` caben por página
 * carta (columnas × filas), dado un margen y una separación entre círculos.
 * Función pura, sin I/O — toda la geometría se deriva de `diametroMm`, nada
 * queda fijo a un diámetro particular.
 */
export function calcularCuadricula(
  diametroMm: number,
  opciones: OpcionesCuadricula = {},
): Cuadricula {
  const margenMm = opciones.margenMm ?? MARGEN_MM_DEFECTO;
  const separacionMm = opciones.separacionMm ?? SEPARACION_MM_DEFECTO;
  const anchoPaginaPt = opciones.anchoPaginaPt ?? CARTA_ANCHO_PT;
  const altoPaginaPt = opciones.altoPaginaPt ?? CARTA_ALTO_PT;

  const diametroPt = diametroMm * PT_POR_MM;
  const margenPt = margenMm * PT_POR_MM;
  const separacionPt = separacionMm * PT_POR_MM;

  const anchoUtil = anchoPaginaPt - 2 * margenPt;
  const altoUtil = altoPaginaPt - 2 * margenPt;

  // n círculos + (n-1) separaciones deben caber en el espacio útil:
  //   n*diametro + (n-1)*separacion <= util
  //   n <= (util + separacion) / (diametro + separacion)
  const columnas = Math.max(
    1,
    Math.floor((anchoUtil + separacionPt) / (diametroPt + separacionPt)),
  );
  const filas = Math.max(1, Math.floor((altoUtil + separacionPt) / (diametroPt + separacionPt)));

  return {
    columnas,
    filas,
    porPagina: columnas * filas,
    diametroPt,
    margenPt,
    separacionPt,
    anchoPaginaPt,
    altoPaginaPt,
  };
}

/**
 * Compone un PDF tamaño carta con todas las estampillas (ya rasterizadas a
 * PNG) repartidas en cuadrícula, paginando cuando no caben todas en una sola
 * página. No pierde ni duplica ninguna.
 */
export async function componerPdf(pngs: Buffer[], diametroMm: number): Promise<Buffer> {
  const cuadricula = calcularCuadricula(diametroMm);
  const { columnas, filas, porPagina, diametroPt, margenPt, separacionPt, anchoPaginaPt, altoPaginaPt } =
    cuadricula;

  // Centra la cuadrícula dentro del área útil de la página (en vez de
  // pegarla contra el margen superior-izquierdo), repartiendo el espacio
  // sobrante en partes iguales a cada lado. Puramente estético — no cambia
  // cuántas estampillas caben ni su tamaño.
  const anchoUtil = anchoPaginaPt - 2 * margenPt;
  const altoUtil = altoPaginaPt - 2 * margenPt;
  const anchoOcupado = columnas * diametroPt + (columnas - 1) * separacionPt;
  const altoOcupado = filas * diametroPt + (filas - 1) * separacionPt;
  const offsetX = margenPt + (anchoUtil - anchoOcupado) / 2;
  const offsetY = margenPt + (altoUtil - altoOcupado) / 2;

  const pdf = await PDFDocument.create();

  for (let inicio = 0; inicio < pngs.length; inicio += porPagina) {
    const pagina = pdf.addPage([anchoPaginaPt, altoPaginaPt]);
    const lotePagina = pngs.slice(inicio, inicio + porPagina);

    for (let indiceEnPagina = 0; indiceEnPagina < lotePagina.length; indiceEnPagina++) {
      const fila = Math.floor(indiceEnPagina / columnas);
      const columna = indiceEnPagina % columnas;

      const x = offsetX + columna * (diametroPt + separacionPt);
      const yDesdeArriba = offsetY + fila * (diametroPt + separacionPt);
      const y = altoPaginaPt - yDesdeArriba - diametroPt;

      const imagenPng = await pdf.embedPng(lotePagina[indiceEnPagina]);
      pagina.drawImage(imagenPng, { x, y, width: diametroPt, height: diametroPt });
    }
  }

  const bytes = await pdf.save();
  return Buffer.from(bytes);
}
