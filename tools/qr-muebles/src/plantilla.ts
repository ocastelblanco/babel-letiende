import { readFileSync } from 'node:fs';
import { DOMParser, XMLSerializer } from '@xmldom/xmldom';
import type { Document as XmlDocument, Element as XmlElement } from '@xmldom/xmldom';
import type { Espacio, Mueble } from './tipos';

const SVG_NS = 'http://www.w3.org/2000/svg';

/** Prefijo de convención de plantilla: cualquier id que empiece así es un placeholder rellenable. */
const CAMPO_NOMBRE_ESPACIO = 'campo:nombreEspacio';
const CAMPO_NOMBRE_MUEBLE = 'campo:nombreMueble';
const CAMPO_QR = 'campo:qr';

export interface PlantillaCargada {
  /** XML crudo de la plantilla — se re-parsea desde cero en cada `rellenarPlantilla`. */
  xmlOriginal: string;
  /** Diámetro de diseño nativo de la plantilla (ancho del viewBox raíz), en mm. */
  diametroNativoMm: number;
  /** Lado nativo (mm) del placeholder `campo:qr`, tal como está en la plantilla. */
  qrLadoNativoMm: number;
  /** `minX` del viewBox original — normalmente 0, pero editores como Inkscape pueden desplazarlo. */
  minXViewBox: number;
  /** `minY` del viewBox original — normalmente 0, pero editores como Inkscape pueden desplazarlo. */
  minYViewBox: number;
}

/**
 * Recorre manualmente el árbol de `nodo` buscando un elemento cuyo atributo
 * `id` sea exactamente `id`. No usa `getElementById` (no es confiable en XML
 * puro sin DTD que declare qué atributo es de tipo ID).
 */
function buscarPorId(nodo: XmlElement, id: string): XmlElement | null {
  const todos = nodo.getElementsByTagName('*');
  for (let i = 0; i < todos.length; i++) {
    const candidato = todos.item(i);
    if (candidato && candidato.getAttribute('id') === id) {
      return candidato;
    }
  }
  return null;
}

/** Busca por id o lanza un error claro en español indicando cuál placeholder falta. */
function exigirPorId(nodo: XmlElement, id: string, rutaSvg: string): XmlElement {
  const encontrado = buscarPorId(nodo, id);
  if (!encontrado) {
    throw new Error(
      `La plantilla "${rutaSvg}" no tiene ningún elemento con id="${id}". ` +
        'Revisa que no lo hayas borrado o renombrado al editar el archivo.',
    );
  }
  return encontrado;
}

function reemplazarTextContent(nodo: XmlElement, texto: string, doc: XmlDocument): void {
  while (nodo.firstChild) {
    nodo.removeChild(nodo.firstChild);
  }
  nodo.appendChild(doc.createTextNode(texto));
}

/**
 * Lee y valida una plantilla SVG editable por el usuario (convención
 * `id="campo:*"`, ver `plantillas/estampilla.svg`). Falla rápido con un
 * mensaje claro si falta cualquiera de los 3 campos requeridos o si el
 * `viewBox` raíz no es válido — así, si el usuario rompe su plantilla al
 * editarla en Inkscape, lo sabe de inmediato al correr la herramienta, no a
 * mitad de la generación del lote.
 */
export function cargarPlantilla(rutaSvg: string): PlantillaCargada {
  const xmlOriginal = readFileSync(rutaSvg, 'utf-8');
  const doc = new DOMParser().parseFromString(xmlOriginal, 'image/svg+xml');
  const raiz = doc.documentElement;

  const viewBox = raiz?.getAttribute('viewBox');
  if (!raiz || !viewBox) {
    throw new Error(`La plantilla "${rutaSvg}" no tiene un <svg> raíz con atributo viewBox válido.`);
  }
  const partesViewBox = viewBox.trim().split(/[\s,]+/).map(Number);
  if (partesViewBox.length !== 4 || partesViewBox.some((n) => !Number.isFinite(n))) {
    throw new Error(`El viewBox de la plantilla "${rutaSvg}" no tiene el formato esperado "minX minY ancho alto".`);
  }
  const [minXViewBox, minYViewBox, anchoViewBox, altoViewBox] = partesViewBox;
  if (Math.abs(anchoViewBox - altoViewBox) > 1e-6) {
    throw new Error(
      `La plantilla "${rutaSvg}" debe tener un viewBox cuadrado (ancho == alto); tiene ${anchoViewBox}x${altoViewBox}.`,
    );
  }

  exigirPorId(raiz, CAMPO_NOMBRE_ESPACIO, rutaSvg);
  exigirPorId(raiz, CAMPO_NOMBRE_MUEBLE, rutaSvg);
  const nodoQr = exigirPorId(raiz, CAMPO_QR, rutaSvg);

  const anchoQr = Number(nodoQr.getAttribute('width'));
  const altoQr = Number(nodoQr.getAttribute('height'));
  if (!Number.isFinite(anchoQr) || !Number.isFinite(altoQr) || anchoQr <= 0) {
    throw new Error(`El elemento id="${CAMPO_QR}" de la plantilla "${rutaSvg}" no tiene width/height numéricos válidos.`);
  }
  if (Math.abs(anchoQr - altoQr) > 1e-6) {
    throw new Error(
      `El elemento id="${CAMPO_QR}" de la plantilla "${rutaSvg}" debe ser cuadrado (width == height); tiene ${anchoQr}x${altoQr}.`,
    );
  }

  return {
    xmlOriginal,
    diametroNativoMm: anchoViewBox,
    qrLadoNativoMm: anchoQr,
    minXViewBox,
    minYViewBox,
  };
}

/**
 * Rellena una copia fresca de la plantilla con los datos de un mueble
 * concreto: nombre de espacio, nombre de mueble, y el fragmento QR+logo ya
 * armado (ver `logo.ts`). Si `diametroDeseadoMm` difiere del diámetro nativo
 * de la plantilla, escala todo el diseño (envolviendo el contenido en un
 * `<g transform="scale(factor)">`) — así el `--diametro` configurable sigue
 * funcionando igual que antes, ahora escalando el diseño del usuario en vez
 * de recalcular geometría en código.
 */
export function rellenarPlantilla(
  plantilla: PlantillaCargada,
  espacio: Espacio,
  mueble: Mueble,
  qrSvgFragmento: string,
  diametroDeseadoMm: number,
): string {
  // Re-parsea un clon fresco: cada estampilla necesita su propia copia
  // limpia, nunca se muta un documento compartido entre llamadas.
  const doc = new DOMParser().parseFromString(plantilla.xmlOriginal, 'image/svg+xml');
  const raiz = doc.documentElement;
  const rutaSvg = '(plantilla en memoria)';

  if (!raiz) {
    throw new Error('La plantilla en memoria no tiene un <svg> raíz (esto no debería pasar tras cargarPlantilla).');
  }

  const nodoEspacio = exigirPorId(raiz, CAMPO_NOMBRE_ESPACIO, rutaSvg);
  reemplazarTextContent(nodoEspacio, espacio.nombre, doc);

  const nodoMueble = exigirPorId(raiz, CAMPO_NOMBRE_MUEBLE, rutaSvg);
  reemplazarTextContent(nodoMueble, mueble.nombre, doc);

  const nodoQr = exigirPorId(raiz, CAMPO_QR, rutaSvg);
  const xQr = nodoQr.getAttribute('x') ?? '0';
  const yQr = nodoQr.getAttribute('y') ?? '0';

  const fragDoc = new DOMParser().parseFromString(
    `<g transform="translate(${xQr}, ${yQr})">${qrSvgFragmento}</g>`,
    'image/svg+xml',
  );
  const fragRaiz = fragDoc.documentElement;
  if (!fragRaiz) {
    throw new Error('El fragmento SVG del QR (armado en logo.ts) no se pudo parsear.');
  }
  const nodoReemplazo = doc.importNode(fragRaiz, true);
  const padreQr = nodoQr.parentNode;
  if (!padreQr) {
    throw new Error(`El elemento id="${CAMPO_QR}" de la plantilla no tiene nodo padre (SVG mal formado).`);
  }
  padreQr.insertBefore(nodoReemplazo, nodoQr);
  padreQr.removeChild(nodoQr);

  if (Math.abs(diametroDeseadoMm - plantilla.diametroNativoMm) > 1e-9) {
    const factor = diametroDeseadoMm / plantilla.diametroNativoMm;

    // El contenido de la plantilla está posicionado en coordenadas relativas
    // al origen de su viewBox original (minXViewBox, minYViewBox) — que no
    // siempre es (0,0): editores como Inkscape suelen desplazarlo al
    // redimensionar el lienzo (ej. "-2 -2 84 84"). El viewBox final siempre
    // se reconstruye como "0 0 diametroDeseadoMm diametroDeseadoMm", así que
    // antes de escalar hay que trasladar ese origen a (0,0). El atributo
    // `transform` compone de derecha a izquierda al aplicarse a un punto, por
    // lo que "primero trasladar, luego escalar" se escribe
    // `scale(factor) translate(-minX, -minY)`.
    const traslado =
      plantilla.minXViewBox !== 0 || plantilla.minYViewBox !== 0
        ? ` translate(${-plantilla.minXViewBox}, ${-plantilla.minYViewBox})`
        : '';

    const grupoEscalado = doc.createElementNS(SVG_NS, 'g');
    grupoEscalado.setAttribute('transform', `scale(${factor})${traslado}`);
    while (raiz.firstChild) {
      grupoEscalado.appendChild(raiz.firstChild);
    }
    raiz.appendChild(grupoEscalado);

    raiz.setAttribute('viewBox', `0 0 ${diametroDeseadoMm} ${diametroDeseadoMm}`);
  }

  raiz.setAttribute('width', String(diametroDeseadoMm));
  raiz.setAttribute('height', String(diametroDeseadoMm));

  return new XMLSerializer().serializeToString(doc);
}
