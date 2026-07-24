import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { AuthService } from '../../core/auth/auth.service';
import { EditorialesDescuentosService } from '../../core/api/editoriales-descuentos.service';
import { LibrosService } from '../../core/api/libros.service';
import { MetadatosService } from '../../core/api/metadatos.service';
import { UbicacionFisicaService } from '../../core/api/ubicacion-fisica.service';
import { UsuariosService } from '../../core/api/usuarios.service';
import { GestionarComponent } from './gestionar.component';

// `auth.service.ts` importa el SDK real de Firebase a nivel de módulo — mismo
// mock que en el resto de specs que dependen de `AuthService` (transitivamente,
// a través de `CatalogarLibroComponent`/`EditarLibroComponent`).
vi.mock('firebase/app', () => ({ initializeApp: vi.fn(() => ({})) }));
vi.mock('firebase/auth', () => ({
  getAuth: vi.fn(() => ({})),
  onAuthStateChanged: vi.fn(),
  signInWithPopup: vi.fn(),
  signOut: vi.fn(),
  GoogleAuthProvider: vi.fn(),
}));

// Sin cámara real en CI/sandbox — mismo mock mínimo que en
// `catalogar-libro.component.spec.ts`/`editar-libro.component.spec.ts`.
vi.mock('@zxing/browser', () => ({
  BrowserMultiFormatReader: vi.fn(function BrowserMultiFormatReaderFalso() {
    return { decodeFromConstraints: vi.fn().mockResolvedValue({ stop: vi.fn() }) };
  }),
}));

function configurarPrueba(): ComponentFixture<GestionarComponent> {
  TestBed.configureTestingModule({
    providers: [
      provideHttpClient(),
      provideHttpClientTesting(),
      provideRouter([]),
      { provide: AuthService, useValue: { obtenerIdToken: () => Promise.resolve(null), usuario: signal(null) } },
      {
        provide: UbicacionFisicaService,
        useValue: {
          espacios: signal([]),
          errorEspacios: signal(false),
          cargarEspacios: vi.fn().mockResolvedValue(undefined),
          muebles: signal([]),
          cargarMuebles: vi.fn().mockResolvedValue(undefined),
          ubicaciones: signal([]),
          errorUbicaciones: signal(false),
          cargarUbicaciones: vi.fn().mockResolvedValue(undefined),
        },
      },
      {
        provide: MetadatosService,
        useValue: {
          obtenerMetadatos: vi.fn(),
          buscarCandidatos: vi.fn(),
          buscarPvp: vi.fn(),
        },
      },
      {
        provide: EditorialesDescuentosService,
        useValue: { descuentos: signal([]), cargarDescuentos: vi.fn().mockResolvedValue(undefined) },
      },
      {
        provide: LibrosService,
        useValue: {
          inventario: signal([]),
          cargandoInventario: signal(false),
          errorInventario: signal(false),
          cargarInventario: vi.fn().mockResolvedValue(undefined),
          editarLibro: vi.fn(),
          eliminarLibro: vi.fn(),
        },
      },
      {
        provide: UsuariosService,
        useValue: { usuarioActual: signal(null), obtenerUsuarioActual: vi.fn().mockResolvedValue(null) },
      },
    ],
  });

  const fixture = TestBed.createComponent(GestionarComponent);
  fixture.detectChanges();
  return fixture;
}

describe('GestionarComponent', () => {
  it('muestra la pestaña "Catalogar" por defecto', () => {
    const fixture = configurarPrueba();

    expect(fixture.nativeElement.querySelector('app-catalogar-libro')).toBeTruthy();
    expect(fixture.nativeElement.querySelector('app-editar-libro')).toBeFalsy();
  });

  it('cambia a la pestaña "Editar" al hacer click', () => {
    const fixture = configurarPrueba();

    const botones = Array.from(fixture.nativeElement.querySelectorAll('button')) as HTMLButtonElement[];
    const botonEditar = botones.find((boton) => boton.textContent?.trim() === 'Editar');
    botonEditar?.click();
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('app-editar-libro')).toBeTruthy();
    expect(fixture.nativeElement.querySelector('app-catalogar-libro')).toBeFalsy();
  });

  it('vuelve a "Catalogar" al hacer click de nuevo en esa pestaña', () => {
    const fixture = configurarPrueba();

    const botones = Array.from(fixture.nativeElement.querySelectorAll('button')) as HTMLButtonElement[];
    const botonEditar = botones.find((boton) => boton.textContent?.trim() === 'Editar');
    botonEditar?.click();
    fixture.detectChanges();

    const botonCatalogar = Array.from(fixture.nativeElement.querySelectorAll('button') as NodeListOf<HTMLButtonElement>).find(
      (boton) => boton.textContent?.trim() === 'Catalogar',
    );
    botonCatalogar?.click();
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('app-catalogar-libro')).toBeTruthy();
  });

  it('incluye un vínculo para volver al catálogo público', () => {
    const fixture = configurarPrueba();

    const enlace = fixture.nativeElement.querySelector('a[href="/"]');
    expect(enlace).toBeTruthy();
  });
});
