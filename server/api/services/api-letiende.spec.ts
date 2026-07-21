import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { obtenerMetadatosPorIsbn } from './api-letiende';

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

  it('devuelve todos los campos en null cuando la respuesta es `{}` (no encontrado)', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: () => Promise.resolve({}) });

    const resultado = await obtenerMetadatosPorIsbn('9780000000003');

    expect(resultado).toEqual(metadatosVacios);
  });

  it('devuelve todos los campos en null ante una respuesta no-200 (ej. 500/503 intermitente de la API externa)', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 500, json: () => Promise.resolve({}) });

    const resultado = await obtenerMetadatosPorIsbn('9780000000004');

    expect(resultado).toEqual(metadatosVacios);
  });

  it('devuelve todos los campos en null ante un error de red, sin lanzar', async () => {
    fetchMock.mockRejectedValue(new Error('fetch failed'));

    const resultado = await obtenerMetadatosPorIsbn('9780000000005');

    expect(resultado).toEqual(metadatosVacios);
  });

  it('devuelve todos los campos en null si el cuerpo no es JSON válido, sin lanzar', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: () => Promise.reject(new Error('cuerpo inválido')) });

    const resultado = await obtenerMetadatosPorIsbn('9780000000006');

    expect(resultado).toEqual(metadatosVacios);
  });
});
