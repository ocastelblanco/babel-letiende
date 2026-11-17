import { describe, expect, it, vi } from 'vitest';
import type { AlmacenIndice } from '../lib/almacen-indice';
import { deserializarIndice, documentoParaIndice } from '../lib/indice-vectorial';
import { ErrorProveedorLlm, type ProveedorLlm } from '../lib/proveedor-llm';
import { reconstruirIndice, type DependenciasReconstruccion } from './indice-asistente';

const DIM = 4;

function proveedorFalso(sobreescribir: Partial<ProveedorLlm> = {}): ProveedorLlm {
  return {
    nombre: 'falso',
    modeloEmbeddings: 'modelo-a',
    modeloTexto: 'texto',
    incrustarDocumentos: vi.fn(async (documentos) => ({
      vectores: documentos.map((_, i) => [1, i, 0, 0]),
      tokensEntrada: documentos.length * 10,
    })),
    incrustarConsulta: vi.fn(),
    generarJson: vi.fn(),
    ...sobreescribir,
  } as ProveedorLlm;
}

function almacenEnMemoria(
  inicial: Buffer | null = null,
): AlmacenIndice & { contenido: Buffer | null; escrituras: number } {
  const estado = { contenido: inicial, escrituras: 0 };
  return Object.assign(estado, {
    leer: async () =>
      estado.contenido ? { contenido: estado.contenido, version: `v${estado.escrituras}` } : null,
    escribir: async (contenido: Buffer) => {
      estado.contenido = contenido;
      estado.escrituras += 1;
      return 'ok' as const;
    },
  });
}

function dependencias(extra: Partial<DependenciasReconstruccion> = {}): DependenciasReconstruccion {
  return {
    proveedor: proveedorFalso(),
    almacen: almacenEnMemoria(),
    leerLibros: async () => [
      { bookId: 'a', titulo: 'Uno', autor: 'X' },
      { bookId: 'b', titulo: 'Dos', autor: 'Y' },
    ],
    leerConocimiento: async () => [
      {
        bookId: 'a',
        sinopsis: 'Una sinopsis',
        categorias: ['Novela'],
        idioma: 'es',
        clasificacionEdad: null,
      },
    ],
    dimensiones: DIM,
    esperar: async () => undefined,
    ...extra,
  };
}

describe('reconstruirIndice', () => {
  it('primera corrida: indexa todo, marca los libros sin sinopsis y escribe el archivo', async () => {
    const almacen = almacenEnMemoria();
    const resumen = await reconstruirIndice(dependencias({ almacen }));

    expect(resumen).toMatchObject({
      totalLibros: 2,
      indexados: 2,
      nuevos: 2,
      actualizados: 0,
      conservados: 0,
      sinSinopsis: 1,
      pendientes: 0,
      escrito: true,
      motivoParada: 'completa',
      tokensEntrada: 20,
    });
    const indice = deserializarIndice(almacen.contenido as Buffer);
    expect(indice.entradas.map((e) => [e.bookId, e.sinSinopsis, e.idioma])).toEqual([
      ['a', false, 'es'],
      ['b', true, null],
    ]);
    expect(indice.modelo).toBe('modelo-a');
  });

  it('el archivo no contiene el texto de ninguna sinopsis', async () => {
    const almacen = almacenEnMemoria();
    await reconstruirIndice(dependencias({ almacen }));
    expect((almacen.contenido as Buffer).toString('utf8')).not.toContain('Una sinopsis');
  });

  it('segunda corrida sin cambios: no pide vectores ni escribe', async () => {
    const almacen = almacenEnMemoria();
    await reconstruirIndice(dependencias({ almacen }));
    const proveedor = proveedorFalso();
    const resumen = await reconstruirIndice(dependencias({ almacen, proveedor }));

    expect(proveedor.incrustarDocumentos).not.toHaveBeenCalled();
    expect(resumen).toMatchObject({
      nuevos: 0,
      actualizados: 0,
      conservados: 2,
      escrito: false,
      motivoParada: 'completa',
    });
    expect(almacen.escrituras).toBe(1);
  });

  it('solo pide el vector del libro que cambió y del que llegó, y quita el que ya no existe', async () => {
    const almacen = almacenEnMemoria();
    await reconstruirIndice(dependencias({ almacen }));
    const proveedor = proveedorFalso();
    const resumen = await reconstruirIndice(
      dependencias({
        almacen,
        proveedor,
        leerLibros: async () => [
          { bookId: 'a', titulo: 'Uno (edición nueva)', autor: 'X' },
          { bookId: 'c', titulo: 'Tres', autor: 'Z' },
        ],
      }),
    );

    const enviados = (proveedor.incrustarDocumentos as ReturnType<typeof vi.fn>).mock
      .calls[0][0] as { titulo: string }[];
    expect(enviados.map((d) => d.titulo)).toEqual(['Uno (edición nueva)', 'Tres']);
    expect(resumen).toMatchObject({
      nuevos: 1,
      actualizados: 1,
      eliminados: 1,
      indexados: 2,
      escrito: true,
    });
    expect(deserializarIndice(almacen.contenido as Buffer).entradas.map((e) => e.bookId)).toEqual([
      'a',
      'c',
    ]);
  });

  it('parte en lotes de 50', async () => {
    const proveedor = proveedorFalso();
    const libros = Array.from({ length: 120 }, (_, i) => ({
      bookId: `l${String(i).padStart(3, '0')}`,
      titulo: `T${i}`,
      autor: 'A',
    }));
    const resumen = await reconstruirIndice(
      dependencias({ proveedor, leerLibros: async () => libros, leerConocimiento: async () => [] }),
    );
    expect(
      (proveedor.incrustarDocumentos as ReturnType<typeof vi.fn>).mock.calls.map(
        (c) => (c[0] as unknown[]).length,
      ),
    ).toEqual([50, 50, 20]);
    expect(resumen.indexados).toBe(120);
  });

  it('si el proveedor falla a mitad, guarda lo logrado y avisa de lo pendiente; la siguiente corrida continúa', async () => {
    const almacen = almacenEnMemoria();
    let llamadas = 0;
    const proveedor = proveedorFalso({
      incrustarDocumentos: vi.fn(async (documentos) => {
        llamadas += 1;
        if (llamadas === 2) {
          throw new ErrorProveedorLlm('cuota', 429, 'RESOURCE_EXHAUSTED', true);
        }
        return { vectores: documentos.map(() => [1, 0, 0, 0]), tokensEntrada: 5 };
      }),
    });
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const libros = Array.from({ length: 120 }, (_, i) => ({
      bookId: `l${String(i).padStart(3, '0')}`,
      titulo: `T${i}`,
      autor: 'A',
    }));
    const primera = await reconstruirIndice(
      dependencias({
        almacen,
        proveedor,
        leerLibros: async () => libros,
        leerConocimiento: async () => [],
      }),
    );
    expect(primera).toMatchObject({
      indexados: 50,
      pendientes: 70,
      motivoParada: 'proveedor',
      escrito: true,
    });

    const segunda = await reconstruirIndice(
      dependencias({ almacen, leerLibros: async () => libros, leerConocimiento: async () => [] }),
    );
    expect(segunda).toMatchObject({
      indexados: 120,
      nuevos: 70,
      conservados: 50,
      pendientes: 0,
      motivoParada: 'completa',
    });
  });

  it('un libro cambiado cuyo vector nuevo falla conserva el anterior en el índice', async () => {
    const almacen = almacenEnMemoria();
    await reconstruirIndice(dependencias({ almacen }));
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const proveedor = proveedorFalso({
      incrustarDocumentos: vi
        .fn()
        .mockRejectedValue(new ErrorProveedorLlm('caído', 503, null, true)),
    });
    const resumen = await reconstruirIndice(
      dependencias({
        almacen,
        proveedor,
        leerLibros: async () => [
          { bookId: 'a', titulo: 'Uno (cambiado)', autor: 'X' },
          { bookId: 'b', titulo: 'Dos', autor: 'Y' },
        ],
      }),
    );
    expect(resumen).toMatchObject({
      indexados: 2,
      pendientes: 1,
      motivoParada: 'proveedor',
      escrito: false,
    });
    expect(deserializarIndice(almacen.contenido as Buffer).entradas.map((e) => e.bookId)).toEqual([
      'a',
      'b',
    ]);
  });

  it('se detiene al agotar el presupuesto de tiempo', async () => {
    let reloj = 0;
    const proveedor = proveedorFalso();
    const libros = Array.from({ length: 120 }, (_, i) => ({
      bookId: `l${i}`,
      titulo: `T${i}`,
      autor: 'A',
    }));
    const resumen = await reconstruirIndice(
      dependencias({
        proveedor,
        leerLibros: async () => libros,
        leerConocimiento: async () => [],
        ahora: () => reloj,
        esperar: async () => {
          reloj += 7 * 60 * 1000;
        },
      }),
    );
    expect(resumen.motivoParada).toBe('tiempo');
    expect(resumen.indexados).toBe(100);
    expect(resumen.pendientes).toBe(20);
  });

  it('un índice ilegible no impide reconstruir: se parte de cero', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const almacen = almacenEnMemoria(Buffer.from('basura'));
    const resumen = await reconstruirIndice(dependencias({ almacen }));
    expect(resumen).toMatchObject({ indexados: 2, escrito: true });
  });

  it('un conflicto de escritura no pisa nada y se reporta', async () => {
    const almacen = { leer: async () => null, escribir: async () => 'conflicto' as const };
    const resumen = await reconstruirIndice(dependencias({ almacen }));
    expect(resumen).toMatchObject({ escrito: false, conflicto: true });
  });

  it('un error que no es del proveedor se propaga', async () => {
    const proveedor = proveedorFalso({
      incrustarDocumentos: vi.fn().mockRejectedValue(new Error('bug')),
    });
    await expect(reconstruirIndice(dependencias({ proveedor }))).rejects.toThrow('bug');
  });

  it('usa la misma huella que documentoParaIndice (sin sinopsis, solo título y autor)', async () => {
    const almacen = almacenEnMemoria();
    await reconstruirIndice(dependencias({ almacen, leerConocimiento: async () => [] }));
    const entradas = deserializarIndice(almacen.contenido as Buffer).entradas;
    expect(entradas[1].hash).toBe(
      documentoParaIndice({ bookId: 'b', titulo: 'Dos', autor: 'Y' }, null).hash,
    );
  });
});
