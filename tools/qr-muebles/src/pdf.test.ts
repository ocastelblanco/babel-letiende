import { describe, expect, it } from 'vitest';
import { calcularCuadricula } from './pdf';

describe('calcularCuadricula', () => {
  it('da 2 columnas x 3 filas (6 por página) con 80mm/10mm margen/2mm separación', () => {
    const cuadricula = calcularCuadricula(80);
    expect(cuadricula.columnas).toBe(2);
    expect(cuadricula.filas).toBe(3);
    expect(cuadricula.porPagina).toBe(6);
  });

  it('cambia la cuadrícula con un diámetro distinto (60mm da más columnas/filas que 80mm)', () => {
    const cuadricula60 = calcularCuadricula(60);
    const cuadricula80 = calcularCuadricula(80);
    expect(cuadricula60.columnas).toBeGreaterThan(cuadricula80.columnas);
    expect(cuadricula60.filas).toBeGreaterThan(cuadricula80.filas);
    expect(cuadricula60.porPagina).toBeGreaterThan(cuadricula80.porPagina);
  });

  it('no comete off-by-one: todas las estampillas caben dentro del área útil de la página', () => {
    for (const diametroMm of [40, 60, 80, 100]) {
      const cuadricula = calcularCuadricula(diametroMm);
      const { columnas, filas, diametroPt, margenPt, separacionPt, anchoPaginaPt, altoPaginaPt } =
        cuadricula;

      const anchoOcupado = columnas * diametroPt + (columnas - 1) * separacionPt;
      const altoOcupado = filas * diametroPt + (filas - 1) * separacionPt;

      expect(margenPt + anchoOcupado).toBeLessThanOrEqual(anchoPaginaPt - margenPt + 1e-6);
      expect(margenPt + altoOcupado).toBeLessThanOrEqual(altoPaginaPt - margenPt + 1e-6);

      // Confirma que agregar una columna/fila más ya no cabría (no quedó espacio desperdiciado).
      const anchoConUnaColumnaMas = (columnas + 1) * diametroPt + columnas * separacionPt;
      const altoConUnaFilaMas = (filas + 1) * diametroPt + filas * separacionPt;
      expect(margenPt + anchoConUnaColumnaMas).toBeGreaterThan(anchoPaginaPt - margenPt);
      expect(margenPt + altoConUnaFilaMas).toBeGreaterThan(altoPaginaPt - margenPt);
    }
  });

  it('respeta un tamaño de página distinto al de carta si se especifica', () => {
    const cuadricula = calcularCuadricula(80, { anchoPaginaPt: 1000, altoPaginaPt: 1000 });
    expect(cuadricula.columnas).toBeGreaterThanOrEqual(3);
  });
});
