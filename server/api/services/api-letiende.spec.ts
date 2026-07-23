import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buscarLibrosPorTexto, obtenerMetadatosPorIsbn } from './api-letiende';

const metadatosVacios = { titulo: null, autor: null, editorial: null, portadaUrl: null };

function respuestaGoogleBooks(volumeInfo: Record<string, unknown>) {
  return { items: [{ volumeInfo }] };
}

describe('obtenerMetadatosPorIsbn', () => {
  const fetchOriginal = global.fetch;
  const fetchMock = vi.fn();

  beforeEach(() => {
    process.env['API_LETIENDE_BASE_URL'] = 'https://api.letiende.co';
    global.fetch = fetchMock as unknown as typeof fetch;
  });

  afterEach(() => {
    vi.clearAllMocks();
    global.fetch = fetchOriginal;
  });

  it('mapea title/authors/publisher/imageLinks.thumbnail cuando `items` viene con datos', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve(
          respuestaGoogleBooks({
            title: 'Cien años de soledad',
            authors: ['Gabriel García Márquez'],
            publisher: 'Sudamericana',
            imageLinks: { thumbnail: 'http://books.google.com/portada.jpg' },
          }),
        ),
    });

    const resultado = await obtenerMetadatosPorIsbn('9780000000001');

    expect(resultado).toEqual({
      titulo: 'Cien años de soledad',
      autor: 'Gabriel García Márquez',
      editorial: 'Sudamericana',
      // http:// se reescribe a https:// — mismo recurso en ambos esquemas.
      portadaUrl: 'https://books.google.com/portada.jpg',
    });
    expect(fetchMock).toHaveBeenCalledWith('https://api.letiende.co/libros?barcode=9780000000001');
  });

  it('une varios autores con ", "', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve(
          respuestaGoogleBooks({
            title: 'Libro a cuatro manos',
            authors: ['Autor Uno', 'Autor Dos'],
          }),
        ),
    });

    const resultado = await obtenerMetadatosPorIsbn('9780000000002');

    expect(resultado.autor).toBe('Autor Uno, Autor Dos');
  });

  it('reintenta una vez ante una respuesta no-200 y devuelve los datos del segundo intento si tiene éxito', async () => {
    vi.useFakeTimers();
    try {
      fetchMock
        .mockResolvedValueOnce({ ok: false, status: 503, json: () => Promise.resolve({}) })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve(respuestaGoogleBooks({ title: 'Recuperado en el reintento' })),
        });

      const promesa = obtenerMetadatosPorIsbn('9780000000004');
      await vi.advanceTimersByTimeAsync(800);
      const resultado = await promesa;

      expect(resultado.titulo).toBe('Recuperado en el reintento');
      expect(fetchMock).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('devuelve todos los campos en null si ambos intentos responden no-200 (ej. 500/503 intermitente de la API externa), sin un tercer intento', async () => {
    vi.useFakeTimers();
    try {
      fetchMock.mockResolvedValue({ ok: false, status: 500, json: () => Promise.resolve({}) });

      const promesa = obtenerMetadatosPorIsbn('9780000000004');
      await vi.advanceTimersByTimeAsync(800);
      const resultado = await promesa;

      expect(resultado).toEqual(metadatosVacios);
      expect(fetchMock).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('devuelve todos los campos en null si ambos intentos fallan por error de red, sin lanzar', async () => {
    vi.useFakeTimers();
    try {
      fetchMock.mockRejectedValue(new Error('fetch failed'));

      const promesa = obtenerMetadatosPorIsbn('9780000000005');
      await vi.advanceTimersByTimeAsync(800);
      const resultado = await promesa;

      expect(resultado).toEqual(metadatosVacios);
      expect(fetchMock).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('no reintenta cuando la respuesta es `200` sin `items` (no encontrado legítimo)', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: () => Promise.resolve({}) });

    const resultado = await obtenerMetadatosPorIsbn('9780000000003');

    expect(resultado).toEqual(metadatosVacios);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('devuelve todos los campos en null si el cuerpo no es JSON válido, sin lanzar ni reintentar', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: () => Promise.reject(new Error('cuerpo inválido')) });

    const resultado = await obtenerMetadatosPorIsbn('9780000000006');

    expect(resultado).toEqual(metadatosVacios);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe('buscarLibrosPorTexto', () => {
  const fetchOriginal = global.fetch;
  const fetchMock = vi.fn();

  beforeEach(() => {
    process.env['API_LETIENDE_BASE_URL'] = 'https://api.letiende.co';
    global.fetch = fetchMock as unknown as typeof fetch;
  });

  afterEach(() => {
    vi.clearAllMocks();
    global.fetch = fetchOriginal;
  });

  it('construye la URL con titulo y autor cuando ambos vienen', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: () => Promise.resolve(null) });

    await buscarLibrosPorTexto('Cien años de soledad', 'García Márquez');

    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.letiende.co/libros?titulo=Cien+a%C3%B1os+de+soledad&autor=Garc%C3%ADa+M%C3%A1rquez',
    );
  });

  it('construye la URL solo con el parámetro que venga no vacío', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: () => Promise.resolve(null) });

    await buscarLibrosPorTexto(null, 'Houellebecq');

    expect(fetchMock).toHaveBeenCalledWith('https://api.letiende.co/libros?autor=Houellebecq');
  });

  it('devuelve [] sin llamar a la red cuando titulo y autor vienen vacíos/null', async () => {
    const resultado = await buscarLibrosPorTexto('   ', null);
    expect(resultado).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('mapea múltiples candidatos desde `items`, extrayendo el isbn solo cuando trae industryIdentifiers ISBN_13', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          items: [
            {
              volumeInfo: {
                title: 'Cien años de soledad',
                authors: ['Gabriel García Márquez'],
                publisher: 'Sudamericana',
                imageLinks: { thumbnail: 'http://books.google.com/portada1.jpg' },
                industryIdentifiers: [{ type: 'ISBN_10', identifier: '030788' }, { type: 'ISBN_13', identifier: '9780307474728' }],
              },
            },
            {
              // Sin industryIdentifiers — mayoría de los resultados reales de búsqueda por texto.
              volumeInfo: { title: 'Otro libro sin ISBN', authors: ['Autor Dos'] },
            },
          ],
        }),
    });

    const resultado = await buscarLibrosPorTexto('cien años de soledad', null);

    expect(resultado).toEqual([
      {
        titulo: 'Cien años de soledad',
        autor: 'Gabriel García Márquez',
        editorial: 'Sudamericana',
        portadaUrl: 'https://books.google.com/portada1.jpg',
        isbn: '9780307474728',
      },
      {
        titulo: 'Otro libro sin ISBN',
        autor: 'Autor Dos',
        editorial: null,
        portadaUrl: null,
        isbn: null,
      },
    ]);
  });

  it('trata el cuerpo `null` (sin resultados/parámetros no reconocidos) como lista vacía', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: () => Promise.resolve(null) });

    const resultado = await buscarLibrosPorTexto('libro inexistente', null);

    expect(resultado).toEqual([]);
  });

  it('ignora items sin volumeInfo.title (candidato incompleto)', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ items: [{ volumeInfo: { authors: ['Sin título'] } }] }),
    });

    const resultado = await buscarLibrosPorTexto('algo', null);

    expect(resultado).toEqual([]);
  });

  it('reintenta una vez ante una respuesta no-200 y devuelve los candidatos del segundo intento si tiene éxito', async () => {
    vi.useFakeTimers();
    try {
      fetchMock
        .mockResolvedValueOnce({ ok: false, status: 503, json: () => Promise.resolve(null) })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ items: [{ volumeInfo: { title: 'Recuperado en el reintento' } }] }),
        });

      const promesa = buscarLibrosPorTexto('titulo', null);
      await vi.advanceTimersByTimeAsync(800);
      const resultado = await promesa;

      expect(resultado).toEqual([{ titulo: 'Recuperado en el reintento', autor: null, editorial: null, portadaUrl: null, isbn: null }]);
      expect(fetchMock).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('devuelve [] si ambos intentos responden no-200, sin un tercer intento', async () => {
    vi.useFakeTimers();
    try {
      fetchMock.mockResolvedValue({ ok: false, status: 500, json: () => Promise.resolve(null) });

      const promesa = buscarLibrosPorTexto('titulo', null);
      await vi.advanceTimersByTimeAsync(800);
      const resultado = await promesa;

      expect(resultado).toEqual([]);
      expect(fetchMock).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('devuelve [] si el cuerpo no es JSON válido, sin lanzar', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: () => Promise.reject(new Error('cuerpo inválido')) });

    const resultado = await buscarLibrosPorTexto('titulo', null);

    expect(resultado).toEqual([]);
  });
});
