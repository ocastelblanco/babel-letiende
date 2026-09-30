/**
 * Bogotá (`America/Bogota`) es UTC-5 todo el año (Colombia no usa horario de
 * verano), así que un desfase fijo es exacto. Las fechas se guardan siempre en
 * UTC (ISO); esta conversión solo se aplica al presentarlas en reportes.
 */
const DESFASE_BOGOTA_MS = -5 * 60 * 60 * 1000;

/** Convierte un ISO UTC a `DD/MM/YYYY HH:MM:SS` en hora de Bogotá. Devuelve el valor original si no es una fecha válida. */
export function formatearFechaBogota(isoUtc: string): string {
  const ms = Date.parse(isoUtc);
  if (Number.isNaN(ms)) {
    return isoUtc;
  }
  const [fecha, hora] = new Date(ms + DESFASE_BOGOTA_MS).toISOString().split('T');
  const [anio, mes, dia] = fecha.split('-');
  return `${dia}/${mes}/${anio} ${hora.slice(0, 8)}`;
}
