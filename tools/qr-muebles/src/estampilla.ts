import type { Espacio, Mueble } from './tipos';

// Palabras de cada arco de texto, definidas como arreglo (no como una sola
// cadena con espacios) para evitar por completo el problema de espacios que
// se colapsan dentro de <textPath> (bug reproducido con resvg-js: el espacio
// entre "SE" y "ESCONDEN" desaparecía). Cada palabra se envuelve en su propio
// <tspan> y se unen con NBSP (U+00A0) — la combinación de ambas defensas es
// la que dio mejor resultado visual en las pruebas de esta tarea.
const PALABRAS_ARCO_SUPERIOR = ['¿QUÉ', 'TESOROS', 'SE', 'ESCONDEN', 'AQUÍ?'];
const PALABRAS_ARCO_INFERIOR = ['¡ESCANEA', 'Y', 'DESCÚBRELOS!'];
const NBSP = '\u00A0';

/** Escapa los caracteres especiales de XML en texto dinámico (nombres de espacio/mueble). */
function escaparXml(texto: string): string {
  return texto
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/** Arma el contenido de un <textPath> como una secuencia de <tspan> por palabra, unidos con NBSP. */
function textPathPorPalabras(palabras: string[]): string {
  return palabras.map((palabra) => `<tspan>${escaparXml(palabra)}</tspan>`).join(NBSP);
}

/** Punto sobre un círculo de radio `r` centrado en (cx, cy), en el ángulo dado (grados). */
function punto(cx: number, cy: number, r: number, anguloDeg: number): { x: number; y: number } {
  const rad = (anguloDeg * Math.PI) / 180;
  return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
}

/**
 * Marca decorativa tipo "diana" (imita un ojo de posición de QR, puramente
 * decorativa): anillo exterior + punto central relleno.
 */
function marcaDiana(cx: number, cy: number, radioExterior: number, grosorAnillo: number): string {
  const radioAnillo = radioExterior - grosorAnillo / 2;
  const radioCentro = radioExterior * 0.4;
  return `
    <circle cx="${cx}" cy="${cy}" r="${radioAnillo}" fill="none" stroke="black" stroke-width="${grosorAnillo}"/>
    <circle cx="${cx}" cy="${cy}" r="${radioCentro}" fill="black"/>
  `;
}

/**
 * Genera el SVG de una estampilla circular completa para un mueble: círculo
 * de guía de corte, arcos de texto superior/inferior, nombre de espacio y
 * mueble, QR centrado y 3 marcas decorativas tipo diana. Toda la geometría se
 * deriva proporcionalmente de `diametroMm` (el SVG usa ese mismo valor como
 * tamaño de viewBox, en unidades = mm) — nada queda fijo a un diámetro
 * particular.
 */
export function generarSvgEstampilla(
  espacio: Espacio,
  mueble: Mueble,
  diametroMm: number,
  qrPngBase64: string,
): string {
  const D = diametroMm;
  const cx = D / 2;
  const cy = D / 2;

  const rExterior = D * 0.49; // círculo de guía de corte
  // Radio de los arcos de texto: alejado de rExterior (para no salirse del
  // círculo) y, sobre todo, alejado del radio de las marcas decorativas (ver
  // corrección de esta tarea — antes ambos radios eran demasiado cercanos y
  // el inicio de cada arco quedaba tapado por la marca de esquina).
  const rArcoTexto = D * 0.44;

  // Arco superior: de 195° a 345° (pasa por 270°=arriba), sweep=1 => se lee
  // de izquierda a derecha. Confirmado visualmente en el spike de esta tarea.
  const supIni = punto(cx, cy, rArcoTexto, 195);
  const supFin = punto(cx, cy, rArcoTexto, 345);
  const pathSuperior = `M ${supIni.x} ${supIni.y} A ${rArcoTexto} ${rArcoTexto} 0 0 1 ${supFin.x} ${supFin.y}`;

  // Arco inferior: de 165° a 15° (pasa por 90°=abajo), sweep=0 => también se
  // lee de izquierda a derecha, sin quedar espejado ni boca abajo.
  const infIni = punto(cx, cy, rArcoTexto, 165);
  const infFin = punto(cx, cy, rArcoTexto, 15);
  const pathInferior = `M ${infIni.x} ${infIni.y} A ${rArcoTexto} ${rArcoTexto} 0 0 0 ${infFin.x} ${infFin.y}`;

  const qrLado = D * 0.52;
  const qrX = cx - qrLado / 2;
  const qrY = cy - qrLado / 2;

  const yNombreEspacio = qrY - D * 0.025;
  const yNombreMueble = qrY + qrLado + D * 0.055;

  // Marcas decorativas: radio y desplazamiento reducidos respecto a la
  // primera versión, y ancladas casi exactamente en la esquina del QR (en vez
  // de proyectarse hacia afuera) para que su radio máximo desde el centro
  // quede claramente por debajo de `rArcoTexto` — así no importa en qué
  // ángulo exacto empiece a dibujarse cada arco, la separación es radial y
  // no depende de esa coincidencia angular (causa real del bug de esta tarea).
  const radioMarca = D * 0.026;
  const grosorAnillo = D * 0.009;
  const offsetMarca = D * 0.008;
  const marcaSuperiorIzq = marcaDiana(qrX - offsetMarca, qrY - offsetMarca, radioMarca, grosorAnillo);
  const marcaSuperiorDer = marcaDiana(
    qrX + qrLado + offsetMarca,
    qrY - offsetMarca,
    radioMarca,
    grosorAnillo,
  );
  const marcaInferiorIzq = marcaDiana(
    qrX - offsetMarca,
    qrY + qrLado + offsetMarca,
    radioMarca,
    grosorAnillo,
  );

  const fontSizeArco = D * 0.042;
  const fontSizeNombre = D * 0.06;
  const idSuffix = `${espacio.espacioId}-${mueble.muebleId}`.replace(/[^a-zA-Z0-9_-]/g, '');

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${D}" height="${D}" viewBox="0 0 ${D} ${D}">
  <rect x="0" y="0" width="${D}" height="${D}" fill="white"/>
  <circle cx="${cx}" cy="${cy}" r="${rExterior}" fill="none" stroke="black" stroke-width="${D * 0.006}"/>
  <defs>
    <path id="arcoSup-${idSuffix}" d="${pathSuperior}" fill="none"/>
    <path id="arcoInf-${idSuffix}" d="${pathInferior}" fill="none"/>
  </defs>
  <text xml:space="preserve" font-family="sans-serif" font-weight="bold" font-size="${fontSizeArco}" fill="black" letter-spacing="${D * 0.001}">
    <textPath href="#arcoSup-${idSuffix}" startOffset="50%" text-anchor="middle">${textPathPorPalabras(PALABRAS_ARCO_SUPERIOR)}</textPath>
  </text>
  <text xml:space="preserve" font-family="sans-serif" font-weight="bold" font-size="${fontSizeArco}" fill="black" letter-spacing="${D * 0.001}">
    <textPath href="#arcoInf-${idSuffix}" startOffset="50%" text-anchor="middle">${textPathPorPalabras(PALABRAS_ARCO_INFERIOR)}</textPath>
  </text>
  <text x="${cx}" y="${yNombreEspacio}" font-family="sans-serif" font-weight="bold" font-size="${fontSizeNombre}" fill="black" text-anchor="middle">${escaparXml(espacio.nombre)}</text>
  <text x="${cx}" y="${yNombreMueble}" font-family="sans-serif" font-weight="bold" font-size="${fontSizeNombre}" fill="black" text-anchor="middle">${escaparXml(mueble.nombre)}</text>
  <image x="${qrX}" y="${qrY}" width="${qrLado}" height="${qrLado}" href="data:image/png;base64,${qrPngBase64}"/>
  ${marcaSuperiorIzq}
  ${marcaSuperiorDer}
  ${marcaInferiorIzq}
</svg>`;
}
