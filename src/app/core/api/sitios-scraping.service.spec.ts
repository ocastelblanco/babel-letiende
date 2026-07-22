import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { AuthService } from '../auth/auth.service';
import type { SitioScraping } from '../models/sitio-scraping.model';
import { SitiosScrapingService } from './sitios-scraping.service';

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

const sitioFalso: SitioScraping = {
  dominio: 'www.librerialerner.com.co',
  nombre: 'Librería Lerner',
  url: 'https://www.librerialerner.com.co',
  info: true,
  pvp: true,
  prioridad: 1,
};

describe('SitiosScrapingService', () => {
  let httpMock: HttpTestingController;
  let obtenerIdTokenMock: ReturnType<typeof vi.fn>;

  function configurarPrueba(idTokenResuelto: string | null) {
    obtenerIdTokenMock = vi.fn().mockResolvedValue(idTokenResuelto);
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: AuthService, useValue: { obtenerIdToken: obtenerIdTokenMock } },
      ],
    });
    httpMock = TestBed.inject(HttpTestingController);
    return TestBed.inject(SitiosScrapingService);
  }

  afterEach(() => {
    httpMock.verify();
  });

  it('deja sitios en [] y marca error sin llamar a la API cuando no hay ID Token', async () => {
    const servicio = configurarPrueba(null);

    await servicio.cargarSitios();

    expect(servicio.sitios()).toEqual([]);
    expect(servicio.error()).toBe(true);
  });

  it('resuelve la lista y actualiza el Signal cuando /api/sitios-scraping responde 200', async () => {
    const servicio = configurarPrueba('token-valido');

    const promesa = servicio.cargarSitios();
    await Promise.resolve();
    const peticion = httpMock.expectOne('/api/sitios-scraping');
    expect(peticion.request.headers.get('Authorization')).toBe('Bearer token-valido');
    peticion.flush([sitioFalso]);
    await promesa;

    expect(servicio.sitios()).toEqual([sitioFalso]);
    expect(servicio.error()).toBe(false);
  });

  it('deja sitios en [] y marca error cuando /api/sitios-scraping falla', async () => {
    const servicio = configurarPrueba('token-valido');

    const promesa = servicio.cargarSitios();
    await Promise.resolve();
    httpMock
      .expectOne('/api/sitios-scraping')
      .flush(
        { error: 'Este correo no está autorizado para administrar sitios de scraping en Babel.' },
        { status: 403, statusText: 'Forbidden' },
      );
    await promesa;

    expect(servicio.sitios()).toEqual([]);
    expect(servicio.error()).toBe(true);
  });

  describe('crearSitio', () => {
    it('devuelve error sin llamar a la API cuando no hay ID Token', async () => {
      const servicio = configurarPrueba(null);

      const resultado = await servicio.crearSitio(sitioFalso);

      expect(resultado).toEqual({ exito: false, error: 'No se pudo crear el sitio de scraping. Intenta de nuevo.' });
    });

    it('crea el sitio y recarga la lista cuando POST /api/sitios-scraping responde 201', async () => {
      const servicio = configurarPrueba('token-valido');

      const promesa = servicio.crearSitio(sitioFalso);
      await Promise.resolve();
      const peticionPost = httpMock.expectOne('/api/sitios-scraping');
      expect(peticionPost.request.method).toBe('POST');
      expect(peticionPost.request.headers.get('Authorization')).toBe('Bearer token-valido');
      expect(peticionPost.request.body).toEqual(sitioFalso);
      peticionPost.flush(sitioFalso, { status: 201, statusText: 'Created' });

      await Promise.resolve();
      await Promise.resolve();
      const peticionGet = httpMock.expectOne('/api/sitios-scraping');
      peticionGet.flush([sitioFalso]);

      const resultado = await promesa;

      expect(resultado).toEqual({ exito: true });
      expect(servicio.sitios()).toEqual([sitioFalso]);
    });

    it('devuelve el mensaje de error del backend cuando POST /api/sitios-scraping falla', async () => {
      const servicio = configurarPrueba('token-valido');

      const promesa = servicio.crearSitio(sitioFalso);
      await Promise.resolve();
      httpMock
        .expectOne('/api/sitios-scraping')
        .flush({ error: 'Ya existe un sitio de scraping registrado con ese dominio.' }, { status: 409, statusText: 'Conflict' });

      const resultado = await promesa;

      expect(resultado).toEqual({ exito: false, error: 'Ya existe un sitio de scraping registrado con ese dominio.' });
    });
  });

  describe('actualizarSitio', () => {
    const datosActualizacion = { nombre: 'Librería Lerner', url: 'https://www.librerialerner.com.co', info: true, pvp: false, prioridad: 2 };

    it('devuelve error sin llamar a la API cuando no hay ID Token', async () => {
      const servicio = configurarPrueba(null);

      const resultado = await servicio.actualizarSitio('www.librerialerner.com.co', datosActualizacion);

      expect(resultado).toEqual({
        exito: false,
        error: 'No se pudo actualizar el sitio de scraping. Intenta de nuevo.',
      });
    });

    it('actualiza el sitio y recarga la lista cuando PUT /api/sitios-scraping/{dominio} responde 200', async () => {
      const servicio = configurarPrueba('token-valido');

      const promesa = servicio.actualizarSitio('www.librerialerner.com.co', datosActualizacion);
      await Promise.resolve();
      const peticionPut = httpMock.expectOne('/api/sitios-scraping/www.librerialerner.com.co');
      expect(peticionPut.request.method).toBe('PUT');
      expect(peticionPut.request.headers.get('Authorization')).toBe('Bearer token-valido');
      peticionPut.flush({ dominio: 'www.librerialerner.com.co', ...datosActualizacion });

      await Promise.resolve();
      await Promise.resolve();
      httpMock
        .expectOne('/api/sitios-scraping')
        .flush([{ dominio: 'www.librerialerner.com.co', ...datosActualizacion }]);

      const resultado = await promesa;

      expect(resultado).toEqual({ exito: true });
      expect(servicio.sitios()).toEqual([{ dominio: 'www.librerialerner.com.co', ...datosActualizacion }]);
    });

    it('devuelve el mensaje de error del backend cuando PUT /api/sitios-scraping/{dominio} falla', async () => {
      const servicio = configurarPrueba('token-valido');

      const promesa = servicio.actualizarSitio('no-existe.com', datosActualizacion);
      await Promise.resolve();
      httpMock
        .expectOne('/api/sitios-scraping/no-existe.com')
        .flush({ error: 'No existe un sitio de scraping con ese dominio.' }, { status: 404, statusText: 'Not Found' });

      const resultado = await promesa;

      expect(resultado).toEqual({ exito: false, error: 'No existe un sitio de scraping con ese dominio.' });
    });
  });

  describe('eliminarSitio', () => {
    it('devuelve error sin llamar a la API cuando no hay ID Token', async () => {
      const servicio = configurarPrueba(null);

      const resultado = await servicio.eliminarSitio('www.librerialerner.com.co');

      expect(resultado).toEqual({
        exito: false,
        error: 'No se pudo eliminar el sitio de scraping. Intenta de nuevo.',
      });
    });

    it('elimina el sitio y recarga la lista cuando DELETE /api/sitios-scraping/{dominio} responde 204', async () => {
      const servicio = configurarPrueba('token-valido');

      const promesa = servicio.eliminarSitio('www.librerialerner.com.co');
      await Promise.resolve();
      const peticionDelete = httpMock.expectOne('/api/sitios-scraping/www.librerialerner.com.co');
      expect(peticionDelete.request.method).toBe('DELETE');
      expect(peticionDelete.request.headers.get('Authorization')).toBe('Bearer token-valido');
      peticionDelete.flush(null, { status: 204, statusText: 'No Content' });

      await Promise.resolve();
      await Promise.resolve();
      httpMock.expectOne('/api/sitios-scraping').flush([]);

      const resultado = await promesa;

      expect(resultado).toEqual({ exito: true });
      expect(servicio.sitios()).toEqual([]);
    });

    it('devuelve el mensaje de error del backend cuando DELETE /api/sitios-scraping/{dominio} falla', async () => {
      const servicio = configurarPrueba('token-valido');

      const promesa = servicio.eliminarSitio('no-existe.com');
      await Promise.resolve();
      httpMock
        .expectOne('/api/sitios-scraping/no-existe.com')
        .flush({ error: 'No existe un sitio de scraping con ese dominio.' }, { status: 404, statusText: 'Not Found' });

      const resultado = await promesa;

      expect(resultado).toEqual({ exito: false, error: 'No existe un sitio de scraping con ese dominio.' });
    });
  });
});
