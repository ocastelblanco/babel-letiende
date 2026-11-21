import { describe, expect, it } from 'vitest';
import {
  LIMITES_POR_DEFECTO,
  TARIFA_USD_POR_MILLON,
  costoEnMicroUsd,
  diaDeBogota,
  evaluarEntrada,
  hashDeVisitante,
  limitesDelEntorno,
  registrarGasto,
  type AlmacenControl,
} from './control-asistente';

/** Almacén en memoria con las mismas reglas que DynamoDB (tope atómico, crear si no existe). */
function almacenFalso(inicial: Record<string, Record<string, unknown>> = {}) {
  const items = new Map<string, Record<string, unknown>>(Object.entries(inicial));
  const almacen: AlmacenControl = {
    leer: async (clave) => items.get(clave) ?? null,
    crearSiNoExiste: async (item) => {
      const clave = item['clave'] as string;
      if (items.has(clave)) return false;
      items.set(clave, item);
      return true;
    },
    sumar: async (clave, atributo, cantidad, opciones) => {
      const item = items.get(clave) ?? { clave };
      const actual = (item[atributo] as number | undefined) ?? 0;
      if (opciones?.tope !== undefined && item[atributo] !== undefined && actual >= opciones.tope) return { exito: false };
      items.set(clave, { ...item, [atributo]: actual + cantidad, expiraEn: item['expiraEn'] ?? opciones?.expiraEn });
      return { exito: true };
    },
  };
  return { almacen, items };
}

const AHORA = Date.parse('2026-11-21T20:00:00.000Z'); // 15:00 en Bogotá
const LIMITES = { topeDiarioMicroUsd: 1_000_000, mensajesPorVisitanteDia: 3 };

describe('costoEnMicroUsd', () => {
  it('usa la tarifa verificada: entrada 0,30, salida 2,50 y embeddings 0,20 USD por millón', () => {
    expect(TARIFA_USD_POR_MILLON).toEqual({ entrada: 0.3, salida: 2.5, embeddings: 0.2 });
    // 1 millón de cada uno = 0,30 + 2,50 + 0,20 = 3,00 USD
    expect(costoEnMicroUsd({ tokensEntradaGeneracion: 1_000_000, tokensSalida: 1_000_000, tokensEmbeddings: 1_000_000 })).toBe(3_000_000);
  });

  it('una respuesta típica cuesta fracciones de centavo, y redondea hacia arriba', () => {
    // 4.000 de entrada + 300 de salida + 20 de embeddings = 1.200 + 750 + 4 = 1.954 µUSD ≈ 0,002 USD
    expect(costoEnMicroUsd({ tokensEntradaGeneracion: 4000, tokensSalida: 300, tokensEmbeddings: 20 })).toBe(1954);
    expect(costoEnMicroUsd({ tokensEntradaGeneracion: 1, tokensSalida: 0, tokensEmbeddings: 0 })).toBe(1);
    expect(costoEnMicroUsd({ tokensEntradaGeneracion: 0, tokensSalida: 0, tokensEmbeddings: 0 })).toBe(0);
  });
});

describe('limitesDelEntorno', () => {
  it('convierte USD a micro-USD y lee los mensajes por visitante', () => {
    expect(limitesDelEntorno({ ASISTENTE_TOPE_DIARIO_USD: '3', ASISTENTE_MENSAJES_POR_VISITANTE: '20' })).toEqual({
      topeDiarioMicroUsd: 3_000_000,
      mensajesPorVisitanteDia: 20,
    });
  });

  it.each([[undefined], [''], ['abc'], ['0'], ['-5']])('un valor ausente o inválido (%s) cae al más estricto', (valor) => {
    expect(limitesDelEntorno({ ASISTENTE_TOPE_DIARIO_USD: valor, ASISTENTE_MENSAJES_POR_VISITANTE: valor })).toEqual(LIMITES_POR_DEFECTO);
  });
});

describe('diaDeBogota', () => {
  it('cuenta el día en hora de Bogotá (UTC-5), no en UTC', () => {
    expect(diaDeBogota(Date.parse('2026-11-21T04:59:00.000Z'))).toBe('2026-11-20');
    expect(diaDeBogota(Date.parse('2026-11-21T05:00:00.000Z'))).toBe('2026-11-21');
  });
});

describe('hashDeVisitante', () => {
  it('es estable con la misma sal, cambia con otra sal y no contiene la IP', () => {
    const a = hashDeVisitante('203.0.113.7', 'sal1');
    expect(hashDeVisitante('203.0.113.7', 'sal1')).toBe(a);
    expect(hashDeVisitante('203.0.113.7', 'sal2')).not.toBe(a);
    expect(hashDeVisitante('203.0.113.8', 'sal1')).not.toBe(a);
    expect(a).toMatch(/^[0-9a-f]{32}$/);
    expect(a).not.toContain('203');
  });
});

describe('evaluarEntrada', () => {
  const entrar = (almacen: AlmacenControl, ip = '203.0.113.7', ahoraMs = AHORA) => evaluarEntrada(almacen, { ip, ahoraMs, limites: LIMITES });

  it('permite la primera petición y crea la sal del día y el contador del visitante, ambos con TTL', async () => {
    const { almacen, items } = almacenFalso();
    const veredicto = await entrar(almacen);
    expect(veredicto).toMatchObject({ permitido: true, dia: '2026-11-21' });
    expect(items.get('sal#2026-11-21')).toMatchObject({ sal: expect.stringMatching(/^[0-9a-f]{32}$/), expiraEn: expect.any(Number) });
    const claves = [...items.keys()].filter((k) => k.startsWith('visitante#2026-11-21#'));
    expect(claves).toHaveLength(1);
    expect(claves[0]).not.toContain('203.0.113.7');
    expect(items.get(claves[0])).toMatchObject({ mensajes: 1, expiraEn: Math.floor(AHORA / 1000) + 3 * 86_400 });
  });

  it('el mismo visitante se cuenta junto; al pasar el tope se le niega', async () => {
    const { almacen } = almacenFalso();
    for (let i = 0; i < 3; i += 1) expect((await entrar(almacen)).permitido).toBe(true);
    expect(await entrar(almacen)).toEqual({ permitido: false, motivo: 'tope-visitante' });
  });

  it('otro visitante tiene su propio contador', async () => {
    const { almacen } = almacenFalso();
    for (let i = 0; i < 3; i += 1) await entrar(almacen, '203.0.113.7');
    expect((await entrar(almacen, '198.51.100.9')).permitido).toBe(true);
  });

  it('al día siguiente el contador empieza de cero y la sal cambia', async () => {
    const { almacen, items } = almacenFalso();
    for (let i = 0; i < 3; i += 1) await entrar(almacen);
    const manana = AHORA + 24 * 3600_000;
    expect((await entrar(almacen, '203.0.113.7', manana)).permitido).toBe(true);
    expect(items.has('sal#2026-11-22')).toBe(true);
  });

  it('con el interruptor apagado no deja pasar ni cuenta', async () => {
    const { almacen, items } = almacenFalso({ interruptor: { clave: 'interruptor', activo: false } });
    expect(await entrar(almacen)).toEqual({ permitido: false, motivo: 'apagado' });
    expect([...items.keys()].some((k) => k.startsWith('visitante#'))).toBe(false);
  });

  it('un interruptor encendido o ausente deja pasar', async () => {
    expect((await entrar(almacenFalso({ interruptor: { clave: 'interruptor', activo: true } }).almacen)).permitido).toBe(true);
  });

  it('con el gasto del día en el tope, se niega (y no cuenta el mensaje del visitante)', async () => {
    const { almacen, items } = almacenFalso({ 'gasto#2026-11-21': { clave: 'gasto#2026-11-21', microUsd: 1_000_000 } });
    expect(await entrar(almacen)).toEqual({ permitido: false, motivo: 'tope-diario' });
    expect([...items.keys()].some((k) => k.startsWith('visitante#'))).toBe(false);
  });

  it('el gasto de otro día no cuenta', async () => {
    const { almacen } = almacenFalso({ 'gasto#2026-11-20': { clave: 'gasto#2026-11-20', microUsd: 9_999_999 } });
    expect((await entrar(almacen)).permitido).toBe(true);
  });

  it('si dos peticiones crean la sal a la vez, ambas usan la misma', async () => {
    const { almacen, items } = almacenFalso();
    let leidas = 0;
    const carrera: AlmacenControl = {
      ...almacen,
      leer: async (clave) => {
        if (clave === 'sal#2026-11-21' && leidas++ === 0) {
          // La otra petición gana justo después de esta primera lectura.
          items.set(clave, { clave, sal: 'sal-ganadora' });
          return null;
        }
        return almacen.leer(clave);
      },
    };
    const veredicto = await entrar(carrera);
    expect(veredicto).toMatchObject({ permitido: true, visitante: hashDeVisitante('203.0.113.7', 'sal-ganadora') });
  });

  it('un fallo de la tabla se propaga: sin poder verificar el tope, no se atiende', async () => {
    const { almacen } = almacenFalso();
    const rota: AlmacenControl = { ...almacen, leer: async () => { throw new Error('DynamoDB caído'); } };
    await expect(entrar(rota)).rejects.toThrow('DynamoDB caído');
  });
});

describe('registrarGasto', () => {
  it('suma al gasto del día con TTL', async () => {
    const { almacen, items } = almacenFalso();
    await registrarGasto(almacen, '2026-11-21', 1954, AHORA);
    await registrarGasto(almacen, '2026-11-21', 46, AHORA);
    expect(items.get('gasto#2026-11-21')).toMatchObject({ microUsd: 2000, expiraEn: Math.floor(AHORA / 1000) + 3 * 86_400 });
  });

  it('un costo de cero no escribe nada', async () => {
    const { almacen, items } = almacenFalso();
    await registrarGasto(almacen, '2026-11-21', 0, AHORA);
    expect(items.size).toBe(0);
  });
});
