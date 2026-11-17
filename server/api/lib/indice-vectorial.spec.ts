import { describe, expect, it } from 'vitest';
import {
  buscarSimilares,
  cuantizar,
  deserializarIndice,
  documentoParaIndice,
  ErrorIndiceInvalido,
  planificarReconstruccion,
  serializarIndice,
  type EntradaIndice,
  type IndiceVectorial,
} from './indice-vectorial';

const DIM = 4;

function entrada(bookId: string, extra: Partial<EntradaIndice> = {}): EntradaIndice {
  return {
    bookId,
    hash: `h-${bookId}`,
    sinSinopsis: false,
    idioma: 'es',
    clasificacionEdad: null,
    ...extra,
  };
}

function indice(
  filas: { id: string; vector: number[]; extra?: Partial<EntradaIndice> }[],
  extra: Partial<IndiceVectorial> = {},
): IndiceVectorial {
  return {
    modelo: 'modelo-a',
    dimensiones: DIM,
    creadoEn: '2026-11-17T00:00:00.000Z',
    entradas: filas.map((f) => entrada(f.id, f.extra)),
    vectores: filas.map((f) => cuantizar(f.vector)),
    ...extra,
  };
}

describe('documentoParaIndice', () => {
  it('une título, autor, categorías y sinopsis; lo que falta no entra', () => {
    const completo = documentoParaIndice(
      { bookId: 'a', titulo: ' Cien años ', autor: 'García Márquez' },
      {
        sinopsis: 'Macondo',
        categorias: ['Novela', 'Clásico'],
        idioma: 'es',
        clasificacionEdad: null,
      },
    );
    expect(completo.titulo).toBe('Cien años');
    expect(completo.texto).toBe(
      'autor: García Márquez | categorías: Novela, Clásico | sinopsis: Macondo',
    );
    expect(completo.sinSinopsis).toBe(false);
    expect(completo.idioma).toBe('es');

    const sinNada = documentoParaIndice({ bookId: 'b', titulo: 'Solo título', autor: '' }, null);
    expect(sinNada.texto).toBe('');
    expect(sinNada.sinSinopsis).toBe(true);
    expect(sinNada.idioma).toBeNull();
  });

  it('la huella cambia si cambia el título, el autor o la sinopsis, y es estable si no', () => {
    const base = { bookId: 'a', titulo: 'T', autor: 'A' };
    const conocimiento = { sinopsis: 'S', categorias: [], idioma: null, clasificacionEdad: null };
    const h = documentoParaIndice(base, conocimiento).hash;
    expect(documentoParaIndice(base, conocimiento).hash).toBe(h);
    expect(documentoParaIndice({ ...base, titulo: 'T2' }, conocimiento).hash).not.toBe(h);
    expect(documentoParaIndice({ ...base, autor: 'A2' }, conocimiento).hash).not.toBe(h);
    expect(documentoParaIndice(base, { ...conocimiento, sinopsis: 'S2' }).hash).not.toBe(h);
  });

  it('un cambio solo de idioma NO cambia la huella (no obliga a pedir otro vector)', () => {
    const base = { bookId: 'a', titulo: 'T', autor: 'A' };
    const c = { sinopsis: 'S', categorias: [], idioma: null, clasificacionEdad: null };
    expect(documentoParaIndice(base, { ...c, idioma: 'es' }).hash).toBe(
      documentoParaIndice(base, c).hash,
    );
  });

  it('recorta el texto a un tope', () => {
    const doc = documentoParaIndice(
      { bookId: 'a', titulo: 'T', autor: 'A' },
      { sinopsis: 'x'.repeat(20_000), categorias: [], idioma: null, clasificacionEdad: null },
    );
    expect(doc.texto.length).toBeLessThanOrEqual(6000);
  });
});

describe('cuantizar y buscarSimilares', () => {
  it('cuantiza a int8 normalizando', () => {
    const q = cuantizar([3, 4, 0, 0]);
    expect(Array.from(q)).toEqual([76, 102, 0, 0]);
  });

  it('ordena por parecido, aplica k y es determinista en empates', () => {
    const idx = indice([
      { id: 'b', vector: [1, 0, 0, 0] },
      { id: 'a', vector: [1, 0, 0, 0] },
      { id: 'c', vector: [0, 1, 0, 0] },
      { id: 'd', vector: [-1, 0, 0, 0] },
    ]);
    const r = buscarSimilares(idx, [1, 0, 0, 0], { k: 3 });
    expect(r.map((x) => x.bookId)).toEqual(['a', 'b', 'c']);
    expect(r[0].puntaje).toBeCloseTo(1, 1);
    expect(r[2].puntaje).toBeCloseTo(0, 1);
  });

  it('el filtro se aplica antes de puntuar', () => {
    const idx = indice([
      { id: 'es', vector: [1, 0, 0, 0], extra: { idioma: 'es' } },
      { id: 'en', vector: [1, 0, 0, 0], extra: { idioma: 'en' } },
    ]);
    const r = buscarSimilares(idx, [1, 0, 0, 0], { k: 5, filtro: (e) => e.idioma === 'en' });
    expect(r.map((x) => x.bookId)).toEqual(['en']);
  });

  it('rechaza una consulta de otra dimensión', () => {
    expect(() => buscarSimilares(indice([]), [1, 2], { k: 1 })).toThrow(ErrorIndiceInvalido);
  });
});

describe('serializar y deserializar', () => {
  it('es un viaje de ida y vuelta sin pérdida', () => {
    const original = indice([
      { id: 'a', vector: [1, 2, 3, 4], extra: { sinSinopsis: true, idioma: null } },
      { id: 'b', vector: [-4, 3, -2, 1], extra: { clasificacionEdad: 'MATURE' } },
    ]);
    const copia = deserializarIndice(serializarIndice(original));
    expect(copia.modelo).toBe('modelo-a');
    expect(copia.dimensiones).toBe(DIM);
    expect(copia.entradas).toEqual(original.entradas);
    expect(copia.vectores.map((v) => Array.from(v))).toEqual(
      original.vectores.map((v) => Array.from(v)),
    );
  });

  it('un índice vacío también es válido', () => {
    expect(deserializarIndice(serializarIndice(indice([]))).entradas).toEqual([]);
  });

  it('el tamaño es el esperado: 768 bytes por libro más el encabezado', () => {
    const filas = Array.from({ length: 10 }, (_, i) => ({
      id: `l${i}`,
      vector: Array.from({ length: 768 }, (_, j) => (i + j) % 7),
    }));
    const grande = indice(filas, { dimensiones: 768 });
    const bytes = serializarIndice(grande);
    expect(bytes.length).toBeGreaterThanOrEqual(10 * 768);
    expect(bytes.length).toBeLessThan(10 * 768 + 5_000);
  });

  it.each([
    ['basura', Buffer.from('no es un índice')],
    ['vacío', Buffer.alloc(0)],
  ])('rechaza un archivo %s', (_, contenido) => {
    expect(() => deserializarIndice(contenido)).toThrow(ErrorIndiceInvalido);
  });

  it('rechaza un archivo truncado', () => {
    const bytes = serializarIndice(indice([{ id: 'a', vector: [1, 2, 3, 4] }]));
    expect(() => deserializarIndice(bytes.subarray(0, bytes.length - 2))).toThrow(
      /tamaño del cuerpo/,
    );
  });

  it('rechaza otra versión del formato', () => {
    const bytes = Buffer.from(serializarIndice(indice([])));
    bytes.writeUInt32LE(99, 4);
    expect(() => deserializarIndice(bytes)).toThrow(/versión/);
  });
});

describe('planificarReconstruccion', () => {
  const doc = (id: string, hash: string, extra = {}) => ({
    bookId: id,
    titulo: id,
    texto: '',
    hash,
    sinSinopsis: false,
    idioma: 'es',
    clasificacionEdad: null,
    ...extra,
  });

  it('sin índice previo, todo se pide', () => {
    const plan = planificarReconstruccion(null, [doc('a', 'h1'), doc('b', 'h2')], 'modelo-a', DIM);
    expect(plan.porIncrustar.map((d) => d.bookId)).toEqual(['a', 'b']);
    expect(plan.conservados).toEqual([]);
  });

  it('conserva lo que no cambió, repide lo cambiado y lo nuevo, y cuenta los eliminados', () => {
    const previo = indice([
      { id: 'igual', vector: [1, 0, 0, 0], extra: { hash: 'h-igual' } },
      { id: 'cambia', vector: [0, 1, 0, 0], extra: { hash: 'viejo' } },
      { id: 'sale', vector: [0, 0, 1, 0] },
    ]);
    const plan = planificarReconstruccion(
      previo,
      [doc('igual', 'h-igual'), doc('cambia', 'nuevo'), doc('entra', 'h3')],
      'modelo-a',
      DIM,
    );
    expect(plan.conservados.map((c) => c.entrada.bookId)).toEqual(['igual']);
    expect(plan.porIncrustar.map((d) => d.bookId)).toEqual(['cambia', 'entra']);
    expect([...plan.desactualizados.keys()]).toEqual(['cambia']);
    expect(plan.eliminados).toBe(1);
  });

  it('refresca los datos de filtro de un libro sin tocar su vector cuando solo cambió el idioma', () => {
    const previo = indice([{ id: 'a', vector: [1, 0, 0, 0], extra: { hash: 'h', idioma: null } }]);
    const plan = planificarReconstruccion(
      previo,
      [doc('a', 'h', { idioma: 'en' })],
      'modelo-a',
      DIM,
    );
    expect(plan.porIncrustar).toEqual([]);
    expect(plan.conservados[0].entrada.idioma).toBe('en');
    expect(plan.conservados[0].vector).toBe(previo.vectores[0]);
  });

  it('si cambia el modelo o las dimensiones, ningún vector viejo sirve', () => {
    const previo = indice([{ id: 'a', vector: [1, 0, 0, 0], extra: { hash: 'h' } }]);
    expect(
      planificarReconstruccion(previo, [doc('a', 'h')], 'modelo-b', DIM).porIncrustar,
    ).toHaveLength(1);
    expect(
      planificarReconstruccion(previo, [doc('a', 'h')], 'modelo-a', 8).porIncrustar,
    ).toHaveLength(1);
  });
});
