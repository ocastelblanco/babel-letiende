import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { AuthService } from '../auth/auth.service';
import { MetadatosService } from './metadatos.service';

// `auth.service.ts` (importado arriba solo como token de DI) importa el SDK
// real de Firebase a nivel de módulo — mismo motivo de mock que en
// `estantes.service.spec.ts`.
vi.mock('firebase/app', () => ({ initializeApp: vi.fn(() => ({})) }));
vi.mock('firebase/auth', () => ({
  getAuth: vi.fn(() => ({})),
  onAuthStateChanged: vi.fn(),
  signInWithPopup: vi.fn(),
  signOut: vi.fn(),
  GoogleAuthProvider: vi.fn(),
}));

const metadatosVacios = { titulo: null, autor: null, editorial: null, portadaUrl: null, pvp: null };
const metadatosEncontrados = {
  titulo: 'Cien años de soledad',
  autor: 'Gabriel García Márquez',
  editorial: 'Sudamericana',
  portadaUrl: 'https://books.google.com/portada.jpg',
  pvp: 65_000,
};

describe('MetadatosService', () => {
  let httpMock: HttpTestingController;

  function configurarPrueba(idTokenResuelto: string | null) {
    const obtenerIdTokenMock = vi.fn().mockResolvedValue(idTokenResuelto);
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: AuthService, useValue: { obtenerIdToken: obtenerIdTokenMock } },
      ],
    });
    httpMock = TestBed.inject(HttpTestingController);
    return TestBed.inject(MetadatosService);
  }

  afterEach(() => {
    httpMock.verify();
  });

  it('devuelve todos los campos en null sin llamar a la API cuando no hay ID Token', async () => {
    const servicio = configurarPrueba(null);

    const resultado = await servicio.obtenerMetadatos('9780000000001');

    expect(resultado).toEqual(metadatosVacios);
  });

  it('resuelve los metadatos cuando /api/metadatos/:isbn responde 200', async () => {
    const servicio = configurarPrueba('token-valido');

    const promesa = servicio.obtenerMetadatos('9780000000001');
    await Promise.resolve();
    const peticion = httpMock.expectOne('/api/metadatos/9780000000001');
    expect(peticion.request.headers.get('Authorization')).toBe('Bearer token-valido');
    peticion.flush(metadatosEncontrados);

    expect(await promesa).toEqual(metadatosEncontrados);
  });

  it('devuelve todos los campos en null, sin lanzar, cuando /api/metadatos/:isbn falla', async () => {
    const servicio = configurarPrueba('token-valido');

    const promesa = servicio.obtenerMetadatos('9780000000002');
    await Promise.resolve();
    httpMock
      .expectOne('/api/metadatos/9780000000002')
      .flush({ error: 'Error interno del servidor.' }, { status: 500, statusText: 'Internal Server Error' });

    expect(await promesa).toEqual(metadatosVacios);
  });

  describe('buscarCandidatos', () => {
    const candidatos = [
      {
        titulo: 'Cien años de soledad',
        autor: 'Gabriel García Márquez',
        editorial: 'Sudamericana',
        portadaUrl: 'https://books.google.com/portada.jpg',
        isbn: '9780307474728',
      },
    ];

    it('devuelve [] sin llamar a la API cuando no hay ID Token', async () => {
      const servicio = configurarPrueba(null);

      const resultado = await servicio.buscarCandidatos('cien años de soledad', '');

      expect(resultado).toEqual([]);
    });

    it('envía titulo y autor como parámetros de query con el ID Token real', async () => {
      const servicio = configurarPrueba('token-valido');

      const promesa = servicio.buscarCandidatos('cien años de soledad', 'García Márquez');
      await Promise.resolve();
      const peticion = httpMock.expectOne(
        '/api/metadatos/buscar?titulo=cien+a%C3%B1os+de+soledad&autor=Garc%C3%ADa+M%C3%A1rquez',
      );
      expect(peticion.request.headers.get('Authorization')).toBe('Bearer token-valido');
      peticion.flush({ candidatos });

      expect(await promesa).toEqual(candidatos);
    });

    it('omite el parámetro de query vacío', async () => {
      const servicio = configurarPrueba('token-valido');

      const promesa = servicio.buscarCandidatos('cien años de soledad', '  ');
      await Promise.resolve();
      const peticion = httpMock.expectOne('/api/metadatos/buscar?titulo=cien+a%C3%B1os+de+soledad');
      peticion.flush({ candidatos: [] });

      expect(await promesa).toEqual([]);
    });

    it('devuelve [], sin lanzar, cuando /api/metadatos/buscar falla', async () => {
      const servicio = configurarPrueba('token-valido');

      const promesa = servicio.buscarCandidatos('titulo', '');
      await Promise.resolve();
      httpMock
        .expectOne('/api/metadatos/buscar?titulo=titulo')
        .flush({ error: 'Error interno del servidor.' }, { status: 500, statusText: 'Internal Server Error' });

      expect(await promesa).toEqual([]);
    });
  });
});
