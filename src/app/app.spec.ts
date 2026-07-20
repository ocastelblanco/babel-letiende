import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { signal } from '@angular/core';
import { provideRouter } from '@angular/router';
import { TestBed } from '@angular/core/testing';
import { App } from './app';
import { AuthService } from './core/auth/auth.service';
import { UsuariosService } from './core/api/usuarios.service';
import type { Usuario } from './core/models/usuario.model';

// `app.ts` inyecta `AuthService`, que importa el SDK real de Firebase a
// nivel de módulo — mismo motivo de mock que en `role.guard.spec.ts`/
// `usuarios.service.spec.ts` (ver MEMORY.md §7, `vi.mock` no aislado entre
// archivos).
vi.mock('firebase/app', () => ({ initializeApp: vi.fn(() => ({})) }));
vi.mock('firebase/auth', () => ({
  getAuth: vi.fn(() => ({})),
  onAuthStateChanged: vi.fn(),
  signInWithPopup: vi.fn(),
  signOut: vi.fn(),
  GoogleAuthProvider: vi.fn(),
}));

const usuarioFirebaseFalso = { uid: 'uid-1' } as unknown as import('firebase/auth').User;

const administradorFalso: Usuario = {
  email: 'admin@letiende.co',
  nombre: 'Admin de prueba',
  fotoUrl: null,
  rol: 'administrador',
  creadoEn: '2026-07-20T00:00:00.000Z',
};

function configurarPrueba(opciones: { usuario?: import('firebase/auth').User | null; usuarioActual?: Usuario | null } = {}) {
  const obtenerUsuarioActualMock = vi.fn().mockResolvedValue(opciones.usuarioActual ?? null);

  TestBed.configureTestingModule({
    imports: [App],
    providers: [
      provideHttpClient(),
      provideHttpClientTesting(),
      provideRouter([]),
      {
        provide: AuthService,
        useValue: {
          usuario: signal(opciones.usuario ?? null),
          cerrarSesion: vi.fn(),
        },
      },
      {
        provide: UsuariosService,
        useValue: {
          usuarioActual: signal(opciones.usuarioActual ?? null),
          obtenerUsuarioActual: obtenerUsuarioActualMock,
        },
      },
    ],
  });

  return { obtenerUsuarioActualMock };
}

describe('App', () => {
  it('crea la aplicación', () => {
    configurarPrueba();
    const fixture = TestBed.createComponent(App);
    const app = fixture.componentInstance;
    expect(app).toBeTruthy();
  });

  it('renderiza el router-outlet como única salida de la raíz', async () => {
    configurarPrueba();
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.querySelector('router-outlet')).not.toBeNull();
  });

  it('no muestra el enlace de Administración sin sesión', () => {
    configurarPrueba();
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).not.toContain('Administración');
  });

  it('no muestra el enlace de Administración para un vendedor', () => {
    configurarPrueba({
      usuario: usuarioFirebaseFalso,
      usuarioActual: { ...administradorFalso, rol: 'vendedor' },
    });
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).not.toContain('Administración');
  });

  it('muestra el enlace de Administración para un administrador con sesión', () => {
    configurarPrueba({ usuario: usuarioFirebaseFalso, usuarioActual: administradorFalso });
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Administración');
  });

  it('resuelve el usuario actual al iniciar sesión', () => {
    const { obtenerUsuarioActualMock } = configurarPrueba({ usuario: usuarioFirebaseFalso });
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    expect(obtenerUsuarioActualMock).toHaveBeenCalled();
  });
});
