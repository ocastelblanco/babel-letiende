import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { AuthService } from '../auth/auth.service';
import type { Usuario } from '../models/usuario.model';
import { UsuariosService } from './usuarios.service';

// `auth.service.ts` (importado arriba solo como token de DI) importa el SDK
// real de Firebase a nivel de módulo. Se mockea aquí también (igual que en
// `auth.service.spec.ts`) para que este archivo nunca cargue el `firebase/auth`
// real — si lo hiciera antes de que corra `auth.service.spec.ts`, el registro
// de módulos del proceso quedaría "envenenado" con el real y su propio
// `vi.mock('firebase/auth', ...)` dejaría de surtir efecto.
vi.mock('firebase/app', () => ({ initializeApp: vi.fn(() => ({})) }));
vi.mock('firebase/auth', () => ({
  getAuth: vi.fn(() => ({})),
  onAuthStateChanged: vi.fn(),
  signInWithPopup: vi.fn(),
  signOut: vi.fn(),
  GoogleAuthProvider: vi.fn(),
}));

describe('UsuariosService', () => {
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
    return TestBed.inject(UsuariosService);
  }

  afterEach(() => {
    httpMock.verify();
  });

  it('resuelve null sin llamar a la API cuando no hay ID Token (sin sesión)', async () => {
    const servicio = configurarPrueba(null);

    const resultado = await servicio.obtenerUsuarioActual();

    expect(resultado).toBeNull();
    expect(servicio.usuarioActual()).toBeNull();
  });

  it('resuelve null cuando /api/usuarios/me responde 403', async () => {
    const servicio = configurarPrueba('token-falso');

    const promesa = servicio.obtenerUsuarioActual();
    // Deja correr el microtask del `await` interno a `obtenerIdToken()`
    // (mockeado) antes de esperar que la petición HTTP ya se haya emitido.
    await Promise.resolve();
    const peticion = httpMock.expectOne('/api/usuarios/me');
    expect(peticion.request.headers.get('Authorization')).toBe('Bearer token-falso');
    peticion.flush({ error: 'Este correo no está autorizado en Babel.' }, { status: 403, statusText: 'Forbidden' });

    expect(await promesa).toBeNull();
  });

  it('resuelve el Usuario y actualiza el Signal cuando /api/usuarios/me responde 200', async () => {
    const servicio = configurarPrueba('token-valido');
    const usuarioEsperado: Usuario = {
      email: 'admin@letiende.co',
      nombre: 'Admin',
      fotoUrl: null,
      rol: 'administrador',
      creadoEn: '2026-07-19T00:00:00.000Z',
    };

    const promesa = servicio.obtenerUsuarioActual();
    // Deja correr el microtask del `await` interno a `obtenerIdToken()`
    // (mockeado) antes de esperar que la petición HTTP ya se haya emitido.
    await Promise.resolve();
    httpMock.expectOne('/api/usuarios/me').flush(usuarioEsperado);

    expect(await promesa).toEqual(usuarioEsperado);
    expect(servicio.usuarioActual()).toEqual(usuarioEsperado);
  });
});
