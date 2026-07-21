import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { AuthService } from '../auth/auth.service';
import type { Estante } from '../models/estante.model';
import { EstantesService } from './estantes.service';

// `auth.service.ts` (importado arriba solo como token de DI) importa el SDK
// real de Firebase a nivel de módulo — mismo motivo de mock que en
// `usuarios.service.spec.ts`.
vi.mock('firebase/app', () => ({ initializeApp: vi.fn(() => ({})) }));
vi.mock('firebase/auth', () => ({
  getAuth: vi.fn(() => ({})),
  onAuthStateChanged: vi.fn(),
  signInWithPopup: vi.fn(),
  signOut: vi.fn(),
  GoogleAuthProvider: vi.fn(),
}));

const estanteFalso: Estante = {
  estanteId: 'estante-1',
  espacio: 'Espacio principal',
  mueble: 'Biblioteca 1',
  ubicacion: 'Estante 1',
};

describe('EstantesService', () => {
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
    return TestBed.inject(EstantesService);
  }

  afterEach(() => {
    httpMock.verify();
  });

  it('deja estantes en [] y marca error sin llamar a la API cuando no hay ID Token', async () => {
    const servicio = configurarPrueba(null);

    await servicio.cargarEstantes();

    expect(servicio.estantes()).toEqual([]);
    expect(servicio.error()).toBe(true);
  });

  it('resuelve la lista y actualiza el Signal cuando /api/estantes responde 200', async () => {
    const servicio = configurarPrueba('token-valido');

    const promesa = servicio.cargarEstantes();
    // Deja correr el microtask del `await` interno a `obtenerIdToken()`
    // (mockeado) antes de esperar que la petición HTTP ya se haya emitido.
    await Promise.resolve();
    const peticion = httpMock.expectOne('/api/estantes');
    expect(peticion.request.headers.get('Authorization')).toBe('Bearer token-valido');
    peticion.flush([estanteFalso]);
    await promesa;

    expect(servicio.estantes()).toEqual([estanteFalso]);
    expect(servicio.error()).toBe(false);
  });

  it('deja estantes en [] y marca error cuando /api/estantes falla', async () => {
    const servicio = configurarPrueba('token-valido');

    const promesa = servicio.cargarEstantes();
    await Promise.resolve();
    httpMock
      .expectOne('/api/estantes')
      .flush({ error: 'Este correo no está autorizado para administrar estantes en Babel.' }, { status: 403, statusText: 'Forbidden' });
    await promesa;

    expect(servicio.estantes()).toEqual([]);
    expect(servicio.error()).toBe(true);
  });

  const datosNuevoEstante = { espacio: 'Espacio principal', mueble: 'Biblioteca 2', ubicacion: 'Estante 3' };

  describe('crearEstante', () => {
    it('devuelve error sin llamar a la API cuando no hay ID Token', async () => {
      const servicio = configurarPrueba(null);

      const resultado = await servicio.crearEstante(datosNuevoEstante);

      expect(resultado).toEqual({ exito: false, error: 'No se pudo crear el estante. Intenta de nuevo.' });
    });

    it('crea el estante y recarga la lista cuando POST /api/estantes responde 201', async () => {
      const servicio = configurarPrueba('token-valido');

      const promesa = servicio.crearEstante(datosNuevoEstante);
      await Promise.resolve();
      const peticionPost = httpMock.expectOne('/api/estantes');
      expect(peticionPost.request.method).toBe('POST');
      expect(peticionPost.request.headers.get('Authorization')).toBe('Bearer token-valido');
      expect(peticionPost.request.body).toEqual(datosNuevoEstante);
      peticionPost.flush({ estanteId: 'estante-2', ...datosNuevoEstante }, { status: 201, statusText: 'Created' });

      // Dos microtasks: una para que se resuelva `firstValueFrom(post...)`,
      // otra para que `cargarEstantes()` internamente resuelva su propio
      // `await obtenerIdToken()` antes de emitir la petición GET.
      await Promise.resolve();
      await Promise.resolve();
      const peticionGet = httpMock.expectOne('/api/estantes');
      peticionGet.flush([{ estanteId: 'estante-2', ...datosNuevoEstante }]);

      const resultado = await promesa;

      expect(resultado).toEqual({ exito: true });
      expect(servicio.estantes()).toEqual([{ estanteId: 'estante-2', ...datosNuevoEstante }]);
    });

    it('devuelve el mensaje de error del backend cuando POST /api/estantes falla', async () => {
      const servicio = configurarPrueba('token-valido');

      const promesa = servicio.crearEstante(datosNuevoEstante);
      await Promise.resolve();
      httpMock
        .expectOne('/api/estantes')
        .flush({ error: 'Este correo no está autorizado para administrar estantes en Babel.' }, { status: 403, statusText: 'Forbidden' });

      const resultado = await promesa;

      expect(resultado).toEqual({ exito: false, error: 'Este correo no está autorizado para administrar estantes en Babel.' });
    });
  });

  describe('actualizarEstante', () => {
    it('devuelve error sin llamar a la API cuando no hay ID Token', async () => {
      const servicio = configurarPrueba(null);

      const resultado = await servicio.actualizarEstante('estante-1', datosNuevoEstante);

      expect(resultado).toEqual({ exito: false, error: 'No se pudo actualizar el estante. Intenta de nuevo.' });
    });

    it('actualiza el estante y recarga la lista cuando PUT /api/estantes/{estanteId} responde 200', async () => {
      const servicio = configurarPrueba('token-valido');

      const promesa = servicio.actualizarEstante('estante-1', datosNuevoEstante);
      await Promise.resolve();
      const peticionPut = httpMock.expectOne('/api/estantes/estante-1');
      expect(peticionPut.request.method).toBe('PUT');
      expect(peticionPut.request.headers.get('Authorization')).toBe('Bearer token-valido');
      peticionPut.flush({ estanteId: 'estante-1', ...datosNuevoEstante });

      await Promise.resolve();
      await Promise.resolve();
      httpMock.expectOne('/api/estantes').flush([{ estanteId: 'estante-1', ...datosNuevoEstante }]);

      const resultado = await promesa;

      expect(resultado).toEqual({ exito: true });
      expect(servicio.estantes()).toEqual([{ estanteId: 'estante-1', ...datosNuevoEstante }]);
    });

    it('devuelve el mensaje de error del backend cuando PUT /api/estantes/{estanteId} falla', async () => {
      const servicio = configurarPrueba('token-valido');

      const promesa = servicio.actualizarEstante('estante-1', datosNuevoEstante);
      await Promise.resolve();
      httpMock.expectOne('/api/estantes/estante-1').flush({ error: 'El estante no existe.' }, { status: 404, statusText: 'Not Found' });

      const resultado = await promesa;

      expect(resultado).toEqual({ exito: false, error: 'El estante no existe.' });
    });
  });

  describe('eliminarEstante', () => {
    it('devuelve error sin llamar a la API cuando no hay ID Token', async () => {
      const servicio = configurarPrueba(null);

      const resultado = await servicio.eliminarEstante('estante-1');

      expect(resultado).toEqual({ exito: false, error: 'No se pudo eliminar el estante. Intenta de nuevo.' });
    });

    it('elimina el estante y recarga la lista cuando DELETE /api/estantes/{estanteId} responde 204', async () => {
      const servicio = configurarPrueba('token-valido');

      const promesa = servicio.eliminarEstante('estante-1');
      await Promise.resolve();
      const peticionDelete = httpMock.expectOne('/api/estantes/estante-1');
      expect(peticionDelete.request.method).toBe('DELETE');
      expect(peticionDelete.request.headers.get('Authorization')).toBe('Bearer token-valido');
      peticionDelete.flush(null, { status: 204, statusText: 'No Content' });

      await Promise.resolve();
      await Promise.resolve();
      httpMock.expectOne('/api/estantes').flush([]);

      const resultado = await promesa;

      expect(resultado).toEqual({ exito: true });
      expect(servicio.estantes()).toEqual([]);
    });

    it('devuelve el mensaje de error del backend cuando DELETE /api/estantes/{estanteId} falla', async () => {
      const servicio = configurarPrueba('token-valido');

      const promesa = servicio.eliminarEstante('estante-1');
      await Promise.resolve();
      httpMock.expectOne('/api/estantes/estante-1').flush({ error: 'El estante no existe.' }, { status: 404, statusText: 'Not Found' });

      const resultado = await promesa;

      expect(resultado).toEqual({ exito: false, error: 'El estante no existe.' });
    });
  });
});
