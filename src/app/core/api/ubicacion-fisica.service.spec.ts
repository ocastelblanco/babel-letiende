import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { AuthService } from '../auth/auth.service';
import type { Espacio } from '../models/espacio.model';
import type { Mueble } from '../models/mueble.model';
import type { Ubicacion } from '../models/ubicacion.model';
import { UbicacionFisicaService } from './ubicacion-fisica.service';

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

const espacioFalso: Espacio = { espacioId: 'espacio-1', nombre: 'Espacio principal' };
const muebleFalso: Mueble = { muebleId: 'mueble-1', espacioId: 'espacio-1', nombre: 'Biblioteca 1' };
const ubicacionFalsa: Ubicacion = { ubicacionId: 'ubicacion-1', muebleId: 'mueble-1', nombre: 'Estante 1' };

describe('UbicacionFisicaService', () => {
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
    return TestBed.inject(UbicacionFisicaService);
  }

  afterEach(() => {
    httpMock.verify();
  });

  // -----------------------------------------------------------------------
  // Espacios
  // -----------------------------------------------------------------------

  describe('cargarEspacios', () => {
    it('llama GET /api/espacios SIN cabecera cuando no hay sesión (endpoint público)', async () => {
      const servicio = configurarPrueba(null);

      const promesa = servicio.cargarEspacios();
      await Promise.resolve();
      const peticion = httpMock.expectOne('/api/espacios');
      expect(peticion.request.headers.has('Authorization')).toBe(false);
      peticion.flush([espacioFalso]);
      await promesa;

      expect(servicio.espacios()).toEqual([espacioFalso]);
      expect(servicio.errorEspacios()).toBe(false);
    });

    it('llama GET /api/espacios CON cabecera cuando hay sesión', async () => {
      const servicio = configurarPrueba('token-valido');

      const promesa = servicio.cargarEspacios();
      await Promise.resolve();
      const peticion = httpMock.expectOne('/api/espacios');
      expect(peticion.request.headers.get('Authorization')).toBe('Bearer token-valido');
      peticion.flush([espacioFalso]);
      await promesa;

      expect(servicio.espacios()).toEqual([espacioFalso]);
    });

    it('deja espacios en [] y marca error cuando /api/espacios falla', async () => {
      const servicio = configurarPrueba(null);

      const promesa = servicio.cargarEspacios();
      await Promise.resolve();
      httpMock.expectOne('/api/espacios').flush({ error: 'falló' }, { status: 500, statusText: 'Server Error' });
      await promesa;

      expect(servicio.espacios()).toEqual([]);
      expect(servicio.errorEspacios()).toBe(true);
    });
  });

  describe('crearEspacio', () => {
    it('devuelve error sin llamar a la API cuando no hay ID Token', async () => {
      const servicio = configurarPrueba(null);

      const resultado = await servicio.crearEspacio({ nombre: 'Espacio nuevo' });

      expect(resultado).toEqual({ exito: false, error: 'No se pudo crear el espacio. Intenta de nuevo.' });
    });

    it('crea el espacio y recarga la lista cuando POST /api/espacios responde 201', async () => {
      const servicio = configurarPrueba('token-valido');

      const promesa = servicio.crearEspacio({ nombre: 'Espacio nuevo' });
      await Promise.resolve();
      const peticionPost = httpMock.expectOne('/api/espacios');
      expect(peticionPost.request.method).toBe('POST');
      peticionPost.flush({ espacioId: 'espacio-2', nombre: 'Espacio nuevo' }, { status: 201, statusText: 'Created' });

      await Promise.resolve();
      await Promise.resolve();
      httpMock.expectOne('/api/espacios').flush([{ espacioId: 'espacio-2', nombre: 'Espacio nuevo' }]);

      const resultado = await promesa;

      expect(resultado).toEqual({ exito: true });
      expect(servicio.espacios()).toEqual([{ espacioId: 'espacio-2', nombre: 'Espacio nuevo' }]);
    });

    it('devuelve el mensaje de error del backend cuando POST /api/espacios falla', async () => {
      const servicio = configurarPrueba('token-valido');

      const promesa = servicio.crearEspacio({ nombre: 'Espacio nuevo' });
      await Promise.resolve();
      httpMock
        .expectOne('/api/espacios')
        .flush({ error: 'Este correo no está autorizado para administrar espacios en Babel.' }, { status: 403, statusText: 'Forbidden' });

      const resultado = await promesa;

      expect(resultado).toEqual({ exito: false, error: 'Este correo no está autorizado para administrar espacios en Babel.' });
    });
  });

  describe('actualizarEspacio', () => {
    it('actualiza el espacio y recarga la lista cuando PUT /api/espacios/{espacioId} responde 200', async () => {
      const servicio = configurarPrueba('token-valido');

      const promesa = servicio.actualizarEspacio('espacio-1', { nombre: 'Renombrado' });
      await Promise.resolve();
      const peticionPut = httpMock.expectOne('/api/espacios/espacio-1');
      expect(peticionPut.request.method).toBe('PUT');
      peticionPut.flush({ espacioId: 'espacio-1', nombre: 'Renombrado' });

      await Promise.resolve();
      await Promise.resolve();
      httpMock.expectOne('/api/espacios').flush([{ espacioId: 'espacio-1', nombre: 'Renombrado' }]);

      const resultado = await promesa;

      expect(resultado).toEqual({ exito: true });
    });

    it('devuelve el mensaje de error del backend cuando PUT /api/espacios/{espacioId} falla', async () => {
      const servicio = configurarPrueba('token-valido');

      const promesa = servicio.actualizarEspacio('espacio-1', { nombre: 'Renombrado' });
      await Promise.resolve();
      httpMock.expectOne('/api/espacios/espacio-1').flush({ error: 'El espacio no existe.' }, { status: 404, statusText: 'Not Found' });

      const resultado = await promesa;

      expect(resultado).toEqual({ exito: false, error: 'El espacio no existe.' });
    });
  });

  describe('eliminarEspacio', () => {
    it('elimina el espacio y recarga la lista cuando DELETE /api/espacios/{espacioId} responde 204', async () => {
      const servicio = configurarPrueba('token-valido');

      const promesa = servicio.eliminarEspacio('espacio-1');
      await Promise.resolve();
      const peticionDelete = httpMock.expectOne('/api/espacios/espacio-1');
      expect(peticionDelete.request.method).toBe('DELETE');
      peticionDelete.flush(null, { status: 204, statusText: 'No Content' });

      await Promise.resolve();
      await Promise.resolve();
      httpMock.expectOne('/api/espacios').flush([]);

      const resultado = await promesa;

      expect(resultado).toEqual({ exito: true });
    });

    it('devuelve el mensaje de error del backend cuando DELETE falla por tener muebles asociados', async () => {
      const servicio = configurarPrueba('token-valido');

      const promesa = servicio.eliminarEspacio('espacio-1');
      await Promise.resolve();
      httpMock
        .expectOne('/api/espacios/espacio-1')
        .flush({ error: 'No se puede eliminar un espacio que tiene muebles asociados.' }, { status: 400, statusText: 'Bad Request' });

      const resultado = await promesa;

      expect(resultado).toEqual({ exito: false, error: 'No se puede eliminar un espacio que tiene muebles asociados.' });
    });
  });

  // -----------------------------------------------------------------------
  // Muebles
  // -----------------------------------------------------------------------

  describe('cargarMuebles', () => {
    it('llama GET /api/muebles SIN cabecera cuando no hay sesión (endpoint público)', async () => {
      const servicio = configurarPrueba(null);

      const promesa = servicio.cargarMuebles();
      await Promise.resolve();
      const peticion = httpMock.expectOne('/api/muebles');
      expect(peticion.request.headers.has('Authorization')).toBe(false);
      peticion.flush([muebleFalso]);
      await promesa;

      expect(servicio.muebles()).toEqual([muebleFalso]);
      expect(servicio.errorMuebles()).toBe(false);
    });

    it('deja muebles en [] y marca error cuando /api/muebles falla', async () => {
      const servicio = configurarPrueba(null);

      const promesa = servicio.cargarMuebles();
      await Promise.resolve();
      httpMock.expectOne('/api/muebles').flush({ error: 'falló' }, { status: 500, statusText: 'Server Error' });
      await promesa;

      expect(servicio.muebles()).toEqual([]);
      expect(servicio.errorMuebles()).toBe(true);
    });
  });

  describe('crearMueble', () => {
    it('devuelve error sin llamar a la API cuando no hay ID Token', async () => {
      const servicio = configurarPrueba(null);

      const resultado = await servicio.crearMueble({ nombre: 'Biblioteca 2', espacioId: 'espacio-1' });

      expect(resultado).toEqual({ exito: false, error: 'No se pudo crear el mueble. Intenta de nuevo.' });
    });

    it('crea el mueble y recarga la lista cuando POST /api/muebles responde 201', async () => {
      const servicio = configurarPrueba('token-valido');

      const promesa = servicio.crearMueble({ nombre: 'Biblioteca 2', espacioId: 'espacio-1' });
      await Promise.resolve();
      const peticionPost = httpMock.expectOne('/api/muebles');
      expect(peticionPost.request.method).toBe('POST');
      peticionPost.flush({ muebleId: 'mueble-2', nombre: 'Biblioteca 2', espacioId: 'espacio-1' }, { status: 201, statusText: 'Created' });

      await Promise.resolve();
      await Promise.resolve();
      httpMock.expectOne('/api/muebles').flush([{ muebleId: 'mueble-2', nombre: 'Biblioteca 2', espacioId: 'espacio-1' }]);

      const resultado = await promesa;

      expect(resultado).toEqual({ exito: true });
    });

    it('devuelve el mensaje de error del backend cuando POST /api/muebles falla por espacioId inexistente', async () => {
      const servicio = configurarPrueba('token-valido');

      const promesa = servicio.crearMueble({ nombre: 'Biblioteca 2', espacioId: 'no-existe' });
      await Promise.resolve();
      httpMock.expectOne('/api/muebles').flush({ error: 'El espacio indicado no existe.' }, { status: 400, statusText: 'Bad Request' });

      const resultado = await promesa;

      expect(resultado).toEqual({ exito: false, error: 'El espacio indicado no existe.' });
    });
  });

  describe('actualizarMueble', () => {
    it('actualiza el mueble y recarga la lista cuando PUT /api/muebles/{muebleId} responde 200', async () => {
      const servicio = configurarPrueba('token-valido');

      const promesa = servicio.actualizarMueble('mueble-1', { nombre: 'Renombrado', espacioId: 'espacio-2' });
      await Promise.resolve();
      const peticionPut = httpMock.expectOne('/api/muebles/mueble-1');
      expect(peticionPut.request.method).toBe('PUT');
      peticionPut.flush({ muebleId: 'mueble-1', nombre: 'Renombrado', espacioId: 'espacio-2' });

      await Promise.resolve();
      await Promise.resolve();
      httpMock.expectOne('/api/muebles').flush([{ muebleId: 'mueble-1', nombre: 'Renombrado', espacioId: 'espacio-2' }]);

      const resultado = await promesa;

      expect(resultado).toEqual({ exito: true });
    });
  });

  describe('eliminarMueble', () => {
    it('elimina el mueble y recarga la lista cuando DELETE /api/muebles/{muebleId} responde 204', async () => {
      const servicio = configurarPrueba('token-valido');

      const promesa = servicio.eliminarMueble('mueble-1');
      await Promise.resolve();
      const peticionDelete = httpMock.expectOne('/api/muebles/mueble-1');
      expect(peticionDelete.request.method).toBe('DELETE');
      peticionDelete.flush(null, { status: 204, statusText: 'No Content' });

      await Promise.resolve();
      await Promise.resolve();
      httpMock.expectOne('/api/muebles').flush([]);

      const resultado = await promesa;

      expect(resultado).toEqual({ exito: true });
    });

    it('devuelve el mensaje de error del backend cuando DELETE falla por tener ubicaciones asociadas', async () => {
      const servicio = configurarPrueba('token-valido');

      const promesa = servicio.eliminarMueble('mueble-1');
      await Promise.resolve();
      httpMock
        .expectOne('/api/muebles/mueble-1')
        .flush({ error: 'No se puede eliminar un mueble que tiene ubicaciones asociadas.' }, { status: 400, statusText: 'Bad Request' });

      const resultado = await promesa;

      expect(resultado).toEqual({ exito: false, error: 'No se puede eliminar un mueble que tiene ubicaciones asociadas.' });
    });
  });

  // -----------------------------------------------------------------------
  // Ubicaciones
  // -----------------------------------------------------------------------

  describe('cargarUbicaciones', () => {
    it('llama GET /api/ubicaciones SIN cabecera cuando no hay sesión (endpoint público)', async () => {
      const servicio = configurarPrueba(null);

      const promesa = servicio.cargarUbicaciones();
      await Promise.resolve();
      const peticion = httpMock.expectOne('/api/ubicaciones');
      expect(peticion.request.headers.has('Authorization')).toBe(false);
      peticion.flush([ubicacionFalsa]);
      await promesa;

      expect(servicio.ubicaciones()).toEqual([ubicacionFalsa]);
      expect(servicio.errorUbicaciones()).toBe(false);
    });

    it('deja ubicaciones en [] y marca error cuando /api/ubicaciones falla', async () => {
      const servicio = configurarPrueba(null);

      const promesa = servicio.cargarUbicaciones();
      await Promise.resolve();
      httpMock.expectOne('/api/ubicaciones').flush({ error: 'falló' }, { status: 500, statusText: 'Server Error' });
      await promesa;

      expect(servicio.ubicaciones()).toEqual([]);
      expect(servicio.errorUbicaciones()).toBe(true);
    });
  });

  describe('crearUbicacion', () => {
    it('devuelve error sin llamar a la API cuando no hay ID Token', async () => {
      const servicio = configurarPrueba(null);

      const resultado = await servicio.crearUbicacion({ nombre: 'Estante 2', muebleId: 'mueble-1' });

      expect(resultado).toEqual({ exito: false, error: 'No se pudo crear la ubicación. Intenta de nuevo.' });
    });

    it('crea la ubicación y recarga la lista cuando POST /api/ubicaciones responde 201', async () => {
      const servicio = configurarPrueba('token-valido');

      const promesa = servicio.crearUbicacion({ nombre: 'Estante 2', muebleId: 'mueble-1' });
      await Promise.resolve();
      const peticionPost = httpMock.expectOne('/api/ubicaciones');
      expect(peticionPost.request.method).toBe('POST');
      peticionPost.flush({ ubicacionId: 'ubicacion-2', nombre: 'Estante 2', muebleId: 'mueble-1' }, { status: 201, statusText: 'Created' });

      await Promise.resolve();
      await Promise.resolve();
      httpMock.expectOne('/api/ubicaciones').flush([{ ubicacionId: 'ubicacion-2', nombre: 'Estante 2', muebleId: 'mueble-1' }]);

      const resultado = await promesa;

      expect(resultado).toEqual({ exito: true });
    });

    it('devuelve el mensaje de error del backend cuando POST /api/ubicaciones falla por muebleId inexistente', async () => {
      const servicio = configurarPrueba('token-valido');

      const promesa = servicio.crearUbicacion({ nombre: 'Estante 2', muebleId: 'no-existe' });
      await Promise.resolve();
      httpMock.expectOne('/api/ubicaciones').flush({ error: 'El mueble indicado no existe.' }, { status: 400, statusText: 'Bad Request' });

      const resultado = await promesa;

      expect(resultado).toEqual({ exito: false, error: 'El mueble indicado no existe.' });
    });
  });

  describe('actualizarUbicacion', () => {
    it('actualiza la ubicación y recarga la lista cuando PUT /api/ubicaciones/{ubicacionId} responde 200', async () => {
      const servicio = configurarPrueba('token-valido');

      const promesa = servicio.actualizarUbicacion('ubicacion-1', { nombre: 'Renombrada', muebleId: 'mueble-2' });
      await Promise.resolve();
      const peticionPut = httpMock.expectOne('/api/ubicaciones/ubicacion-1');
      expect(peticionPut.request.method).toBe('PUT');
      peticionPut.flush({ ubicacionId: 'ubicacion-1', nombre: 'Renombrada', muebleId: 'mueble-2' });

      await Promise.resolve();
      await Promise.resolve();
      httpMock.expectOne('/api/ubicaciones').flush([{ ubicacionId: 'ubicacion-1', nombre: 'Renombrada', muebleId: 'mueble-2' }]);

      const resultado = await promesa;

      expect(resultado).toEqual({ exito: true });
    });
  });

  describe('eliminarUbicacion', () => {
    it('elimina la ubicación y recarga la lista cuando DELETE /api/ubicaciones/{ubicacionId} responde 204', async () => {
      const servicio = configurarPrueba('token-valido');

      const promesa = servicio.eliminarUbicacion('ubicacion-1');
      await Promise.resolve();
      const peticionDelete = httpMock.expectOne('/api/ubicaciones/ubicacion-1');
      expect(peticionDelete.request.method).toBe('DELETE');
      peticionDelete.flush(null, { status: 204, statusText: 'No Content' });

      await Promise.resolve();
      await Promise.resolve();
      httpMock.expectOne('/api/ubicaciones').flush([]);

      const resultado = await promesa;

      expect(resultado).toEqual({ exito: true });
    });

    it('devuelve el mensaje de error del backend cuando DELETE /api/ubicaciones/{ubicacionId} falla', async () => {
      const servicio = configurarPrueba('token-valido');

      const promesa = servicio.eliminarUbicacion('ubicacion-1');
      await Promise.resolve();
      httpMock.expectOne('/api/ubicaciones/ubicacion-1').flush({ error: 'La ubicación no existe.' }, { status: 404, statusText: 'Not Found' });

      const resultado = await promesa;

      expect(resultado).toEqual({ exito: false, error: 'La ubicación no existe.' });
    });
  });
});
