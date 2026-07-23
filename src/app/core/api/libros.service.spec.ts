import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import type { Libro, LibroConEstante } from '../models/libro.model';
import { LibrosService } from './libros.service';

const libroFalso: Libro = {
  isbn: '9780000000000',
  bookId: 'book-1',
  titulo: 'Cien años de soledad',
  autor: 'Gabriel García Márquez',
  editorial: 'Sudamericana',
  portadaUrl: null,
  pvp: 45000,
  porcentajeDescuentoEditorial: 35,
  costo: 29250,
  utilidadCatalogo: 15750,
  cantidadTotal: 2,
  cantidadDisponible: 1,
  estanteId: 'estante-1',
  creadoPor: 'vendedor@letiende.co',
  creadoEn: '2026-07-19T00:00:00.000Z',
  actualizadoEn: '2026-07-19T00:00:00.000Z',
};

describe('LibrosService', () => {
  let httpMock: HttpTestingController;

  function configurarPrueba() {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    httpMock = TestBed.inject(HttpTestingController);
    return TestBed.inject(LibrosService);
  }

  afterEach(() => {
    httpMock.verify();
  });

  it('resuelve la lista y actualiza el Signal cuando /api/libros responde 200', async () => {
    const servicio = configurarPrueba();

    const promesa = servicio.cargarCatalogo();
    httpMock.expectOne('/api/libros').flush([libroFalso]);
    await promesa;

    expect(servicio.libros()).toEqual([libroFalso]);
    expect(servicio.error()).toBe(false);
    expect(servicio.cargando()).toBe(false);
  });

  it('deja libros en [] y marca error cuando /api/libros falla', async () => {
    const servicio = configurarPrueba();

    const promesa = servicio.cargarCatalogo();
    httpMock
      .expectOne('/api/libros')
      .flush({ error: 'Error interno del servidor.' }, { status: 500, statusText: 'Internal Server Error' });
    await promesa;

    expect(servicio.libros()).toEqual([]);
    expect(servicio.error()).toBe(true);
    expect(servicio.cargando()).toBe(false);
  });

  describe('obtenerDetalle', () => {
    const libroConEstanteFalso: LibroConEstante = {
      ...libroFalso,
      estante: { espacio: 'Sala principal', mueble: 'Biblioteca 1', ubicacion: 'Estante 2' },
    };

    it('resuelve el libro cuando /api/libros/:bookId responde 200', async () => {
      const servicio = configurarPrueba();

      const promesa = servicio.obtenerDetalle('book-1');
      httpMock.expectOne('/api/libros/book-1').flush(libroConEstanteFalso);

      expect(await promesa).toEqual(libroConEstanteFalso);
    });

    it('devuelve null, sin lanzar, cuando /api/libros/:bookId responde 404', async () => {
      const servicio = configurarPrueba();

      const promesa = servicio.obtenerDetalle('no-existe');
      httpMock
        .expectOne('/api/libros/no-existe')
        .flush({ error: 'El libro no existe.' }, { status: 404, statusText: 'Not Found' });

      expect(await promesa).toBeNull();
    });

    it('devuelve null, sin lanzar, cuando /api/libros/:bookId falla', async () => {
      const servicio = configurarPrueba();

      const promesa = servicio.obtenerDetalle('book-1');
      httpMock
        .expectOne('/api/libros/book-1')
        .flush({ error: 'Error interno del servidor.' }, { status: 500, statusText: 'Internal Server Error' });

      expect(await promesa).toBeNull();
    });
  });
});
