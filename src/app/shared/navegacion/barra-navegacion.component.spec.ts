import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter, Router, type Routes } from '@angular/router';
import type { User } from 'firebase/auth';
import { UsuariosService } from '../../core/api/usuarios.service';
import { AuthService } from '../../core/auth/auth.service';
import type { Usuario } from '../../core/models/usuario.model';
import { BarraNavegacionComponent } from './barra-navegacion.component';

/** Componente vacío para registrar rutas reales en las pruebas que navegan. */
@Component({ selector: 'app-ruta-dummy', template: '' })
class ComponenteRutaDummy {}

// `auth.service.ts` (importado abajo solo como token de DI) importa el SDK
// real de Firebase a nivel de módulo — se mockea aquí para que este archivo
// nunca lo cargue de verdad (mismo motivo que en login.component.spec.ts).
vi.mock('firebase/app', () => ({ initializeApp: vi.fn(() => ({})) }));
vi.mock('firebase/auth', () => ({
  getAuth: vi.fn(() => ({})),
  onAuthStateChanged: vi.fn(),
  signInWithPopup: vi.fn(),
  signOut: vi.fn(),
  GoogleAuthProvider: vi.fn(function () {
    return { setCustomParameters: vi.fn() };
  }),
}));

/** Rutas usadas en las pruebas que navegan, para que el Router pueda resolverlas. */
const RUTAS: Routes = [
  { path: 'login', component: ComponenteRutaDummy },
  { path: 'catalogar', component: ComponenteRutaDummy },
  { path: 'admin', component: ComponenteRutaDummy },
];

function configurarPrueba(
  usuario: User | null,
  usuarioActual: Usuario | null = null,
  cerrarSesionMock = vi.fn().mockResolvedValue(undefined),
  rutas: Routes = [],
) {
  TestBed.configureTestingModule({
    providers: [
      provideRouter(rutas),
      {
        provide: AuthService,
        useValue: {
          usuario: signal(usuario),
          cerrarSesion: cerrarSesionMock,
        },
      },
      {
        provide: UsuariosService,
        useValue: {
          usuarioActual: signal(usuarioActual),
        },
      },
    ],
  });

  const fixture: ComponentFixture<BarraNavegacionComponent> =
    TestBed.createComponent(BarraNavegacionComponent);
  fixture.detectChanges();

  return { fixture, cerrarSesionMock };
}

describe('BarraNavegacionComponent', () => {
  it('sin sesión: muestra el logo y el botón "Ingresar" como icon button accesible, sin secciones ni avatar', () => {
    const { fixture } = configurarPrueba(null);
    const texto = fixture.nativeElement.textContent as string;

    const enlaceIngresar = fixture.nativeElement.querySelector(
      'a[aria-label="Ingresar"]',
    ) as HTMLAnchorElement;
    expect(enlaceIngresar).toBeTruthy();
    expect(enlaceIngresar.getAttribute('href')).toBe('/login');
    expect(enlaceIngresar.textContent?.trim()).toBe('');
    expect(texto).not.toContain('Catalogar');
    expect(texto).not.toContain('Administración');
    expect(texto).not.toContain('Cerrar sesión');
    expect(fixture.nativeElement.querySelectorAll('nav a').length).toBe(0);
  });

  it('el botón "Ingresar" no se renderiza en /login (se confunde con "Ingresar con Google")', async () => {
    const { fixture } = configurarPrueba(null, null, undefined, RUTAS);
    const router = TestBed.inject(Router);

    await router.navigateByUrl('/login');
    fixture.detectChanges();

    const enlaceIngresar = fixture.nativeElement.querySelector('a[aria-label="Ingresar"]');
    expect(enlaceIngresar).toBeNull();
  });

  it('vendedor con sesión ve "Catalogar" pero no "Administración"', () => {
    const usuario = { displayName: 'Vera Vendedora', email: 'vera@letiende.co', photoURL: null } as User;
    const usuarioActual: Usuario = {
      email: 'vera@letiende.co',
      nombre: 'Vera Vendedora',
      fotoUrl: null,
      rol: 'vendedor',
      creadoEn: '2026-07-19T00:00:00.000Z',
    };
    const { fixture } = configurarPrueba(usuario, usuarioActual);
    const texto = fixture.nativeElement.textContent as string;

    expect(texto).toContain('Catalogar');
    expect(texto).not.toContain('Administración');
    expect(texto).toContain('Cerrar sesión');
  });

  it('administrador con sesión ve "Catalogar" y "Administración"', () => {
    const usuario = { displayName: 'Ana Admin', email: 'ana@letiende.co', photoURL: null } as User;
    const usuarioActual: Usuario = {
      email: 'ana@letiende.co',
      nombre: 'Ana Admin',
      fotoUrl: null,
      rol: 'administrador',
      creadoEn: '2026-07-19T00:00:00.000Z',
    };
    const { fixture } = configurarPrueba(usuario, usuarioActual);
    const texto = fixture.nativeElement.textContent as string;

    expect(texto).toContain('Catalogar');
    expect(texto).toContain('Administración');
  });

  it('muestra el avatar con photoURL con referrerpolicy="no-referrer"', () => {
    const usuario = {
      displayName: 'Ana Admin',
      email: 'ana@letiende.co',
      photoURL: 'https://lh3.googleusercontent.com/foto.jpg',
    } as User;
    const { fixture } = configurarPrueba(usuario, null);

    const img = fixture.nativeElement.querySelector('img[alt="Ana Admin"]') as HTMLImageElement;
    expect(img).toBeTruthy();
    expect(img.getAttribute('referrerpolicy')).toBe('no-referrer');
  });

  it('sin photoURL, muestra un avatar de respaldo con la inicial del nombre', () => {
    const usuario = { displayName: 'Ana Admin', email: 'ana@letiende.co', photoURL: null } as User;
    const { fixture } = configurarPrueba(usuario, null);
    const texto = fixture.nativeElement.textContent as string;

    expect(texto).toContain('A');
  });

  it('"Cerrar sesión" invoca authService.cerrarSesion() y navega a /', async () => {
    const usuario = { displayName: 'Ana Admin', email: 'ana@letiende.co', photoURL: null } as User;
    const { fixture, cerrarSesionMock } = configurarPrueba(usuario, null);
    const router = TestBed.inject(Router);
    const navigateSpy = vi.spyOn(router, 'navigateByUrl').mockResolvedValue(true);

    const botonCerrarSesion = Array.from(
      fixture.nativeElement.querySelectorAll('button') as NodeListOf<HTMLButtonElement>,
    ).find((boton) => boton.textContent?.includes('Cerrar sesión'));
    botonCerrarSesion?.click();
    await Promise.resolve();
    await Promise.resolve();

    expect(cerrarSesionMock).toHaveBeenCalledTimes(1);
    expect(navigateSpy).toHaveBeenCalledWith('/');
  });

  it('el botón hamburguesa abre el drawer móvil con los mismos enlaces', () => {
    const usuario = { displayName: 'Ana Admin', email: 'ana@letiende.co', photoURL: null } as User;
    const { fixture } = configurarPrueba(usuario, null);

    const botonAbrirMenu = fixture.nativeElement.querySelector(
      'button[aria-label="Abrir menú de navegación"]',
    ) as HTMLButtonElement;
    expect(botonAbrirMenu).toBeTruthy();
    botonAbrirMenu.click();
    fixture.detectChanges();

    const drawer = fixture.nativeElement.querySelector('.md\\:hidden nav[aria-label="Navegación principal"]');
    expect(drawer).toBeTruthy();
    expect((drawer as HTMLElement).textContent).toContain('Catalogar');
  });
});
