import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { AuthService } from '../auth/auth.service';
import { CargaConocimientoService } from './carga-conocimiento.service';

vi.mock('firebase/app', () => ({ initializeApp: vi.fn(() => ({})) }));
vi.mock('firebase/auth', () => ({
  getAuth: vi.fn(() => ({})),
  onAuthStateChanged: vi.fn(),
  signInWithPopup: vi.fn(),
  signOut: vi.fn(),
  GoogleAuthProvider: vi.fn(),
}));

describe('CargaConocimientoService', () => {
  let httpMock: HttpTestingController;

  function configurar(idToken: string | null) {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: AuthService, useValue: { obtenerIdToken: vi.fn().mockResolvedValue(idToken) } },
      ],
    });
    httpMock = TestBed.inject(HttpTestingController);
    return TestBed.inject(CargaConocimientoService);
  }

  afterEach(() => httpMock.verify());

  it('iniciar sin ID Token no llama a la API', async () => {
    const servicio = configurar(null);
    expect(await servicio.iniciar()).toMatchObject({ iniciada: false, cargaIdEnCurso: null });
  });

  it('iniciar envía el token y devuelve el cargaId', async () => {
    const servicio = configurar('tok');
    const promesa = servicio.iniciar();
    await Promise.resolve();
    const peticion = httpMock.expectOne('/api/carga-conocimiento');
    expect(peticion.request.headers.get('Authorization')).toBe('Bearer tok');
    peticion.flush({ cargaId: 'c-1' });
    expect(await promesa).toEqual({ iniciada: true, cargaId: 'c-1' });
  });

  it('un 409 devuelve la carga en curso para retomarla', async () => {
    const servicio = configurar('tok');
    const promesa = servicio.iniciar();
    await Promise.resolve();
    httpMock.expectOne('/api/carga-conocimiento').flush({ error: 'Ya hay una carga en curso.', cargaId: 'c-9' }, { status: 409, statusText: 'Conflict' });
    expect(await promesa).toEqual({ iniciada: false, cargaIdEnCurso: 'c-9', error: 'Ya hay una carga en curso.' });
  });

  it('un 403 devuelve el mensaje del backend', async () => {
    const servicio = configurar('tok');
    const promesa = servicio.iniciar();
    await Promise.resolve();
    httpMock.expectOne('/api/carga-conocimiento').flush({ error: 'No autorizado' }, { status: 403, statusText: 'Forbidden' });
    expect(await promesa).toEqual({ iniciada: false, cargaIdEnCurso: null, error: 'No autorizado' });
  });

  it('consultar devuelve null ante un error de red', async () => {
    const servicio = configurar('tok');
    const promesa = servicio.consultar('c-1');
    await Promise.resolve();
    httpMock.expectOne('/api/carga-conocimiento/c-1').flush('x', { status: 500, statusText: 'Error' });
    expect(await promesa).toBeNull();
  });
});
