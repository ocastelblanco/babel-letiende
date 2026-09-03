import { esEmbebido } from './embebido.service';

/**
 * Solo se prueba `esEmbebido()` como función pura — toda la lógica real
 * vive ahí. Probar la clase `EmbebidoService` con TestBed requeriría
 * mockear `REQUEST`/`PLATFORM_ID` de forma compleja para poco valor
 * adicional (mismo criterio que Ágora).
 */
describe('esEmbebido', () => {
  it('devuelve true para letiende.co', () => {
    expect(esEmbebido('letiende.co')).toBe(true);
  });

  it('devuelve true para staging.letiende.co', () => {
    expect(esEmbebido('staging.letiende.co')).toBe(true);
  });

  it('devuelve false para babel.letiende.co (dominio propio)', () => {
    expect(esEmbebido('babel.letiende.co')).toBe(false);
  });

  it('devuelve false para localhost', () => {
    expect(esEmbebido('localhost')).toBe(false);
  });

  it('devuelve false para una cadena vacía', () => {
    expect(esEmbebido('')).toBe(false);
  });
});
