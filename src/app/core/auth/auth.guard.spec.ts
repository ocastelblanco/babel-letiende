import { TestBed } from '@angular/core/testing';
import type { ActivatedRouteSnapshot, RouterStateSnapshot } from '@angular/router';
import { Router } from '@angular/router';
import type { User } from 'firebase/auth';
import { AuthGuard } from './auth.guard';
import { AuthService } from './auth.service';

// `auth.service.ts` (importado arriba solo como token de DI) importa el SDK
// real de Firebase a nivel de módulo. Se mockea aquí igual que en
// `auth.service.spec.ts` para que este archivo nunca cargue el `firebase/auth`
// real — ver gotcha en MEMORY.md §7 (vi.mock no aislado entre archivos).
vi.mock('firebase/app', () => ({ initializeApp: vi.fn(() => ({})) }));
vi.mock('firebase/auth', () => ({
  getAuth: vi.fn(() => ({})),
  onAuthStateChanged: vi.fn(),
  signInWithPopup: vi.fn(),
  signOut: vi.fn(),
  GoogleAuthProvider: vi.fn(),
}));

const rutaFalsa = {} as ActivatedRouteSnapshot;
const estadoFalso = {} as RouterStateSnapshot;

describe('AuthGuard', () => {
  it('redirige a /login cuando no hay sesión activa', async () => {
    const navigateMock = vi.fn();
    TestBed.configureTestingModule({
      providers: [
        { provide: AuthService, useValue: { usuario: () => null, esperarListo: () => Promise.resolve() } },
        { provide: Router, useValue: { navigate: navigateMock } },
      ],
    });

    const resultado = await TestBed.runInInjectionContext(() => AuthGuard(rutaFalsa, estadoFalso));

    expect(resultado).toBe(false);
    expect(navigateMock).toHaveBeenCalledWith(['/login']);
  });

  it('permite el acceso cuando hay una sesión activa', async () => {
    const navigateMock = vi.fn();
    const usuarioFalso = { uid: 'uid-123' } as User;
    TestBed.configureTestingModule({
      providers: [
        {
          provide: AuthService,
          useValue: { usuario: () => usuarioFalso, esperarListo: () => Promise.resolve() },
        },
        { provide: Router, useValue: { navigate: navigateMock } },
      ],
    });

    const resultado = await TestBed.runInInjectionContext(() => AuthGuard(rutaFalsa, estadoFalso));

    expect(resultado).toBe(true);
    expect(navigateMock).not.toHaveBeenCalled();
  });
});
