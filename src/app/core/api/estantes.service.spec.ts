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
});
