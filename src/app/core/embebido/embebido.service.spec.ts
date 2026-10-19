import { cartaVisibleEnHost, esEmbebido } from './embebido.service';

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

describe('cartaVisibleEnHost', () => {
  it('devuelve true en staging.letiende.co, localhost y 127.0.0.1', () => {
    expect(cartaVisibleEnHost('staging.letiende.co', false)).toBe(true);
    expect(cartaVisibleEnHost('localhost', false)).toBe(true);
    expect(cartaVisibleEnHost('127.0.0.1', false)).toBe(true);
  });

  it('devuelve false en letiende.co y babel.letiende.co mientras la carta no esté publicada', () => {
    expect(cartaVisibleEnHost('letiende.co', false)).toBe(false);
    expect(cartaVisibleEnHost('babel.letiende.co', false)).toBe(false);
    expect(cartaVisibleEnHost('', false)).toBe(false);
  });

  it('devuelve true en cualquier host cuando la carta está publicada', () => {
    expect(cartaVisibleEnHost('letiende.co', true)).toBe(true);
  });
});
