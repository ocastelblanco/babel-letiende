import { TestBed } from '@angular/core/testing';
import type { User } from 'firebase/auth';
import { AuthService } from './auth.service';

const {
  initializeAppMock,
  getAuthMock,
  onAuthStateChangedMock,
  signInWithPopupMock,
  signOutMock,
} = vi.hoisted(() => ({
  initializeAppMock: vi.fn(() => ({})),
  getAuthMock: vi.fn(() => ({})),
  onAuthStateChangedMock: vi.fn(),
  signInWithPopupMock: vi.fn(),
  signOutMock: vi.fn(),
}));

vi.mock('firebase/app', () => ({
  initializeApp: initializeAppMock,
}));

vi.mock('firebase/auth', () => ({
  getAuth: getAuthMock,
  onAuthStateChanged: onAuthStateChangedMock,
  signInWithPopup: signInWithPopupMock,
  signOut: signOutMock,
  GoogleAuthProvider: vi.fn(),
}));

describe('AuthService', () => {
  const usuarioFalso = { uid: 'uid-123', email: 'vendedor@letiende.co' } as User;

  beforeEach(() => {
    vi.clearAllMocks();
    TestBed.configureTestingModule({});
  });

  it('puebla el Signal de usuario tras un login exitoso con Google', async () => {
    signInWithPopupMock.mockResolvedValue({ user: usuarioFalso });

    const servicio = TestBed.inject(AuthService);
    expect(servicio.usuario()).toBeNull();

    const resultado = await servicio.iniciarSesionConGoogle();

    expect(signInWithPopupMock).toHaveBeenCalledTimes(1);
    expect(resultado).toEqual(usuarioFalso);
    expect(servicio.usuario()).toEqual(usuarioFalso);
  });

  it('cerrarSesion invoca signOut de Firebase y limpia el Signal de usuario', async () => {
    signInWithPopupMock.mockResolvedValue({ user: usuarioFalso });
    signOutMock.mockResolvedValue(undefined);

    const servicio = TestBed.inject(AuthService);
    await servicio.iniciarSesionConGoogle();
    expect(servicio.usuario()).toEqual(usuarioFalso);

    await servicio.cerrarSesion();

    expect(signOutMock).toHaveBeenCalledTimes(1);
    expect(servicio.usuario()).toBeNull();
  });
});
