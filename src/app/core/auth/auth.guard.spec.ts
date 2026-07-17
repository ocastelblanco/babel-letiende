import { TestBed } from '@angular/core/testing';
import type { ActivatedRouteSnapshot, RouterStateSnapshot } from '@angular/router';
import { Router } from '@angular/router';
import type { User } from 'firebase/auth';
import { AuthGuard } from './auth.guard';
import { AuthService } from './auth.service';

const rutaFalsa = {} as ActivatedRouteSnapshot;
const estadoFalso = {} as RouterStateSnapshot;

describe('AuthGuard', () => {
  it('redirige a /login cuando no hay sesión activa', () => {
    const navigateMock = vi.fn();
    TestBed.configureTestingModule({
      providers: [
        { provide: AuthService, useValue: { usuario: () => null } },
        { provide: Router, useValue: { navigate: navigateMock } },
      ],
    });

    const resultado = TestBed.runInInjectionContext(() => AuthGuard(rutaFalsa, estadoFalso));

    expect(resultado).toBe(false);
    expect(navigateMock).toHaveBeenCalledWith(['/login']);
  });

  it('permite el acceso cuando hay una sesión activa', () => {
    const navigateMock = vi.fn();
    const usuarioFalso = { uid: 'uid-123' } as User;
    TestBed.configureTestingModule({
      providers: [
        { provide: AuthService, useValue: { usuario: () => usuarioFalso } },
        { provide: Router, useValue: { navigate: navigateMock } },
      ],
    });

    const resultado = TestBed.runInInjectionContext(() => AuthGuard(rutaFalsa, estadoFalso));

    expect(resultado).toBe(true);
    expect(navigateMock).not.toHaveBeenCalled();
  });
});
