import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { AuthService } from '../../core/auth/auth.service';
import { EstantesService } from '../../core/api/estantes.service';
import { LibrosService } from '../../core/api/libros.service';
import type { Estante } from '../../core/models/estante.model';
import type { Libro } from '../../core/models/libro.model';
import { CambiarEstanteComponent } from './cambiar-estante.component';

// `auth.service.ts` (importado solo como token de DI) importa el SDK real de
// Firebase a nivel de módulo — mismo motivo de mock que en el resto de specs
// que tocan AuthService (ver `catalogar-libro.component.spec.ts`).
vi.mock('firebase/app', () => ({ initializeApp: vi.fn(() => ({})) }));
vi.mock('firebase/auth', () => ({
  getAuth: vi.fn(() => ({})),
  onAuthStateChanged: vi.fn(),
  signInWithPopup: vi.fn(),
  signOut: vi.fn(),
  GoogleAuthProvider: vi.fn(),
}));

const estanteFalso: Estante = {
  estanteId: 'estante-1',
  espacio: 'Espacio principal',
  mueble: 'Biblioteca 1',
  ubicacion: 'Estante 1',
};

const libroFalso: Libro = {
  isbn: '9780000000000',
  bookId: 'book-1',
  titulo: 'Cien años de soledad',
  autor: 'Gabriel García Márquez',
  editorial: 'Sudamericana',
  portadaUrl: null,
  pvp: 45000,
  porcentajeDescuentoEditorial: 35,
  costo: 29250,
  utilidadCatalogo: 15750,
  cantidadTotal: 2,
  cantidadDisponible: 2,
  estanteId: 'estante-1',
  creadoPor: 'vendedor@letiende.co',
  creadoEn: '2026-01-01T00:00:00.000Z',
  actualizadoEn: '2026-01-01T00:00:00.000Z',
};

function configurarPrueba(opciones: { bookId?: string; libros?: Libro[] } = {}) {
  const cargarEstantesMock = vi.fn().mockResolvedValue(undefined);
  const cargarCatalogoMock = vi.fn().mockResolvedValue(undefined);
  const obtenerIdTokenMock = vi.fn().mockResolvedValue('token-valido');

  TestBed.configureTestingModule({
    providers: [
      provideHttpClient(),
      provideHttpClientTesting(),
      provideRouter([]),
      {
        provide: ActivatedRoute,
        useValue: { snapshot: { paramMap: convertToParamMap({ bookId: opciones.bookId ?? 'book-1' }) } },
      },
      { provide: AuthService, useValue: { obtenerIdToken: obtenerIdTokenMock } },
      {
        provide: EstantesService,
        useValue: {
          estantes: signal([estanteFalso]),
          error: signal(false),
          cargarEstantes: cargarEstantesMock,
        },
      },
      {
        provide: LibrosService,
        useValue: {
          libros: signal(opciones.libros ?? [libroFalso]),
          cargando: signal(false),
          error: signal(false),
          cargarCatalogo: cargarCatalogoMock,
        },
      },
    ],
  });

  const httpMock = TestBed.inject(HttpTestingController);
  const fixture: ComponentFixture<CambiarEstanteComponent> = TestBed.createComponent(CambiarEstanteComponent);
  fixture.detectChanges();

  return { fixture, httpMock, obtenerIdTokenMock, cargarEstantesMock, cargarCatalogoMock };
}

describe('CambiarEstanteComponent', () => {
  let httpMock: HttpTestingController;

  afterEach(() => {
    httpMock.verify();
  });

  it('carga los estantes y el catálogo al inicializar', () => {
    const resultado = configurarPrueba();
    httpMock = resultado.httpMock;

    expect(resultado.cargarEstantesMock).toHaveBeenCalledTimes(1);
    expect(resultado.cargarCatalogoMock).toHaveBeenCalledTimes(1);
  });

  it('preselecciona el estante actual del libro tras cargar el catálogo', async () => {
    const { fixture, httpMock: mock } = configurarPrueba();
    httpMock = mock;
    await Promise.resolve();
    await Promise.resolve();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((fixture.componentInstance as any).formulario.value.estanteId).toBe('estante-1');
  });

  it('muestra "no se encontró el libro" cuando el bookId no está en el catálogo', () => {
    const { fixture, httpMock: mock } = configurarPrueba({ bookId: 'no-existe', libros: [libroFalso] });
    httpMock = mock;
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('No se encontró el libro');
  });

  it('envía PATCH /api/libros/:bookId/estante con el ID Token real y muestra el mensaje de éxito', async () => {
    const { fixture, httpMock: mock } = configurarPrueba();
    httpMock = mock;
    await Promise.resolve();
    await Promise.resolve();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (fixture.componentInstance as any).formulario.setValue({ estanteId: 'estante-2' });
    const formulario = fixture.nativeElement.querySelector('form') as HTMLFormElement;
    formulario.dispatchEvent(new Event('submit'));
    await Promise.resolve();
    await Promise.resolve();

    const peticion = httpMock.expectOne('/api/libros/book-1/estante');
    expect(peticion.request.method).toBe('PATCH');
    expect(peticion.request.headers.get('Authorization')).toBe('Bearer token-valido');
    expect(peticion.request.body).toEqual({ estanteId: 'estante-2' });
    peticion.flush({ bookId: 'book-1', estanteId: 'estante-2' });
    await Promise.resolve();
    await Promise.resolve();
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('Estante actualizado correctamente.');
  });

  it('muestra un mensaje de error cuando el PATCH falla', async () => {
    const { fixture, httpMock: mock } = configurarPrueba();
    httpMock = mock;
    await Promise.resolve();
    await Promise.resolve();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (fixture.componentInstance as any).formulario.setValue({ estanteId: 'estante-2' });
    const formulario = fixture.nativeElement.querySelector('form') as HTMLFormElement;
    formulario.dispatchEvent(new Event('submit'));
    await Promise.resolve();
    await Promise.resolve();

    httpMock
      .expectOne('/api/libros/book-1/estante')
      .flush({ error: 'El estante indicado no existe.' }, { status: 400, statusText: 'Bad Request' });
    await Promise.resolve();
    await Promise.resolve();
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('El estante indicado no existe.');
  });

  it('no envía la petición cuando el formulario es inválido', async () => {
    const { fixture, httpMock: mock } = configurarPrueba({ libros: [] });
    httpMock = mock;
    await Promise.resolve();

    const formulario = fixture.nativeElement.querySelector('form');
    // Sin libro encontrado, el formulario ni siquiera se renderiza.
    expect(formulario).toBeNull();
    httpMock.expectNone('/api/libros/book-1/estante');
  });
});
