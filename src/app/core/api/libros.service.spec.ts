import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { AuthService } from '../auth/auth.service';
import type { Libro, LibroConUbicacion } from '../models/libro.model';
import { LibrosService } from './libros.service';

// `auth.service.ts` (importado arriba solo como token de DI, requerido por
// `editarLibro`/`eliminarLibro`/`cargarInventario`) importa el SDK real de
// Firebase a nivel de módulo — mismo mock que en `usuarios.service.spec.ts`.
vi.mock('firebase/app', () => ({ initializeApp: vi.fn(() => ({})) }));
vi.mock('firebase/auth', () => ({
  getAuth: vi.fn(() => ({})),
  onAuthStateChanged: vi.fn(),
  signInWithPopup: vi.fn(),
  signOut: vi.fn(),
  GoogleAuthProvider: vi.fn(),
}));

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
  ubicacionId: 'ubicacion-1',
  creadoPor: 'vendedor@letiende.co',
  creadoEn: '2026-07-19T00:00:00.000Z',
  actualizadoEn: '2026-07-19T00:00:00.000Z',
};

describe('LibrosService', () => {
  let httpMock: HttpTestingController;

  function configurarPrueba(idTokenResuelto: string | null = null) {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: AuthService, useValue: { obtenerIdToken: () => Promise.resolve(idTokenResuelto) } },
      ],
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
    const libroConUbicacionFalso: LibroConUbicacion = {
      ...libroFalso,
      ubicacion: { espacio: 'Sala principal', mueble: 'Biblioteca 1', ubicacion: 'Estante 2' },
    };

    it('resuelve el libro cuando /api/libros/:bookId responde 200', async () => {
      const servicio = configurarPrueba();

      const promesa = servicio.obtenerDetalle('book-1');
      httpMock.expectOne('/api/libros/book-1').flush(libroConUbicacionFalso);

      expect(await promesa).toEqual(libroConUbicacionFalso);
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

  describe('cargarInventario', () => {
    it('deja inventario en [] y marca errorInventario cuando no hay sesión', async () => {
      const servicio = configurarPrueba(null);

      await servicio.cargarInventario();

      expect(servicio.inventario()).toEqual([]);
      expect(servicio.errorInventario()).toBe(true);
    });

    it('resuelve el listado completo (incluidos agotados) con el ID Token real', async () => {
      const servicio = configurarPrueba('token-falso');
      const libroAgotado: Libro = { ...libroFalso, bookId: 'book-2', cantidadDisponible: 0 };

      const promesa = servicio.cargarInventario();
      // Deja correr el microtask del `await` interno a `obtenerIdToken()`
      // (mockeado) antes de esperar que la petición HTTP ya se haya emitido
      // — mismo motivo que `usuarios.service.spec.ts`.
      await Promise.resolve();
      const peticion = httpMock.expectOne('/api/libros/inventario');
      expect(peticion.request.headers.get('Authorization')).toBe('Bearer token-falso');
      peticion.flush([libroFalso, libroAgotado]);
      await promesa;

      expect(servicio.inventario()).toEqual([libroFalso, libroAgotado]);
      expect(servicio.errorInventario()).toBe(false);
    });

    it('deja inventario en [] y marca errorInventario cuando la API falla', async () => {
      const servicio = configurarPrueba('token-falso');

      const promesa = servicio.cargarInventario();
      await Promise.resolve();
      httpMock
        .expectOne('/api/libros/inventario')
        .flush({ error: 'Error interno del servidor.' }, { status: 500, statusText: 'Internal Server Error' });
      await promesa;

      expect(servicio.inventario()).toEqual([]);
      expect(servicio.errorInventario()).toBe(true);
    });
  });

  describe('editarLibro', () => {
    it('devuelve exito: false sin llamar a la API cuando no hay sesión', async () => {
      const servicio = configurarPrueba(null);

      const resultado = await servicio.editarLibro('book-1', {
        ubicacionId: 'ubicacion-2',
        cantidadTotal: 3,
        pvp: 50000,
        porcentajeDescuentoEditorial: 35,
      });

      expect(resultado).toEqual({ exito: false, error: expect.any(String) });
    });

    it('envía PUT /api/libros/:bookId con el ID Token real y recarga el inventario tras un 200', async () => {
      const servicio = configurarPrueba('token-falso');

      const promesa = servicio.editarLibro('book-1', {
        ubicacionId: 'ubicacion-2',
        cantidadTotal: 3,
        pvp: 50000,
        porcentajeDescuentoEditorial: 35,
      });
      await Promise.resolve();
      const peticion = httpMock.expectOne('/api/libros/book-1');
      expect(peticion.request.method).toBe('PUT');
      expect(peticion.request.headers.get('Authorization')).toBe('Bearer token-falso');
      peticion.flush({ ...libroFalso, ubicacionId: 'ubicacion-2' });
      await Promise.resolve();
      await Promise.resolve();
      httpMock.expectOne('/api/libros/inventario').flush([]);

      expect(await promesa).toEqual({ exito: true });
    });

    it('devuelve el mensaje de error del backend cuando el ubicacionId no existe (400)', async () => {
      const servicio = configurarPrueba('token-falso');

      const promesa = servicio.editarLibro('book-1', {
        ubicacionId: 'no-existe',
        cantidadTotal: 3,
        pvp: 50000,
        porcentajeDescuentoEditorial: 35,
      });
      await Promise.resolve();
      httpMock
        .expectOne('/api/libros/book-1')
        .flush({ error: 'La ubicación indicada no existe.' }, { status: 400, statusText: 'Bad Request' });

      expect(await promesa).toEqual({ exito: false, error: 'La ubicación indicada no existe.' });
    });
  });

  describe('eliminarLibro', () => {
    it('devuelve exito: false sin llamar a la API cuando no hay sesión', async () => {
      const servicio = configurarPrueba(null);

      const resultado = await servicio.eliminarLibro('book-1');

      expect(resultado).toEqual({ exito: false, error: expect.any(String) });
    });

    it('envía DELETE /api/libros/:bookId con el ID Token real y recarga el inventario tras un 204', async () => {
      const servicio = configurarPrueba('token-falso');

      const promesa = servicio.eliminarLibro('book-1');
      await Promise.resolve();
      const peticion = httpMock.expectOne('/api/libros/book-1');
      expect(peticion.request.method).toBe('DELETE');
      expect(peticion.request.headers.get('Authorization')).toBe('Bearer token-falso');
      peticion.flush(null, { status: 204, statusText: 'No Content' });
      await Promise.resolve();
      await Promise.resolve();
      httpMock.expectOne('/api/libros/inventario').flush([]);

      expect(await promesa).toEqual({ exito: true });
    });

    it('devuelve el mensaje de error del backend cuando el rol no es administrador (403)', async () => {
      const servicio = configurarPrueba('token-falso');

      const promesa = servicio.eliminarLibro('book-1');
      await Promise.resolve();
      httpMock
        .expectOne('/api/libros/book-1')
        .flush(
          { error: 'Este correo no está autorizado para eliminar libros en Babel.' },
          { status: 403, statusText: 'Forbidden' },
        );

      expect(await promesa).toEqual({
        exito: false,
        error: 'Este correo no está autorizado para eliminar libros en Babel.',
      });
    });
  });
});
