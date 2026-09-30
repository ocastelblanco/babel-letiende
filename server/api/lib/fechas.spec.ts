import { describe, expect, it } from 'vitest';
import { formatearFechaBogota } from './fechas';

describe('formatearFechaBogota', () => {
  it('resta 5 horas al ISO UTC', () => {
    expect(formatearFechaBogota('2026-07-15T15:30:45.000Z')).toBe('15/07/2026 10:30:45');
  });

  it('retrocede al día anterior cuando UTC ya cambió de día', () => {
    expect(formatearFechaBogota('2026-08-01T02:10:00.000Z')).toBe('31/07/2026 21:10:00');
  });

  it('devuelve el valor original si no es una fecha válida', () => {
    expect(formatearFechaBogota('no-es-fecha')).toBe('no-es-fecha');
  });
});
