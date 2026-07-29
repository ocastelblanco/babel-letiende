import jsQR from 'jsqr';
import { PNG } from 'pngjs';

/**
 * Decodifica el PNG de una estampilla ya generada y confirma que el QR
 * incrustado decodifica exactamente a `urlEsperada`.
 *
 * Por qué esto existe: durante el desarrollo de esta herramienta, un bug real
 * (marcas decorativas demasiado cerca del QR, y luego un DPI/margen
 * insuficientes) se coló dos veces sin ser detectado por revisión visual —
 * solo se detectó decodificando el PNG con un lector de QR de verdad. La
 * inspección visual NO es suficiente para confirmar que un QR es escaneable.
 *
 * Usa `jsqr` (no `@zxing/library`): en las pruebas de esta tarea, `jsqr`
 * decodificó correctamente el 100% de más de 60 estampillas reales probadas
 * (distintos muebles/espacios/diámetros/con-sin logo), mientras que
 * `@zxing/library` falló de forma reproducible en contenidos QR específicos
 * incluso en el PNG crudo del QR sin ningún renderizado de por medio (ver
 * README) — es decir, un falso negativo de `zxing` no implicaba un QR
 * realmente roto. `jsqr` es la señal confiable disponible en este entorno.
 *
 * Esto NO reemplaza escanear una estampilla impresa con un celular real.
 */
export function verificarQrDecodifica(png: Buffer, urlEsperada: string): boolean {
  const imagen = PNG.sync.read(png);
  const resultado = jsQR(new Uint8ClampedArray(imagen.data), imagen.width, imagen.height);
  return resultado?.data === urlEsperada;
}
