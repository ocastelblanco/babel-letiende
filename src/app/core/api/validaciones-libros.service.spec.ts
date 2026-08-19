import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { AuthService } from '../auth/auth.service';
import type { ResumenValidacionLibros } from '../models/validacion-libros.model';
import { ValidacionesLibrosService } from './validaciones-libros.service';

// `auth.service.ts` (importado arriba solo como token de DI) importa el SDK
// real de Firebase a nivel de módulo — mismo motivo de mock que en
// `sitios-scraping.service.spec.ts`.
vi.mock('firebase/app', () => ({ initializeApp: vi.fn(() => ({})) }));
vi.mock('firebase/auth', () => ({
  getAuth: vi.fn(() => ({})),
  onAuthStateChanged: vi.fn(),
  signInWithPopup: vi.fn(),
  signOut: vi.fn(),
  GoogleAuthProvider: vi.fn(),
}));

const resumenFalso: ResumenValidacionLibros = {
  validacionId: 'v-1',
  estado: 'en_progreso',
  iniciadoPor: 'admin@letiende.co',
  iniciadoEn: '2026-01-01T00:00:00.000Z',
  actualizadoEn: '2026-01-01T00:00:00.000Z',
  indiceActual: 5,
  totalLibros: 10,
  librosRevisados: 5,
  pvpActualizados: 1,
  portadasCorregidas: 0,
  portadasPendientes: [],
  erroresLibro: [],
  muebleActualNombre: 'Biblioteca 1',
};

describe('ValidacionesLibrosService', () => {
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
    return TestBed.inject(ValidacionesLibrosService);
  }

  afterEach(() => {
    httpMock.verify();
  });

  describe('iniciarValidacion', () => {
    it('devuelve iniciada: false sin llamar a la API cuando no hay ID Token', async () => {
      const servicio = configurarPrueba(null);

      const resultado = await servicio.iniciarValidacion();

      expect(resultado).toEqual({
        iniciada: false,
        validacionIdEnCurso: null,
        error: 'No se pudo iniciar la validación. Intenta de nuevo.',
      });
    });

    it('devuelve iniciada: true con el validacionId cuando POST responde 202', async () => {
      const servicio = configurarPrueba('token-valido');

      const promesa = servicio.iniciarValidacion();
      await Promise.resolve();
      const peticion = httpMock.expectOne('/api/validaciones-libros');
      expect(peticion.request.method).toBe('POST');
      expect(peticion.request.headers.get('Authorization')).toBe('Bearer token-valido');
      peticion.flush({ validacionId: 'v-nueva' }, { status: 202, statusText: 'Accepted' });
      const resultado = await promesa;

      expect(resultado).toEqual({ iniciada: true, validacionId: 'v-nueva' });
      expect(servicio.ultimoValidacionId()).toBe('v-nueva');
    });

    it('devuelve el validacionIdEnCurso cuando POST responde 409 (ya hay una corrida activa)', async () => {
      const servicio = configurarPrueba('token-valido');

      const promesa = servicio.iniciarValidacion();
      await Promise.resolve();
      httpMock
        .expectOne('/api/validaciones-libros')
        .flush(
          { error: 'Ya hay una validación en curso.', validacionId: 'v-activa' },
          { status: 409, statusText: 'Conflict' },
        );
      const resultado = await promesa;

      expect(resultado).toEqual({
        iniciada: false,
        validacionIdEnCurso: 'v-activa',
        error: 'Ya hay una validación en curso.',
      });
      expect(servicio.ultimoValidacionId()).toBe('v-activa');
    });

    it('devuelve iniciada: false sin validacionIdEnCurso ante un error genérico (403, red)', async () => {
      const servicio = configurarPrueba('token-valido');

      const promesa = servicio.iniciarValidacion();
      await Promise.resolve();
      httpMock
        .expectOne('/api/validaciones-libros')
        .flush({ error: 'No autorizado.' }, { status: 403, statusText: 'Forbidden' });
      const resultado = await promesa;

      expect(resultado).toEqual({ iniciada: false, validacionIdEnCurso: null, error: 'No autorizado.' });
    });
  });

  describe('consultarValidacion', () => {
    it('devuelve null sin llamar a la API cuando no hay ID Token', async () => {
      const servicio = configurarPrueba(null);

      const resultado = await servicio.consultarValidacion('v-1');

      expect(resultado).toBeNull();
    });

    it('devuelve el resumen cuando GET responde 200', async () => {
      const servicio = configurarPrueba('token-valido');

      const promesa = servicio.consultarValidacion('v-1');
      await Promise.resolve();
      const peticion = httpMock.expectOne('/api/validaciones-libros/v-1');
      expect(peticion.request.method).toBe('GET');
      peticion.flush(resumenFalso);
      const resultado = await promesa;

      expect(resultado).toEqual(resumenFalso);
    });

    it('devuelve null cuando GET falla (404, red)', async () => {
      const servicio = configurarPrueba('token-valido');

      const promesa = servicio.consultarValidacion('v-1');
      await Promise.resolve();
      httpMock
        .expectOne('/api/validaciones-libros/v-1')
        .flush({ error: 'La validación no existe.' }, { status: 404, statusText: 'Not Found' });
      const resultado = await promesa;

      expect(resultado).toBeNull();
    });
  });
});
