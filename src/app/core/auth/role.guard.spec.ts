import { TestBed } from '@angular/core/testing';
import type { ActivatedRouteSnapshot, RouterStateSnapshot } from '@angular/router';
import { Router } from '@angular/router';
import { UsuariosService } from '../api/usuarios.service';
import type { Usuario } from '../models/usuario.model';
import { RoleGuard } from './role.guard';

// `usuarios.service.ts` importa (como token de DI) `auth.service.ts`, que a su
// vez importa el SDK real de Firebase a nivel de módulo. Se mockea aquí igual
// que en `auth.service.spec.ts`/`usuarios.service.spec.ts` para que este
// archivo nunca cargue el `firebase/auth` real.
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

function configurarPrueba(usuarioResuelto: Usuario | null) {
  const navigateMock = vi.fn();
  TestBed.configureTestingModule({
    providers: [
      {
        provide: UsuariosService,
        useValue: { obtenerUsuarioActual: () => Promise.resolve(usuarioResuelto) },
      },
      { provide: Router, useValue: { navigate: navigateMock } },
    ],
  });
  return { navigateMock };
}

describe('RoleGuard', () => {
  it('bloquea y redirige a /libros cuando no hay sesión (usuario null)', async () => {
    const { navigateMock } = configurarPrueba(null);

    const resultado = await TestBed.runInInjectionContext(() =>
      RoleGuard('administrador')(rutaFalsa, estadoFalso),
    );

    expect(resultado).toBe(false);
    expect(navigateMock).toHaveBeenCalledWith(['/libros']);
  });

  it('bloquea y redirige a /libros cuando el rol no coincide (ej. 403 o rol distinto)', async () => {
    const usuarioVendedor: Usuario = {
      email: 'vendedor@letiende.co',
      nombre: 'Vendedor de prueba',
      fotoUrl: null,
      rol: 'vendedor',
      creadoEn: '2026-07-19T00:00:00.000Z',
    };
    const { navigateMock } = configurarPrueba(usuarioVendedor);

    const resultado = await TestBed.runInInjectionContext(() =>
      RoleGuard('administrador')(rutaFalsa, estadoFalso),
    );

    expect(resultado).toBe(false);
    expect(navigateMock).toHaveBeenCalledWith(['/libros']);
  });

  it('permite el acceso cuando el rol coincide', async () => {
    const usuarioAdmin: Usuario = {
      email: 'admin@letiende.co',
      nombre: 'Admin de prueba',
      fotoUrl: null,
      rol: 'administrador',
      creadoEn: '2026-07-19T00:00:00.000Z',
    };
    const { navigateMock } = configurarPrueba(usuarioAdmin);

    const resultado = await TestBed.runInInjectionContext(() =>
      RoleGuard('administrador')(rutaFalsa, estadoFalso),
    );

    expect(resultado).toBe(true);
    expect(navigateMock).not.toHaveBeenCalled();
  });

  it('permite el acceso con una lista de roles cuando el rol del usuario está incluido', async () => {
    const usuarioVendedor: Usuario = {
      email: 'vendedor@letiende.co',
      nombre: 'Vendedor de prueba',
      fotoUrl: null,
      rol: 'vendedor',
      creadoEn: '2026-07-19T00:00:00.000Z',
    };
    const { navigateMock } = configurarPrueba(usuarioVendedor);

    const resultado = await TestBed.runInInjectionContext(() =>
      RoleGuard(['vendedor', 'administrador'])(rutaFalsa, estadoFalso),
    );

    expect(resultado).toBe(true);
    expect(navigateMock).not.toHaveBeenCalled();
  });

  it('bloquea y redirige a /libros con una lista de roles cuando el rol del usuario no está incluida', async () => {
    const usuarioSinFila: Usuario | null = null;
    const { navigateMock } = configurarPrueba(usuarioSinFila);

    const resultado = await TestBed.runInInjectionContext(() =>
      RoleGuard(['vendedor', 'administrador'])(rutaFalsa, estadoFalso),
    );

    expect(resultado).toBe(false);
    expect(navigateMock).toHaveBeenCalledWith(['/libros']);
  });
});
