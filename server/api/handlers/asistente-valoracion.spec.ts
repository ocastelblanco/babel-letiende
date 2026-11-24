import { describe, expect, it, vi } from 'vitest';
import { hashDeVisitante } from '../lib/control-asistente';
import type { RegistroAsistente } from '../lib/registro-asistente';
import { valorar, type DependenciasValoracion } from './asistente-valoracion';

const ID = '20548caf-dfb6-4f4e-8670-1e8029a64625';
const SAL = 'sal-de-prueba';
const IP = '203.0.113.7';

function dependencias(registro: Partial<RegistroAsistente> | null, sal: string | null = SAL) {
  const guardarValoracion = vi.fn(async () => true);
  const leerSal = vi.fn(async () => sal);
  const deps: DependenciasValoracion = {
    leerRegistro: async () => (registro === null ? null : ({ registroId: ID, dia: '2026-11-24', visitante: hashDeVisitante(IP, SAL), ...registro } as RegistroAsistente)),
    leerSal,
    guardarValoracion,
  };
  return { deps, guardarValoracion, leerSal };
}

describe('valorar', () => {
  it('guarda la valoración si quien valora es el mismo visitante (mismo hash de IP con la sal del día del registro)', async () => {
    const { deps, guardarValoracion, leerSal } = dependencias({});
    await expect(valorar(deps, { registroId: ID, valoracion: 'positiva' }, IP)).resolves.toEqual({ estado: 200 });
    expect(guardarValoracion).toHaveBeenCalledWith(ID, 'positiva');
    expect(leerSal).toHaveBeenCalledWith('2026-11-24');
  });

  it('otra IP no puede valorar la respuesta de alguien más (403) y no se escribe nada', async () => {
    const { deps, guardarValoracion } = dependencias({});
    const r = await valorar(deps, { registroId: ID, valoracion: 'negativa' }, '198.51.100.9');
    expect(r).toMatchObject({ estado: 403 });
    expect(guardarValoracion).not.toHaveBeenCalled();
  });

  it('si la sal del día ya caducó no se puede verificar: mismo 403 y mismo mensaje', async () => {
    const { deps: caducada, guardarValoracion } = dependencias({}, null);
    const sinSal = await valorar(caducada, { registroId: ID, valoracion: 'positiva' }, IP);
    const { deps: ajena } = dependencias({});
    const otraIp = await valorar(ajena, { registroId: ID, valoracion: 'positiva' }, '198.51.100.9');
    expect(sinSal).toEqual(otraIp);
    expect(guardarValoracion).not.toHaveBeenCalled();
  });

  it('un registro que no existe responde 404, y uno que desaparece al escribir también', async () => {
    const { deps } = dependencias(null);
    expect(await valorar(deps, { registroId: ID, valoracion: 'positiva' }, IP)).toMatchObject({ estado: 404 });
    const { deps: conCarrera, guardarValoracion } = dependencias({});
    guardarValoracion.mockResolvedValueOnce(false);
    expect(await valorar(conCarrera, { registroId: ID, valoracion: 'positiva' }, IP)).toMatchObject({ estado: 404 });
  });

  it('valida el cuerpo: identificador con formato de UUID y solo «positiva» o «negativa»', async () => {
    const { deps, guardarValoracion } = dependencias({});
    for (const cuerpo of [null, [], 'x', {}, { registroId: 'no-es-uuid', valoracion: 'positiva' }, { registroId: ID }, { registroId: ID, valoracion: 'regular' }, { registroId: ID, valoracion: 5 }, { registroId: { $ne: '' }, valoracion: 'positiva' }]) {
      expect(await valorar(deps, cuerpo, IP)).toMatchObject({ estado: 400 });
    }
    expect(guardarValoracion).not.toHaveBeenCalled();
  });
});
