import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { cargarPlantilla, rellenarPlantilla, type PlantillaCargada } from './plantilla';
import type { Espacio, Mueble } from './tipos';

// SVG de prueba con viewBox de origen NO-cero (lo que produce Inkscape al
// redimensionar el lienzo) — es justo el caso que el fix de `plantilla.ts`
// protege. No usa `plantillas/estampilla.svg` real ni ninguna llamada a
// DynamoDB: es una plantilla mínima en memoria/string.
const SVG_ORIGEN_NO_CERO = `<svg xmlns="http://www.w3.org/2000/svg" width="84" height="84" viewBox="-2 -2 84 84">
  <text id="campo:nombreEspacio" x="10" y="10">placeholder</text>
  <text id="campo:nombreMueble" x="10" y="70">placeholder</text>
  <rect id="campo:qr" x="20" y="20" width="40" height="40"/>
</svg>`;

const ESPACIO: Espacio = { espacioId: 'esp-1', nombre: 'Sala Principal' };
const MUEBLE: Mueble = { muebleId: 'mue-1', espacioId: 'esp-1', nombre: 'Biblioteca 1' };

let dirTemporal: string | undefined;

afterEach(() => {
  if (dirTemporal) {
    rmSync(dirTemporal, { recursive: true, force: true });
    dirTemporal = undefined;
  }
});

describe('cargarPlantilla', () => {
  it('captura minXViewBox/minYViewBox cuando el viewBox no empieza en (0,0)', () => {
    dirTemporal = mkdtempSync(join(tmpdir(), 'qr-muebles-plantilla-test-'));
    const rutaSvg = join(dirTemporal, 'plantilla-offset.svg');
    writeFileSync(rutaSvg, SVG_ORIGEN_NO_CERO, 'utf-8');

    const plantilla = cargarPlantilla(rutaSvg);

    expect(plantilla.minXViewBox).toBe(-2);
    expect(plantilla.minYViewBox).toBe(-2);
    expect(plantilla.diametroNativoMm).toBe(84);
    expect(plantilla.qrLadoNativoMm).toBe(40);
  });
});

describe('rellenarPlantilla', () => {
  it('con viewBox de origen (0,0), escalar NO agrega un translate al transform', () => {
    const plantilla: PlantillaCargada = {
      xmlOriginal: SVG_ORIGEN_NO_CERO.replace('viewBox="-2 -2 84 84"', 'viewBox="0 0 84 84"'),
      diametroNativoMm: 84,
      qrLadoNativoMm: 40,
      minXViewBox: 0,
      minYViewBox: 0,
    };

    const svg = rellenarPlantilla(plantilla, ESPACIO, MUEBLE, '<rect width="1" height="1"/>', 60);

    expect(svg).toContain('viewBox="0 0 60 60"');
    // El grupo de escalado NO debe llevar translate cuando minX/minY ya son 0
    // (solo el <g> interno del QR trae su propio translate(x,y), que es un
    // detalle no relacionado con este fix).
    expect(svg).toMatch(/<g transform="scale\(0\.7142857142857143\)">/);
  });

  it('con viewBox de origen NO-cero, compensa el origen antes de escalar (scale luego translate en el atributo)', () => {
    const plantilla: PlantillaCargada = {
      xmlOriginal: SVG_ORIGEN_NO_CERO,
      diametroNativoMm: 84,
      qrLadoNativoMm: 40,
      minXViewBox: -2,
      minYViewBox: -2,
    };

    const svg = rellenarPlantilla(plantilla, ESPACIO, MUEBLE, '<rect width="1" height="1"/>', 60);

    // El viewBox final siempre se reconstruye en "0 0 diametro diametro".
    expect(svg).toContain('viewBox="0 0 60 60"');
    // factor = 60/84; translate(-minX, -minY) = translate(2, 2).
    expect(svg).toMatch(/transform="scale\(0\.7142857142857143\) translate\(2, 2\)"/);
    expect(svg).toContain('Sala Principal');
    expect(svg).toContain('Biblioteca 1');
  });

  it('al diámetro nativo no reescala ni reescribe el viewBox, incluso con origen NO-cero', () => {
    const plantilla: PlantillaCargada = {
      xmlOriginal: SVG_ORIGEN_NO_CERO,
      diametroNativoMm: 84,
      qrLadoNativoMm: 40,
      minXViewBox: -2,
      minYViewBox: -2,
    };

    const svg = rellenarPlantilla(plantilla, ESPACIO, MUEBLE, '<rect width="1" height="1"/>', 84);

    expect(svg).toContain('viewBox="-2 -2 84 84"');
    expect(svg).not.toContain('scale(');
  });
});
