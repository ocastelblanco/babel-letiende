import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { AuthService } from '../auth/auth.service';
import { VentasService } from './ventas.service';

// `auth.service.ts` (importado arriba solo como token de DI) importa el SDK
// real de Firebase a nivel de módulo. Se mockea aquí también (igual que en
// `editoriales-descuentos.service.spec.ts`) para que este archivo nunca
// cargue el `firebase/auth` real.
vi.mock('firebase/app', () => ({ initializeApp: vi.fn(() => ({})) }));
vi.mock('firebase/auth', () => ({
  getAuth: vi.fn(() => ({})),
  onAuthStateChanged: vi.fn(),
  signInWithPopup: vi.fn(),
  signOut: vi.fn(),
  GoogleAuthProvider: vi.fn(),
}));

describe('VentasService', () => {
  let httpMock: HttpTestingController;
  let obtenerIdTokenMock: ReturnType<typeof vi.fn>;
  let createObjectURLSpy: ReturnType<typeof vi.fn>;
  let revokeObjectURLSpy: ReturnType<typeof vi.fn>;

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
    return TestBed.inject(VentasService);
  }

  beforeEach(() => {
    createObjectURLSpy = vi.fn().mockReturnValue('blob:falso');
    revokeObjectURLSpy = vi.fn();
    URL.createObjectURL = createObjectURLSpy as unknown as typeof URL.createObjectURL;
    URL.revokeObjectURL = revokeObjectURLSpy as unknown as typeof URL.revokeObjectURL;
  });

  afterEach(() => {
    httpMock.verify();
  });

  it('devuelve error sin llamar a la API cuando no hay ID Token (sin sesión)', async () => {
    const servicio = configurarPrueba(null);

    const resultado = await servicio.exportarVentas();

    expect(resultado).toEqual({
      exito: false,
      error: 'No se pudo exportar el reporte de ventas. Intenta de nuevo.',
    });
  });

  it('descarga el archivo y devuelve éxito cuando /api/ventas/exportar responde 200 sin filtros', async () => {
    const servicio = configurarPrueba('token-valido');

    const promesa = servicio.exportarVentas();
    await Promise.resolve();
    const peticion = httpMock.expectOne((req) => req.url === '/api/ventas/exportar');
    expect(peticion.request.method).toBe('GET');
    expect(peticion.request.headers.get('Authorization')).toBe('Bearer token-valido');
    expect(peticion.request.params.keys()).toEqual([]);
    peticion.flush(new Blob(['contenido-falso']));

    expect(await promesa).toEqual({ exito: true });
    expect(createObjectURLSpy).toHaveBeenCalledTimes(1);
    expect(revokeObjectURLSpy).toHaveBeenCalledWith('blob:falso');
  });

  it('envía los filtros dados como query params', async () => {
    const servicio = configurarPrueba('token-valido');

    const promesa = servicio.exportarVentas({
      desde: '2026-07-01T00:00:00.000Z',
      hasta: '2026-07-31T23:59:59.999Z',
      editorial: 'Planeta',
      formaDePago: 'efectivo',
    });
    await Promise.resolve();
    const peticion = httpMock.expectOne(
      (req) => req.url === '/api/ventas/exportar' && req.params.get('editorial') === 'Planeta',
    );
    expect(peticion.request.params.get('desde')).toBe('2026-07-01T00:00:00.000Z');
    expect(peticion.request.params.get('hasta')).toBe('2026-07-31T23:59:59.999Z');
    expect(peticion.request.params.get('formaDePago')).toBe('efectivo');
    peticion.flush(new Blob(['contenido-falso']));

    expect(await promesa).toEqual({ exito: true });
  });

  it('devuelve error sin descargar nada cuando /api/ventas/exportar responde 403', async () => {
    const servicio = configurarPrueba('token-valido');

    const promesa = servicio.exportarVentas();
    await Promise.resolve();
    httpMock
      .expectOne((req) => req.url === '/api/ventas/exportar')
      .flush(new Blob(['{}']), { status: 403, statusText: 'Forbidden' });

    const resultado = await promesa;
    expect(resultado.exito).toBe(false);
    expect(createObjectURLSpy).not.toHaveBeenCalled();
  });
});
