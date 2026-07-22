import { TestBed } from '@angular/core/testing';
import type { User } from 'firebase/auth';
import { AuthService } from './auth.service';

const {
  initializeAppMock,
  getAuthMock,
  onAuthStateChangedMock,
  signInWithPopupMock,
  signOutMock,
  setCustomParametersMock,
  GoogleAuthProviderMock,
} = vi.hoisted(() => {
  const setCustomParametersMock = vi.fn();
  return {
    initializeAppMock: vi.fn(() => ({})),
    getAuthMock: vi.fn(() => ({})),
    onAuthStateChangedMock: vi.fn(),
    signInWithPopupMock: vi.fn(),
    signOutMock: vi.fn(),
    setCustomParametersMock,
    GoogleAuthProviderMock: vi.fn(function () {
      return { setCustomParameters: setCustomParametersMock };
    }),
  };
});

vi.mock('firebase/app', () => ({
  initializeApp: initializeAppMock,
}));

vi.mock('firebase/auth', () => ({
  getAuth: getAuthMock,
  onAuthStateChanged: onAuthStateChangedMock,
  signInWithPopup: signInWithPopupMock,
  signOut: signOutMock,
  GoogleAuthProvider: GoogleAuthProviderMock,
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

  it('iniciarSesionConGoogle fuerza el selector de cuentas de Google (prompt: select_account)', async () => {
    signInWithPopupMock.mockResolvedValue({ user: usuarioFalso });

    const servicio = TestBed.inject(AuthService);
    await servicio.iniciarSesionConGoogle();

    expect(setCustomParametersMock).toHaveBeenCalledWith({ prompt: 'select_account' });
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

  it('obtenerIdToken espera a que Firebase resuelva el estado inicial de sesión antes de responder (onAuthStateChanged es asíncrono incluso para restaurar una sesión persistida)', async () => {
    let callbackCapturado: ((usuario: User | null) => void) | undefined;
    onAuthStateChangedMock.mockImplementation((_auth: unknown, callback: (usuario: User | null) => void) => {
      callbackCapturado = callback;
    });

    const servicio = TestBed.inject(AuthService);
    let resuelto = false;
    const promesa = servicio.obtenerIdToken().then((resultado) => {
      resuelto = true;
      return resultado;
    });

    // onAuthStateChanged todavía no disparó — obtenerIdToken() no debe
    // resolver leyendo un Signal que aún no refleja el estado real.
    await Promise.resolve();
    await Promise.resolve();
    expect(resuelto).toBe(false);

    const getIdTokenMock = vi.fn().mockResolvedValue('token-real');
    callbackCapturado?.({ ...usuarioFalso, getIdToken: getIdTokenMock } as unknown as User);

    expect(await promesa).toBe('token-real');
  });
});
